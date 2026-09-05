/**
 * ActionsService — annotation / editing commands: the imperative action handlers
 * behind the phoneme popover, the annotation target dialogs and the hint tooltip.
 */
import type { EditorContext } from "./context";
import type { SSMLAnnotation, SSMLModel, AnnotationType, SelectionSpan } from "../types";
import { isHan } from "../model/model";
import {
  findRangeAnnotation,
  removeAnnotation,
  setCharPhoneme,
  addAnnotation,
  replaceOverlapsAndAdd,
  splitOverlapsAndAdd,
  splitConflictsOnly,
  findOverlappingAnnotations,
  findCrossBoundaryAnnotations,
} from "../utils/annotations";
import { findHint, setBlockHint } from "../utils/operations";
import { rangeFeatureEnabled } from "../view/block-render";
import { pinyinEngine, defaultPinyinFormats } from "../utils/pinyin";
import type { PopoverChar } from "../components";

export class ActionsService {
  constructor(private ctx: EditorContext) {}

  buildPhonemeTargets(sel: SelectionSpan[]): {
    chars: PopoverChar[];
    locations: { blockId: string; charIdx: number }[];
  } {
    const chars: PopoverChar[] = [];
    const locations: { blockId: string; charIdx: number }[] = [];
    for (const sp of sel) {
      const block = this.ctx.state.model.blocks.find((b) => b.id === sp.blockId);
      if (!block) {
        continue;
      }
      const arr = Array.from(block.text);
      for (let i = sp.start; i < Math.min(sp.end, arr.length); i++) {
        const ch = arr[i];
        const isLetter = /^[\p{L}\p{M}]$/u.test(ch);
        if (!isHan(ch) && !isLetter) {
          continue;
        }
        if (isHan(ch)) {
          const ann = findRangeAnnotation(this.ctx.state.model, "phoneme", sp.blockId, i, i + 1);
          chars.push({
            idx: chars.length,
            char: ch,
            val: ann?.attrs.val ?? "",
            tone: ann?.attrs.tone ?? "",
            candidates: pinyinEngine.getAllReadings(ch),
            kind: "han",
          });
        } else {
          chars.push({
            idx: chars.length,
            char: ch,
            val: "",
            tone: "",
            kind: "other",
          });
        }
        locations.push({ blockId: sp.blockId, charIdx: i });
      }
    }
    return { chars, locations };
  }

  handlePhoneme(): void {
    const { ctx } = this;
    if (!ctx.state.spans || ctx.readOnly || !ctx.Features.phoneme.enabled) {
      return;
    }
    const { chars, locations } = this.buildPhonemeTargets(ctx.state.spans);
    if (chars.length === 0) {
      return;
    }
    ctx.bus.emit("overlay:close");
    ctx.state.overlays.editing = {
      rect: ctx.state.selRect ?? new DOMRect(0, 0, 0, 0),
      chars,
      locations,
    };
    ctx.bus.emit("render:request", { dirty: true });
  }

  handlePhonemeClick(charIdx: number, blockId: string, e: MouseEvent, el: HTMLElement): void {
    const { ctx } = this;
    if (ctx.readOnly || !ctx.Features.phoneme.enabled) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const block = ctx.state.model.blocks.find((b) => b.id === blockId);
    if (!block) {
      return;
    }
    const ch = Array.from(block.text)[charIdx];
    const ann = findRangeAnnotation(ctx.state.model, "phoneme", blockId, charIdx, charIdx + 1);
    const auto = ann || !isHan(ch) ? null : defaultPinyinFormats(ch);
    ctx.state.overlays.editing = {
      rect: el.getBoundingClientRect(),
      chars: [
        {
          idx: 0,
          char: ch,
          val: ann?.attrs.val ?? auto?.val ?? "",
          tone: ann?.attrs.tone ?? auto?.tone ?? "",
          candidates: pinyinEngine.getAllReadings(ch),
          kind: isHan(ch) ? "han" : "other",
        },
      ],
      locations: [{ blockId, charIdx }],
    };
    ctx.history.breakMerge();
    ctx.bus.emit("render:request", { dirty: true });
  }

