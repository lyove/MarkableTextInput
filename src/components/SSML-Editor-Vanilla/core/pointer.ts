/**
 * PointerService — pointer interaction: mouse/double-click/context-menu
 * handling and the delegated hover pipeline (bracket highlights, break /
 * hint tooltips).
 */
import type { EditorContext } from "./context";
import type { SSMLAnnotation } from "../types";
import { rangeFeatureEnabled } from "../view/block-render";
import { getSelectionSpans } from "../utils/selection";
import { ContextMenu } from "../components/context-menu";

/** Delay (ms) before a tooltip appears on hover */
const TOOLTIP_SHOW_DELAY = 120;
/** Delay (ms) before a tooltip hides after the pointer leaves */
const TOOLTIP_HIDE_DELAY = 100;

export class PointerService {
  constructor(private ctx: EditorContext) {}

  private bracketShowTimer: ReturnType<typeof setTimeout> | null = null;
  private bracketHideTimer: ReturnType<typeof setTimeout> | null = null;
  private bracketPendingId: string | null = null;
  private hintShowTimer: ReturnType<typeof setTimeout> | null = null;
  private hintHideTimer: ReturnType<typeof setTimeout> | null = null;
  private hintPendingText: string | null = null;

  private cancelBracketShow(): void {
    if (this.bracketShowTimer) {
      clearTimeout(this.bracketShowTimer);
      this.bracketShowTimer = null;
    }
    this.bracketPendingId = null;
  }

  private cancelBracketHide(): void {
    if (this.bracketHideTimer) {
      clearTimeout(this.bracketHideTimer);
      this.bracketHideTimer = null;
    }
  }

  private cancelHintShow(): void {
    if (this.hintShowTimer) {
      clearTimeout(this.hintShowTimer);
      this.hintShowTimer = null;
    }
    this.hintPendingText = null;
  }

  private cancelHintHide(): void {
    if (this.hintHideTimer) {
      clearTimeout(this.hintHideTimer);
      this.hintHideTimer = null;
    }
  }

  /** Cancel every pending hover show/hide timer. */
  cancelAllHoverTimers(): void {
    this.cancelBracketShow();
    this.cancelBracketHide();
    this.cancelHintShow();
    this.cancelHintHide();
  }

  handleMouseDown(e: MouseEvent): void {
    const { ctx } = this;
    if (ctx.readOnly || e.button !== 0) {
      if (e.button === 2 && !ctx.readOnly) {
        ctx.state.flags.rightClickPending = true;
      }
      if (ctx.readOnly && e.button === 0) {
        ctx.state.flags.pointerDown = true;
      }
      return;
    }
    ctx.state.flags.rightClickPending = false;
    const target = e.target as HTMLElement;
    if (target?.closest?.(".se-input-host, .se-ctx, .se-popover, .se-popup")) {
      return;
    }
    ctx.history.breakMerge();
    ctx.state.flags.pointerDown = true;
    if (ctx.modalOpen()) {
      ctx.bus.emit("overlay:close");
    }
    const charEl = target?.closest?.<HTMLElement>("[data-char-idx]");
    const blockEl = charEl?.closest<HTMLElement>("[data-block-id]");
    if (!charEl || !blockEl) {
      ctx.selection.placeCaretFromPoint(e.clientX, e.clientY);
      return;
    }
    const now = performance.now();
    const last = ctx.state.flags.lastMouseDown;
    ctx.state.flags.lastMouseDown = { x: e.clientX, y: e.clientY, t: now };
    if (
      last &&
      now - last.t < 500 &&
      Math.abs(e.clientX - last.x) <= 4 &&
      Math.abs(e.clientY - last.y) <= 4
    ) {
      ctx.state.flags.doubleClickPending = true;
      ctx.state.flags.pointerDown = true;
      ctx.ime.cancelCaretRender();
      e.preventDefault();
      return;
    }
    ctx.state.flags.doubleClickPending = false;
    const r = charEl.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    ctx.bus.emit("cursor:change", {
      blockId: blockEl.getAttribute("data-block-id") ?? "",
      idx: Number(charEl.getAttribute("data-char-idx")) + (after ? 1 : 0),
    });
    ctx.state.flags.pointerDown = true;
    ctx.ime.cancelCaretRender();
    ctx.bus.emit("render:request", { dirty: false });
  }

  /** Look up an annotation by id (bracket / break marks carry data-ann-id). */
  findAnn(id: string | null): SSMLAnnotation | null {
    if (!id) {
      return null;
    }
    for (const a of this.ctx.state.model.annotations) {
      if (a.id === id) {
        return a;
      }
    }
    return null;
  }

  handleContentMouseDown(e: MouseEvent): void {
    const t = e.target as HTMLElement | null;
    if (t?.closest?.(".se-break")) {
      e.stopPropagation();
    }
  }

