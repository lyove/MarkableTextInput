/**
 * ClipboardService — clipboard / text input handling: copy, cut, paste,
 * drag-drop, and the input-event fallback.
 */
import type { EditorContext } from "./context";
import type { Cursor, SSMLModel } from "../types";
import { blockLen, createBlockId, sanitizeCursor } from "../model/model";
import {
  extractModelSpans,
  insertModelAtWithCursor,
  removeSpansFromModel,
} from "../utils/operations";
import { modelToSSML, ssmlToModel } from "../utils/ssml";

let docClipboardText: string | null = null;
let docClipboardHtml: string | null = null;

function captureDocumentClipboard(): { text: string | null; html: string | null } {
  const sel = window.getSelection();
  const text = sel?.toString() ?? "";
  if (text) {
    docClipboardText = text;
    docClipboardHtml = sel?.getRangeAt(0)?.cloneContents()?.firstElementChild?.outerHTML ?? null;
  }
  return { text: docClipboardText, html: docClipboardHtml };
}

function storeClipboardEntry(text: string, html: string | null): void {
  docClipboardText = text || null;
  docClipboardHtml = html;
}

function trackedClipboard(): { text: string | null; html: string | null } {
  return { text: docClipboardText, html: docClipboardHtml };
}

export class ClipboardService {
  constructor(private ctx: EditorContext) {}

  handleSelectAll(): void {
    const { ctx } = this;
    ctx.bus.emit("overlay:close");
    ctx.state.spans = ctx.state.model.blocks.map((b) => ({
      blockId: b.id,
      start: 0,
      end: blockLen(b),
    }));
    ctx.bus.emit("cursor:change", null);
    ctx.state.selRect = ctx.container.getBoundingClientRect();
    ctx.bus.emit("render:request", { dirty: true });
  }

  handleDocClipboard(): void {
    const captured = captureDocumentClipboard();
    this.ctx.state.overlays.hasClipboard = captured.text !== null;
  }