  writePhoneme(pos: number, val: string, tone: string): void {
    const { ctx } = this;
    if (
      !ctx.state.overlays.editing ||
      pos < 0 ||
      pos >= ctx.state.overlays.editing.locations.length
    ) {
      return;
    }
    const loc = ctx.state.overlays.editing.locations[pos];
    const next = setCharPhoneme(ctx.state.model, loc.blockId, loc.charIdx, val, tone);
    if (next !== ctx.state.model) {
      ctx.history.commit(next, true, "phoneme");
    }
    if (ctx.state.overlays.editing) {
      ctx.state.overlays.editing = {
        ...ctx.state.overlays.editing,
        chars: ctx.state.overlays.editing.chars.map((c, i) =>
          i === pos ? { ...c, val, tone } : c,
        ),
      };
    }
  }

  private refocusAfterPopoverGesture(e?: Event): void {
    if (this.ctx.readOnly || !e || !this.ctx.container.isConnected) {
      return;
    }
    const target = e.target as Node | null;
    if (e.type === "keydown" || (target && this.ctx.container.contains(target))) {
      this.ctx.selection.focusInputHost();
    }
  }

  private refocusHostAfterCommit(): void {
    if (!this.ctx.readOnly && this.ctx.container.isConnected) {
      this.ctx.selection.focusInputHost();
    }
  }

  closeEditing(e?: Event): void {
    this.ctx.state.overlays.editing = null;
    this.ctx.history.breakMerge();
    this.ctx.bus.emit("render:request", { dirty: false });
    this.refocusAfterPopoverGesture(e);
  }

  anchorFor(): { blockId: string; start: number; end: number } | null {
    const { ctx } = this;
    if (ctx.state.spans && ctx.state.spans.length > 0) {
      const first = ctx.state.spans[0];
      if (ctx.state.spans.length === 1) {
        return { blockId: first.blockId, start: first.start, end: first.end };
      }
      return {
        blockId: first.blockId,
        start: first.start,
        end: Number.MAX_SAFE_INTEGER,
      };
    }
    if (ctx.state.cursor) {
      return {
        blockId: ctx.state.cursor.blockId,
        start: ctx.state.cursor.idx,
        end: ctx.state.cursor.idx,
      };
    }
    return null;
  }

  handleBreak(): void {
    const { ctx } = this;
    if (ctx.readOnly || !ctx.Features.break) {
      return;
    }
    const anchor = this.anchorFor();
    if (!anchor) {
      return;
    }
    const end = anchor.end === Number.MAX_SAFE_INTEGER ? anchor.start : anchor.end;
    const existing =
      ctx.state.model.annotations.find(
        (a) => a.type === "break" && a.blockId === anchor.blockId && a.start === end,
      ) ?? null;
    ctx.bus.emit("overlay:close");
    ctx.state.overlays.annTarget = {
      type: "break",
      rect: ctx.state.selRect ?? ctx.container.getBoundingClientRect(),
      blockId: anchor.blockId,
      start: end,
      end,
      existing,
    };
    ctx.bus.emit("render:request", { dirty: true });
  }

  handleRangeType(type: AnnotationType): void {
    const { ctx } = this;
    if (ctx.readOnly || !rangeFeatureEnabled(ctx.Features, type)) {
      return;
    }
    const anchor = this.anchorFor();
    if (!anchor) {
      return;
    }
    const end = anchor.end === Number.MAX_SAFE_INTEGER ? anchor.start : anchor.end;
    if (end <= anchor.start) {
      return;
    }
    const existing = findRangeAnnotation(ctx.state.model, type, anchor.blockId, anchor.start, end);
    ctx.bus.emit("overlay:close");
    ctx.state.overlays.annTarget = {
      type,
      rect: ctx.state.selRect ?? new DOMRect(0, 0, 0, 0),
      blockId: anchor.blockId,
      start: anchor.start,
      end,
      existing,
    };
    ctx.bus.emit("render:request", { dirty: true });
  }