  handleContentClick(e: MouseEvent): void {
    const { ctx } = this;
    const t = e.target as HTMLElement | null;
    if (!t?.closest || ctx.readOnly) {
      return;
    }
    if (ctx.state.flags.doubleClickPending) {
      return;
    }
    // Break mark → break annotation popover.
    const breakEl = t.closest<HTMLElement>(".se-break[data-ann-id]");
    if (breakEl) {
      if (!ctx.Features.break) {
        return;
      }
      const ann = this.findAnn(breakEl.getAttribute("data-ann-id"));
      if (!ann) {
        return;
      }
      e.stopPropagation();
      ctx.state.overlays.annTarget = {
        type: "break",
        rect: breakEl.getBoundingClientRect(),
        blockId: ann.blockId,
        start: ann.start,
        end: ann.end,
        existing: ann,
      };
      ctx.blurHost();
      ctx.bus.emit("render:request", { dirty: true });
      return;
    }
    // Bracket → annotation popover.
    const bracketEl = t.closest<HTMLElement>(".se-bracket[data-ann-id]");
    if (bracketEl) {
      const ann = this.findAnn(bracketEl.getAttribute("data-ann-id"));
      if (!ann) {
        return;
      }
      if (!rangeFeatureEnabled(ctx.Features, ann.type)) {
        return;
      }
      e.stopPropagation();
      ctx.state.overlays.annTarget = {
        type: ann.type,
        rect: bracketEl.getBoundingClientRect(),
        blockId: ann.blockId,
        start: ann.start,
        end: ann.end,
        existing: ann,
      };
      ctx.blurHost();
      ctx.bus.emit("render:request", { dirty: true });
      return;
    }
    // Char: phoneme first, then the enclosing hint group.
    const charEl = t.closest<HTMLElement>(".se-ch[data-char-idx]");
    if (!charEl) {
      return;
    }
    const blockEl = charEl.closest<HTMLElement>("[data-block-id]");
    if (!blockEl) {
      return;
    }
    const blockId = blockEl.getAttribute("data-block-id") ?? "";
    const idx = Number(charEl.getAttribute("data-char-idx"));
    if (charEl.getAttribute("data-ann-type") === "phoneme") {
      ctx.actions.handlePhonemeClick(idx, blockId, e, charEl);
      return;
    }
    if (!ctx.Features.hint) {
      return;
    }
    const groupEl = charEl.closest<HTMLElement>(".se-hint-group");
    if (!groupEl) {
      return;
    }
    ctx.state.overlays.hintTarget = {
      rect: charEl.getBoundingClientRect(),
      blockId,
      start: Number(groupEl.getAttribute("data-hint-start")),
      end: Number(groupEl.getAttribute("data-hint-end")),
      initialText: groupEl.getAttribute("data-hint") ?? "",
    };
    ctx.bus.emit("render:request", { dirty: true });
  }

  clearBracketHover(): void {
    const { ctx } = this;
    this.cancelBracketShow();
    const id = ctx.state.overlays.hoveredPairId;
    if (!id) {
      return;
    }
    ctx.container
      .querySelectorAll(`.se-bracket[data-ann-id="${CSS.escape(id)}"]`)
      .forEach((el) => el.classList.remove("se-bracket--hovered"));
    const ann = this.findAnn(id);
    if (ann) {
      ctx.selection.removeBracketHoverRange(ann.blockId);
    }
    ctx.state.overlays.hoveredPairId = null;
  }

  /**
   * Schedule (or keep) the bracket/break tooltip for `ann`.
   */
  private scheduleBracketTooltipShow(ann: SSMLAnnotation): void {
    const { ctx } = this;
    this.cancelBracketHide();
    const shownId = ctx.state.overlays.bracketTooltip?.ann.id;
    if (shownId === ann.id || this.bracketPendingId === ann.id) {
      return;
    }
    this.cancelBracketShow();
    this.bracketPendingId = ann.id;
    this.bracketShowTimer = setTimeout(() => {
      this.bracketShowTimer = null;
      this.bracketPendingId = null;
      const a = this.findAnn(ann.id);
      if (!a) {
        return;
      }
      if (ctx.state.overlays.hoveredPairId) {
        this.clearBracketHover();
      }
      if (a.type !== "break") {
        ctx.state.overlays.hoveredPairId = a.id;
        ctx.container
          .querySelectorAll(`.se-bracket[data-ann-id="${CSS.escape(a.id)}"]`)
          .forEach((el) => el.classList.add("se-bracket--hovered"));
        ctx.selection.applyBracketHoverRange(a.blockId, a.start, a.end, a.type);
      }
      const live = ctx.container.querySelector<HTMLElement>(
        `.se-break[data-ann-id="${CSS.escape(a.id)}"], .se-bracket[data-ann-id="${CSS.escape(
          a.id,
        )}"]`,
      );
      ctx.actions.setBracketTooltip({
        ann: a,
        rect: live?.getBoundingClientRect() ?? new DOMRect(),
      });
    }, TOOLTIP_SHOW_DELAY);
  }

