/**
 * KeyboardService — the single keydown handler for editing keys (undo/redo,
 * break at cursor, select-all, copy/cut, Backspace/Delete/Enter and the
 * arrow/Home/End caret moves) plus plain-text insertion.
 */
import type { EditorContext } from "./context";
import type { Cursor } from "../types";
import { blockLen, sanitizeCursor } from "../model/model";
import { deleteAtCursor, removeSpansFromModel, splitBlockAtCursor } from "../utils/operations";

export class KeyboardService {
  constructor(private ctx: EditorContext) {}

  private moveCaret(c: Cursor | null): void {
    this.ctx.bus.emit("cursor:change", c);
  }

  private resetSelectionAfter(
    cursor: Cursor | null,
    opts: { keepContextMenu?: boolean } = {},
  ): void {
    this.ctx.bus.emit("selection:change", null);
    this.ctx.selection.clearLocalSelection();
    this.ctx.bus.emit("cursor:change", cursor);
    if (!opts.keepContextMenu) {
      this.ctx.bus.emit("overlay:close");
    }
  }

  private afterEditCleanup(): void {
    this.ctx.bus.emit("overlay:close");
  }

  handleKeyDown(e: KeyboardEvent): void {
    const { ctx } = this;
    if (ctx.readOnly) {
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target?.closest?.(".se-ctx, .se-popover, .se-popup")) {
      return;
    }
    if (ctx.modalOpen()) {
      e.preventDefault();
      return;
    }
    ctx.state.flags.rightClickPending = false;
    ctx.selection.focusInputHost();
    const nativeKey = e as KeyboardEvent & { keyCode: number };
    if (e.isComposing || nativeKey.keyCode === 229) {
      return;
    }
    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      const anchor: Cursor | null =
        ctx.state.cursor ??
        (ctx.state.spans && ctx.state.spans.length > 0
          ? { blockId: ctx.state.spans[0].blockId, idx: ctx.state.spans[0].start }
          : null);
      if (e.shiftKey) {
        ctx.history.redo();
      } else {
        ctx.history.undo();
      }
      this.resetSelectionAfter(sanitizeCursor(ctx.state.model, anchor));
      return;
    }
    if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      const anchor: Cursor | null = ctx.state.cursor;
      ctx.history.redo();
      this.resetSelectionAfter(sanitizeCursor(ctx.state.model, anchor));
      return;
    }

    // Insert break at cursor
    if (mod && e.shiftKey && e.key.toLowerCase() === "b") {
      e.preventDefault();
      if (ctx.Features.break) {
        ctx.history.breakMerge();
        const c = ctx.state.cursor;
        if (c) {
          const existing =
            ctx.state.model.annotations.find(
              (a) => a.type === "break" && a.blockId === c.blockId && a.start === c.idx,
            ) ?? null;
          ctx.state.overlays.annTarget = {
            type: "break",
            rect: ctx.container.getBoundingClientRect(),
            blockId: c.blockId,
            start: c.idx,
            end: c.idx,
            existing,
          };
          ctx.blurHost();
          ctx.bus.emit("render:request", { dirty: true });
        }
      }
      return;
    }

    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      ctx.history.breakMerge();
      ctx.clipboard.handleSelectAll();
      return;
    }

    if (mod && (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "x")) {
      if (!ctx.state.spans || ctx.state.spans.length === 0) {
        return;
      }
      e.preventDefault();
      ctx.clipboard.copySelectionToClipboard();
      if (e.key.toLowerCase() !== "x") {
        return;
      }
      const caret: Cursor = { blockId: ctx.state.spans[0].blockId, idx: ctx.state.spans[0].start };
      const next = removeSpansFromModel(ctx.state.model, ctx.state.spans);
      ctx.history.commit(next);
      this.resetSelectionAfter(sanitizeCursor(ctx.state.model, caret));
      return;
    }

    // Selection-aware keys
    if (ctx.state.spans && ctx.state.spans.length > 0 && !mod) {
      const key = e.key;
      if (key === "Backspace" || key === "Delete") {
        e.preventDefault();
        const caret: Cursor = {
          blockId: ctx.state.spans[0].blockId,
          idx: ctx.state.spans[0].start,
        };
        const next = removeSpansFromModel(ctx.state.model, ctx.state.spans);
        ctx.history.commit(next);
        this.resetSelectionAfter(sanitizeCursor(ctx.state.model, caret));
        return;
      }
      if (key === "Enter") {
        e.preventDefault();
        const anchor: Cursor = {
          blockId: ctx.state.spans[0].blockId,
          idx: ctx.state.spans[0].start,
        };
        const trimmed = removeSpansFromModel(ctx.state.model, ctx.state.spans);
        const normalized = sanitizeCursor(trimmed, anchor) ?? {
          blockId: ctx.state.spans[0].blockId,
          idx: ctx.state.spans[0].start,
        };
        const split = splitBlockAtCursor(trimmed, normalized);
        if (split) {
          ctx.history.commit(split.model);
          this.resetSelectionAfter(split.cursor);
        } else {
          ctx.history.commit(trimmed);
          this.resetSelectionAfter(normalized);
        }
        return;
      }
      if (key === "ArrowLeft" || key === "ArrowRight") {
        e.preventDefault();
        const first = ctx.state.spans[0];
        const last = ctx.state.spans[ctx.state.spans.length - 1];
        ctx.history.breakMerge();
        this.resetSelectionAfter(
          key === "ArrowLeft"
            ? { blockId: first.blockId, idx: first.start }
            : { blockId: last.blockId, idx: last.end },
          { keepContextMenu: true },
        );
        return;
      }
    }

    const c = ctx.state.cursor;
    if (!c || e.isComposing) {
      return;
    }
    const block = ctx.state.model.blocks.find((b) => b.id === c.blockId);
    if (!block) {
      return;
    }
    const len = blockLen(block);

    switch (e.key) {
      case "Backspace": {
        const r = deleteAtCursor(ctx.state.model, c, true);
        if (r) {
          e.preventDefault();
          ctx.history.commit(r.model, true);
          this.moveCaret(r.cursor);
          this.afterEditCleanup();
        }
        return;
      }
      case "Delete": {
        const r = deleteAtCursor(ctx.state.model, c, false);
        if (r) {
          e.preventDefault();
          ctx.history.commit(r.model, true);
          this.moveCaret(r.cursor);
          this.afterEditCleanup();
        }
        return;
      }
      case "Enter": {
        if (mod) {
          return;
        }
        const r = splitBlockAtCursor(ctx.state.model, c);
        if (r) {
          e.preventDefault();
          ctx.history.commit(r.model, true);
          this.moveCaret(r.cursor);
          this.afterEditCleanup();
        }
        return;
      }
      case "ArrowLeft":
        e.preventDefault();
        ctx.history.breakMerge();
        this.moveCaret(c.idx > 0 ? { ...c, idx: c.idx - 1 } : c);
        return;
      case "ArrowRight":
        e.preventDefault();
        ctx.history.breakMerge();
        this.moveCaret(c.idx < len ? { ...c, idx: c.idx + 1 } : c);
        return;
      case "ArrowUp": {
        e.preventDefault();
        ctx.history.breakMerge();
        const bi = ctx.state.model.blocks.findIndex((b) => b.id === c.blockId);
        if (bi > 0) {
          const prev = ctx.state.model.blocks[bi - 1];
          this.moveCaret({ blockId: prev.id, idx: Math.min(c.idx, blockLen(prev)) });
        }
        return;
      }
      case "ArrowDown": {
        e.preventDefault();
        ctx.history.breakMerge();
        const bi = ctx.state.model.blocks.findIndex((b) => b.id === c.blockId);
        if (bi >= 0 && bi < ctx.state.model.blocks.length - 1) {
          const nextB = ctx.state.model.blocks[bi + 1];
          this.moveCaret({ blockId: nextB.id, idx: Math.min(c.idx, blockLen(nextB)) });
        }
        return;
      }
      case "Home":
        e.preventDefault();
        ctx.history.breakMerge();
        this.moveCaret({ ...c, idx: 0 });
        return;
      case "End":
        e.preventDefault();
        ctx.history.breakMerge();
        this.moveCaret({ ...c, idx: len });
        return;
      default:
        return;
    }
  }
}