  handleAnnConfirm(attrs: Record<string, string>): void {
    const { ctx } = this;
    if (!ctx.state.overlays.annTarget) {
      return;
    }
    const baseAnn = {
      type: ctx.state.overlays.annTarget.type,
      blockId: ctx.state.overlays.annTarget.blockId,
      start: ctx.state.overlays.annTarget.start,
      end: ctx.state.overlays.annTarget.end,
      attrs,
    };
    const isRanged =
      baseAnn.type === "prosody" ||
      baseAnn.type === "sayAs" ||
      baseAnn.type === "emphasis" ||
      baseAnn.type === "phoneme";
    if (isRanged) {
      const conflicts = findOverlappingAnnotations(ctx.state.model, {
        type: baseAnn.type,
        blockId: baseAnn.blockId,
        start: baseAnn.start,
        end: baseAnn.end,
        excludeId: ctx.state.overlays.annTarget.existing?.id,
      });
      if (conflicts.length > 0) {
        ctx.state.overlays.overlapPrompt = {
          type: baseAnn.type,
          blockId: baseAnn.blockId,
          start: baseAnn.start,
          end: baseAnn.end,
          attrs,
          conflicts,
        };
        ctx.bus.emit("render:request", { dirty: true });
        return;
      }
      const crossBoundary = findCrossBoundaryAnnotations(ctx.state.model, {
        type: baseAnn.type,
        blockId: baseAnn.blockId,
        start: baseAnn.start,
        end: baseAnn.end,
        excludeId: ctx.state.overlays.annTarget.existing?.id,
      });
      if (crossBoundary.length > 0) {
        ctx.state.overlays.crossBoundaryPrompt = {
          type: baseAnn.type,
          start: baseAnn.start,
          end: baseAnn.end,
          existing: crossBoundary,
        };
        ctx.bus.emit("render:request", { dirty: true });
        return;
      }
    }
    let next: SSMLModel;
    if (ctx.state.overlays.annTarget.existing) {
      next = replaceOverlapsAndAdd(
        ctx.state.model,
        [ctx.state.overlays.annTarget.existing.id],
        baseAnn,
      );
    } else {
      next = addAnnotation(ctx.state.model, baseAnn);
    }
    ctx.history.commit(next);
    this.closeAnnTarget();
    this.refocusHostAfterCommit();
  }

  handleOverlapReplace(): void {
    const { ctx } = this;
    if (!ctx.state.overlays.overlapPrompt) {
      return;
    }
    const { type, blockId, start, end, attrs, conflicts } = ctx.state.overlays.overlapPrompt;
    const ann = { type, blockId, start, end, attrs };
    const removeIds = conflicts.map((c) => c.id);
    if (ctx.state.overlays.annTarget?.existing) {
      removeIds.push(ctx.state.overlays.annTarget.existing.id);
    }
    ctx.history.commit(replaceOverlapsAndAdd(ctx.state.model, removeIds, ann));
    this.closeOverlapPrompt();
    this.closeAnnTarget();
    this.refocusHostAfterCommit();
  }

  handleOverlapSplit(): void {
    const { ctx } = this;
    if (!ctx.state.overlays.overlapPrompt) {
      return;
    }
    const { type, blockId, start, end, attrs, conflicts } = ctx.state.overlays.overlapPrompt;
    const ann = { type, blockId, start, end, attrs };
    let base = ctx.state.model;
    if (ctx.state.overlays.annTarget?.existing) {
      base = replaceOverlapsAndAdd(base, [ctx.state.overlays.annTarget.existing.id], ann);
      const priorId = ctx.state.overlays.annTarget.existing.id;
      const others = conflicts.filter((c) => c.id !== priorId);
      base = splitConflictsOnly(base, others, ann);
    } else {
      base = splitOverlapsAndAdd(base, conflicts, ann);
    }
    ctx.history.commit(base);
    this.closeOverlapPrompt();
    this.closeAnnTarget();
    this.refocusHostAfterCommit();
  }

  handleOverlapCancel(): void {
    this.closeOverlapPrompt();
  }

  handleCrossBoundaryDismiss(): void {
    this.closeCrossBoundaryPrompt();
  }