  /** Schedule the bracket/break tooltip + hover highlights to disappear. */
  private scheduleBracketTooltipHide(): void {
    this.cancelBracketShow();
    if (this.bracketHideTimer) {
      return;
    }
    this.bracketHideTimer = setTimeout(() => {
      this.bracketHideTimer = null;
      const { ctx } = this;
      if (ctx.state.overlays.hoveredPairId) {
        this.clearBracketHover();
      }
      if (ctx.state.overlays.bracketTooltip) {
        ctx.actions.setBracketTooltip(null);
      }
    }, TOOLTIP_HIDE_DELAY);
  }

  /** Schedule the hint tooltip for the given group element. */
  private scheduleHintShow(groupEl: HTMLElement, text: string): void {
    const { ctx } = this;
    this.cancelHintHide();
    if (ctx.state.overlays.hoveredHint?.text === text || this.hintPendingText === text) {
      return;
    }
    this.cancelHintShow();
    this.hintPendingText = text;
    this.hintShowTimer = setTimeout(() => {
      this.hintShowTimer = null;
      this.hintPendingText = null;
      ctx.actions.setHoveredHint({ el: groupEl, text });
    }, TOOLTIP_SHOW_DELAY);
  }

  /** Schedule the hint tooltip to disappear. */
  private scheduleHintHide(): void {
    this.cancelHintShow();
    if (this.hintHideTimer) {
      return;
    }
    this.hintHideTimer = setTimeout(() => {
      this.hintHideTimer = null;
      if (this.ctx.state.overlays.hoveredHint) {
        this.ctx.actions.setHoveredHint(null);
      }
    }, TOOLTIP_HIDE_DELAY);
  }

  handleContentMouseOver(e: MouseEvent): void {
    const { ctx } = this;
    const t = e.target as HTMLElement | null;
    if (!t?.closest) {
      return;
    }
    const rel = e.relatedTarget as Element | null;
    const bracketEl = t.closest<HTMLElement>(".se-bracket[data-ann-id]");
    if (bracketEl) {
      const ann = this.findAnn(bracketEl.getAttribute("data-ann-id"));
      if (!ann) {
        return;
      }
      this.scheduleBracketTooltipShow(ann);
      return;
    }
    // Break: tooltip with its attrs.
    const breakEl = t.closest<HTMLElement>(".se-break[data-ann-id]");
    if (breakEl) {
      const ann = this.findAnn(breakEl.getAttribute("data-ann-id"));
      if (!ann) {
        return;
      }
      this.scheduleBracketTooltipShow(ann);
      return;
    }
    // Hint group: tooltip with the hint text.
    const groupEl = t.closest<HTMLElement>(".se-hint-group");
    if (groupEl) {
      if (
        ctx.state.overlays.hoveredHint?.el === groupEl ||
        rel?.closest?.(".se-hint-group") === groupEl
      ) {
        return;
      }
      this.scheduleHintShow(groupEl, groupEl.getAttribute("data-hint") ?? "");
      return;
    }
    // Plain text / padding: schedule hiding whatever was hovered.
    this.scheduleBracketTooltipHide();
    this.scheduleHintHide();
  }

  handleContentMouseOut(e: MouseEvent): void {
    const t = e.target as HTMLElement | null;
    if (!t) {
      return;
    }
    const rel = e.relatedTarget as Element | null;
    if (t.classList.contains("se-bracket")) {
      const id = t.getAttribute("data-ann-id");
      // Moving to the paired bracket of the same annotation — keep it.
      if (rel?.closest?.(`.se-bracket[data-ann-id="${CSS.escape(id ?? "")}"]`)) {
        return;
      }
      this.scheduleBracketTooltipHide();
      return;
    }
    if (t.classList.contains("se-break")) {
      this.scheduleBracketTooltipHide();
      return;
    }
    if (t.closest(".se-hint-group")) {
      const groupEl = t.closest<HTMLElement>(".se-hint-group");
      if (groupEl && rel && groupEl.contains(rel)) {
        return;
      }
      this.scheduleHintHide();
    }
  }