  handleDocCut(): void {
    const { ctx } = this;
    const captured = captureDocumentClipboard();
    ctx.state.overlays.hasClipboard = captured.text !== null;
    if (ctx.readOnly) {
      return;
    }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !ctx.container.contains(sel.anchorNode)) {
      return;
    }
    if (!ctx.state.spans || ctx.state.spans.length === 0) {
      return;
    }
    if (!this.buildCopyPayload()) {
      return;
    }
    const caret: Cursor = { blockId: ctx.state.spans[0].blockId, idx: ctx.state.spans[0].start };
    const next = removeSpansFromModel(ctx.state.model, ctx.state.spans);
    ctx.history.commit(next);
    ctx.bus.emit("cursor:change", sanitizeCursor(ctx.state.model, caret));
    ctx.ime.resetHostCaret();
    ctx.bus.emit("overlay:close");
    ctx.bus.emit("selection:change", null);
  }

  private buildCopyPayload(): { plain: string; ssml: string } | null {
    const { ctx } = this;
    if (!ctx.state.spans || ctx.state.spans.length === 0) {
      return null;
    }
    const sub = extractModelSpans(ctx.state.model, ctx.state.spans);
    const plain = sub.blocks.map((b) => b.text).join("\n");
    const ssml = modelToSSML(sub);
    storeClipboardEntry(plain, ssml);
    ctx.state.overlays.hasClipboard = true;
    return { plain, ssml };
  }

  copySelectionToClipboard(): void {
    const { ctx } = this;
    const payload = this.buildCopyPayload();
    if (!payload) {
      return;
    }
    try {
      const item = new ClipboardItem({
        "text/html": new Blob([payload.ssml], { type: "text/html" }),
        "text/plain": new Blob([payload.plain], { type: "text/plain" }),
      });
      void navigator.clipboard?.write([item]);
    } catch {
      // Clipboard API unavailable — the tracked entry above still allows pasting.
    }
    if (ctx.state.overlays.ctxMenu) {
      ctx.state.overlays.ctxMenu.destroy();
      ctx.state.overlays.ctxMenu = null;
    }
    ctx.state.overlays.ctxMenuOpen = false;
  }

  pasteFromClipboard(): void {
    const { ctx } = this;
    if (ctx.readOnly) {
      return;
    }
    void (async () => {
      let html: string | null = null;
      let text: string | null = null;
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          if (item.types.includes("text/html")) {
            const blob = await item.getType("text/html");
            html = await blob.text();
            if (html) {
              break;
            }
          }
          if (item.types.includes("text/plain")) {
            const blob = await item.getType("text/plain");
            text = await blob.text();
          }
        }
      } catch {
        // Clipboard read not available (missing "clipboard-read" permission).
        // Fall back to the content tracked at copy time below.
      }
      if (!html && !text) {
        const tracked = trackedClipboard();
        html = tracked.html;
        text = tracked.text;
      }
      const pasted = this.parsePaste(html, text);
      if (!pasted || pasted.blocks.length === 0) {
        return;
      }
      this.applyPaste(pasted);
    })();
    ctx.bus.emit("overlay:close");
  }

  parsePaste(html: string | null, text: string | null): SSMLModel | null {
    if (html && /<phoneme|<break|<prosody|<say-as|<emphasis|<hint/i.test(html)) {
      return ssmlToModel(html);
    }
    if (text) {
      const lines = text
        .split(/\n+/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length > 0) {
        return {
          blocks: lines.map((l) => ({ id: createBlockId(), text: l })),
          annotations: [],
          hints: [],
        };
      }
    }
    return null;
  }

  applyPaste(pasted: SSMLModel): void {
    const { ctx } = this;
    let next = ctx.state.model;
    let anchor: Cursor | null = null;
    if (ctx.state.spans && ctx.state.spans.length > 0) {
      const from = { blockId: ctx.state.spans[0].blockId, idx: ctx.state.spans[0].start };
      next = removeSpansFromModel(next, ctx.state.spans);
      anchor = sanitizeCursor(next, from);
    } else if (ctx.state.cursor) {
      anchor = sanitizeCursor(ctx.state.model, ctx.state.cursor);
    }
    if (!anchor) {
      const last = ctx.state.model.blocks[ctx.state.model.blocks.length - 1];
      anchor = last ? { blockId: last.id, idx: blockLen(last) } : { blockId: "", idx: 0 };
    }
    const { model: inserted, cursor } = insertModelAtWithCursor(
      next,
      anchor.blockId,
      anchor.idx,
      pasted,
    );
    ctx.history.commit(inserted);
    ctx.bus.emit("cursor:change", cursor);
    ctx.ime.resetHostCaret();
    ctx.bus.emit("selection:change", null);
  }

  handleCopy(e: ClipboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target?.closest?.(".se-ctx, .se-popover, .se-popup")) {
      return;
    }
    const payload = this.buildCopyPayload();
    if (!payload) {
      return;
    }
    const cd = e.clipboardData;
    if (cd) {
      cd.setData("text/html", payload.ssml);
      cd.setData("text/plain", payload.plain);
    }
    e.preventDefault();
  }

  handlePaste(e: ClipboardEvent): void {
    const { ctx } = this;
    const target = e.target as HTMLElement | null;
    if (target?.closest?.(".se-ctx, .se-popover, .se-popup")) {
      return;
    }
    if (ctx.readOnly) {
      return;
    }
    if (ctx.modalOpen()) {
      e.preventDefault();
      return;
    }
    const cd = e.clipboardData;
    const html = cd?.getData("text/html") ?? "";
    const text = cd?.getData("text/plain") ?? "";
    const pasted = this.parsePaste(html, text);
    if (!pasted || pasted.blocks.length === 0) {
      return;
    }
    e.preventDefault();
    this.applyPaste(pasted);
  }

  handleInput(e: InputEvent): void {
    const { ctx } = this;
    if (e.isComposing || e.inputType === "insertCompositionText") {
      return;
    }
    if (ctx.modalOpen()) {
      ctx.ime.resetHostCaret();
      return;
    }
    const hostText = ctx.inputHost?.textContent ?? "";
    if (hostText && !ctx.readOnly) {
      ctx.ime.commitTextInsert(hostText);
    }
    ctx.ime.resetHostCaret();
  }

  handleDragOver(e: DragEvent): void {
    if (!this.ctx.readOnly && !this.ctx.modalOpen()) {
      e.preventDefault();
    }
  }

  handleDrop(e: DragEvent): void {
    const { ctx } = this;
    if (ctx.readOnly || ctx.modalOpen()) {
      return;
    }
    const dt = e.dataTransfer;
    if (!dt) {
      return;
    }
    const html = dt.getData("text/html") ?? "";
    const text = dt.getData("text/plain") ?? "";
    const pasted = this.parsePaste(html, text);
    if (!pasted || pasted.blocks.length === 0) {
      return;
    }
    e.preventDefault();
    const range = ctx.selection.caretRangeFromPoint(e.clientX, e.clientY);
    if (range && ctx.container.contains(range.startContainer)) {
      ctx.selection.normalizeRangeAnchor(range);
      const pos = ctx.selection.resolveCaretFromRange(range.startContainer, range.startOffset);
      if (pos) {
        ctx.bus.emit("cursor:change", pos);
      }
    }
    ctx.bus.emit("selection:change", null);
    this.applyPaste(pasted);
  }
}