  handleAnnRemove(): void {
    const { ctx } = this;
    if (!ctx.state.overlays.annTarget) {
      return;
    }
    let next = ctx.state.model;
    if (ctx.state.overlays.annTarget.existing) {
      next = removeAnnotation(next, ctx.state.overlays.annTarget.existing.id);
    } else {
      const found = ctx.state.model.annotations.find(
        (a) =>
          a.type === ctx.state.overlays.annTarget!.type &&
          a.blockId === ctx.state.overlays.annTarget!.blockId &&
          a.start === ctx.state.overlays.annTarget!.start &&
          a.end === ctx.state.overlays.annTarget!.end,
      );
      next = found ? removeAnnotation(next, found.id) : next;
    }
    ctx.history.commit(next);
    this.closeAnnTarget();
    this.refocusHostAfterCommit();
  }

  handleHintOpen(): void {
    const { ctx } = this;
    if (!ctx.state.spans || ctx.state.spans.length === 0 || ctx.readOnly || !ctx.Features.hint) {
      return;
    }
    const sp = ctx.state.spans[0];
    const existing = findHint(ctx.state.model, sp.blockId, sp.start, sp.end);
    ctx.state.overlays.hintTarget = {
      rect: ctx.state.selRect ?? new DOMRect(0, 0, 0, 0),
      blockId: sp.blockId,
      start: sp.start,
      end: sp.end,
      initialText: existing?.text ?? "",
    };
    ctx.bus.emit("overlay:close");
    ctx.bus.emit("render:request", { dirty: true });
  }

  handleHintConfirm(text: string): void {
    const { ctx } = this;
    if (!ctx.state.overlays.hintTarget) {
      return;
    }
    ctx.history.commit(
      setBlockHint(
        ctx.state.model,
        ctx.state.overlays.hintTarget.blockId,
        ctx.state.overlays.hintTarget.start,
        ctx.state.overlays.hintTarget.end,
        text,
      ),
    );
    this.closeHintTarget();
    this.refocusHostAfterCommit();
  }

  handleHintRemove(): void {
    const { ctx } = this;
    if (!ctx.state.overlays.hintTarget) {
      return;
    }
    ctx.history.commit(
      setBlockHint(
        ctx.state.model,
        ctx.state.overlays.hintTarget.blockId,
        ctx.state.overlays.hintTarget.start,
        ctx.state.overlays.hintTarget.end,
        "",
      ),
    );
    this.closeHintTarget();
    this.refocusHostAfterCommit();
  }

  closeAnnTarget(e?: Event): void {
    this.ctx.state.overlays.annTarget = null;
    this.ctx.bus.emit("render:request", { dirty: false });
    this.refocusAfterPopoverGesture(e);
  }

  closeHintTarget(e?: Event): void {
    this.ctx.state.overlays.hintTarget = null;
    this.ctx.bus.emit("render:request", { dirty: false });
    this.refocusAfterPopoverGesture(e);
  }

  closeOverlapPrompt(): void {
    this.ctx.state.overlays.overlapPrompt = null;
    this.ctx.bus.emit("render:request", { dirty: false });
  }

  closeCrossBoundaryPrompt(): void {
    this.ctx.state.overlays.crossBoundaryPrompt = null;
    this.ctx.bus.emit("render:request", { dirty: false });
  }

  setBracketTooltip(t: { ann: SSMLAnnotation; rect: DOMRect } | null): void {
    const cur = this.ctx.state.overlays.bracketTooltip;
    if (t && cur && cur.ann.id === t.ann.id) {
      return;
    }
    this.ctx.state.overlays.bracketTooltip = t;
    this.ctx.bus.emit("render:request", { dirty: false });
  }

  setHoveredHint(h: { el: HTMLElement; text: string } | null): void {
    const cur = this.ctx.state.overlays.hoveredHint;
    if (h && cur && cur.text === h.text) {
      return;
    }
    this.ctx.state.overlays.hoveredHint = h;
    this.ctx.bus.emit("render:request", { dirty: false });
  }
}