  handleDoubleClick(e: MouseEvent): void {
    const { ctx } = this;
    if (ctx.readOnly) {
      return;
    }
    ctx.state.flags.doubleClickPending = false;
    const target = e.target as HTMLElement;
    if (target?.closest?.(".se-input-host, .se-ctx, .se-popover")) {
      return;
    }
    const charEl = target?.closest?.<HTMLElement>("[data-char-idx]");
    const blockEl = charEl?.closest<HTMLElement>("[data-block-id]");
    if (!charEl || !blockEl) {
      return;
    }
    const blockId = blockEl.getAttribute("data-block-id") ?? "";
    const block = ctx.state.model.blocks.find((b) => b.id === blockId);
    if (!block) {
      return;
    }
    const chars = Array.from(block.text);
    const i = Number(charEl.getAttribute("data-char-idx"));
    if (chars[i] === undefined) {
      return;
    }
    let start = i;
    let end = i + 1;
    if (/[A-Za-z0-9]/.test(chars[i])) {
      while (start > 0 && /[A-Za-z0-9]/.test(chars[start - 1])) {
        start--;
      }
      while (end < chars.length && /[A-Za-z0-9]/.test(chars[end])) {
        end++;
      }
    }
    const charEls = blockEl.querySelectorAll<HTMLElement>("[data-char-idx]");
    const charTextNode = (el: HTMLElement | undefined): Text | null => {
      if (!el) {
        return null;
      }
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          return child as Text;
        }
      }
      return null;
    };
    const firstNode = charTextNode(charEls[start]);
    const lastNode = charTextNode(charEls[end - 1]);
    if (firstNode && lastNode) {
      const r = document.createRange();
      r.setStart(firstNode, 0);
      r.setEnd(lastNode, lastNode.textContent?.length ?? 1);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
    }
    ctx.bus.emit("selection:change", [{ blockId, start, end }]);
    ctx.bus.emit("cursor:change", null);
    ctx.state.selRect = charEl.getBoundingClientRect();
    ctx.ime.cancelCaretRender();
    ctx.selection.focusInputHost();
    ctx.ime.resetHostCaret();
  }

  handleContextMenu(e: MouseEvent): void {
    const { ctx } = this;
    if (ctx.readOnly) {
      return;
    }
    const target = e.target as HTMLElement;
    if (target?.closest?.(".se-popover, .se-popup, .se-ctx")) {
      return;
    }
    e.preventDefault();
    ctx.history.breakMerge();
    ctx.state.flags.rightClickPending = false;
    const sel = window.getSelection();
    const nativeOk =
      sel && !sel.isCollapsed && sel.rangeCount > 0 && ctx.container.contains(sel.anchorNode);
    const result = nativeOk ? getSelectionSpans(ctx.container) : null;
    const finalSpans = result && result.length > 0 ? result : ctx.state.spans;
    if (finalSpans && finalSpans.length > 0) {
      ctx.state.overlays.ctxMenuOpen = true;
      ctx.bus.emit("selection:change", finalSpans);
      ctx.bus.emit("cursor:change", null);
      ctx.state.selRect =
        nativeOk && sel ? sel.getRangeAt(0).getBoundingClientRect() : ctx.state.selRect;
      this.openContextMenu(e.clientX, e.clientY, true);
      return;
    }
    const charEl = target?.closest?.<HTMLElement>("[data-char-idx]");
    const blockEl = charEl?.closest<HTMLElement>("[data-block-id]");
    if (charEl && blockEl) {
      const r = charEl.getBoundingClientRect();
      const after = e.clientX > r.left + r.width / 2;
      ctx.bus.emit("cursor:change", {
        blockId: blockEl.getAttribute("data-block-id") ?? "",
        idx: Number(charEl.getAttribute("data-char-idx")) + (after ? 1 : 0),
      });
    }
    ctx.state.overlays.ctxMenuOpen = true;
    ctx.bus.emit("selection:change", null);
    this.openContextMenu(e.clientX, e.clientY, false);
  }

  openContextMenu(x: number, y: number, hasSelection: boolean): void {
    const { ctx } = this;
    if (ctx.state.overlays.ctxMenu) {
      ctx.state.overlays.ctxMenu.destroy();
      ctx.state.overlays.ctxMenu = null;
    }
    ctx.state.overlays.ctxMenuOpen = true;
    ctx.state.overlays.ctxMenu = new ContextMenu({
      x,
      y,
      hasSelection,
      multiBlock: hasSelection && (ctx.state.spans?.length ?? 0) > 1,
      hasClipboard: ctx.state.overlays.hasClipboard,
      features: ctx.Features,
      onPhoneme: () => ctx.actions.handlePhoneme(),
      onBreak: () => ctx.actions.handleBreak(),
      onHint: () => ctx.actions.handleHintOpen(),
      onRange: (t) => ctx.actions.handleRangeType(t),
      onSelectAll: () => ctx.clipboard.handleSelectAll(),
      onCopy: () => ctx.clipboard.copySelectionToClipboard(),
      onPaste: () => ctx.clipboard.pasteFromClipboard(),
      onClose: () => ctx.bus.emit("overlay:close"),
    });
  }
}
