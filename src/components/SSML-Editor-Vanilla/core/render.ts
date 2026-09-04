/**
 * RenderService — render pipeline: floating layer, popover sync and block-tree rebuild.
 */
import type { EditorContext } from "./context";
import { isEmptyModel } from "../utils/serialize";
import { spansEqual } from "../utils/selection";
import {
  buildBlockDomRefs,
  type BlockRenderCtx,
  buildBlockVNodes,
  diffBlockChildren,
  materializeVNodes,
  type VNode,
  type VNodeDomRefs,
} from "../view/block-render";
import {
  buildBracketTooltip,
  buildCrossBoundaryDialog,
  buildHintTooltip,
  buildOverlapDialog,
} from "../view/overlays";
import {
  BreakPopover,
  ProsodyPopover,
  SayAsPopover,
  EmphasisPopover,
  HintPopover,
  PhonemePopover,
} from "../components";
import type { ModelHint, SSMLAnnotation, SSMLModel } from "../types";

const IDLE_PAINT_MIN_BLOCKS = 2000;
const IDLE_PAINT_CHUNK = 400;
const IDLE_PAINT_BUDGET_MS = 10;
const IDLE_PAINT_TIMEOUT_MS = 30;

function scheduleIdle(task: () => void, timeoutMs: number): () => void {
  let cancelled = false;
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(
      () => {
        if (!cancelled) {
          task();
        }
      },
      { timeout: timeoutMs },
    );
    return () => {
      cancelled = true;
      cancelIdleCallback(id);
    };
  }
  const id = window.setTimeout(() => {
    if (!cancelled) {
      task();
    }
  }, 0);
  return () => {
    cancelled = true;
    window.clearTimeout(id);
  };
}

function groupKey<T>(
  items: readonly T[],
  idOf: (t: T) => string,
  keyOf: (t: T) => string,
): Map<string, string> {
  const buckets = new Map<string, T[]>();
  for (const it of items) {
    const id = idOf(it);
    let arr = buckets.get(id);
    if (!arr) {
      arr = [];
      buckets.set(id, arr);
    }
    arr.push(it);
  }
  const out = new Map<string, string>();
  for (const [id, arr] of buckets) {
    arr.sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0));
    out.set(id, arr.map(keyOf).join("\u0000"));
  }
  return out;
}

function annKeyOf(a: SSMLAnnotation): string {
  const attrs = Object.keys(a.attrs)
    .sort()
    .map((k) => `${k}=${a.attrs[k]}`)
    .join(",");
  return `${a.id}|${a.type}|${a.start}|${a.end}|${attrs}`;
}

function hintKeyOf(h: ModelHint): string {
  return `${h.id}|${h.start}|${h.end}|${h.text}`;
}

function groupAnnotations(annotations: SSMLAnnotation[]): Map<string, string> {
  return groupKey(annotations, (a) => a.blockId, annKeyOf);
}

function groupHints(hints: ModelHint[]): Map<string, string> {
  return groupKey(hints, (h) => h.blockId, hintKeyOf);
}

export class RenderService {
  constructor(private ctx: EditorContext) {}

  /**
   * Cached annotation/hint grouping maps.  Rebuilding them walks every
   * annotation and hint in the document, which is wasted work when the only
   * change since the last call was the cursor position — so the maps are
   * reused until the underlying arrays change identity (the same identity
   * rule renderBlocks already relies on for its own change detection).
   */
  private annMapCache: {
    anns: SSMLAnnotation[];
    hints: ModelHint[];
    annsByBlock: Map<string, SSMLAnnotation[]>;
    hintsByBlock: Map<string, ModelHint[]>;
  } | null = null;

  ensureFloatLayer(): HTMLDivElement {
    if (!this.ctx.state.render.floatLayer) {
      const fl = document.createElement("div");
      fl.className = "se-float-layer";
      this.ctx.container.appendChild(fl);
      this.ctx.state.render.floatLayer = fl;
    }
    return this.ctx.state.render.floatLayer;
  }

  render(): void {
    this.syncPopovers();
    if (this.ctx.state.render.contentDirty && !this.ctx.state.render.paintingChunks) {
      this.renderBlocks();
      this.ctx.state.render.contentDirty = false;
      this.ctx.state.flags.hostPosStale = true;
    }
    this.renderFloating();
    if (this.ctx.state.flags.hostPosStale) {
      this.ctx.selection.positionInputHostToCursor();
      this.ctx.state.flags.hostPosStale = false;
    }
  }

  markContentDirty(): void {
    this.ctx.state.render.contentDirty = true;
  }

  syncPopovers(): void {
    const { ctx } = this;
    if (ctx.state.flags.popoverSyncGuard) {
      return;
    }
    ctx.state.flags.popoverSyncGuard = true;
    try {
      // Editing (phoneme)
      if (ctx.state.overlays.editing && !ctx.state.overlays.editingPopover) {
        ctx.state.overlays.editingPopover = new PhonemePopover({
          rect: ctx.state.overlays.editing.rect,
          chars: ctx.state.overlays.editing.chars,
          onCharChange: (pos, val, tone) => ctx.actions.writePhoneme(pos, val, tone),
          onCharRemove: (pos) => ctx.actions.writePhoneme(pos, "", ""),
          onClose: (e?: Event) => ctx.actions.closeEditing(e),
        });
      } else if (!ctx.state.overlays.editing && ctx.state.overlays.editingPopover) {
        ctx.state.overlays.editingPopover.destroy();
        ctx.state.overlays.editingPopover = null;
      }

      // Annotation target popover
      if (ctx.state.overlays.annTarget && !ctx.state.overlays.annPopover) {
        const t = ctx.state.overlays.annTarget;
        const common = {
          rect: t.rect,
          initial: t.existing?.attrs ?? null,
          onConfirm: (attrs: Record<string, string>) => ctx.actions.handleAnnConfirm(attrs),
          onRemove: t.existing ? () => ctx.actions.handleAnnRemove() : undefined,
          onClose: (e?: Event) => ctx.actions.closeAnnTarget(e),
        };
        if (t.type === "break") {
          ctx.state.overlays.annPopover = new BreakPopover(common);
        } else if (t.type === "prosody") {
          ctx.state.overlays.annPopover = new ProsodyPopover(common);
        } else if (t.type === "sayAs") {
          ctx.state.overlays.annPopover = new SayAsPopover(common);
        } else if (t.type === "emphasis") {
          ctx.state.overlays.annPopover = new EmphasisPopover(common);
        } else {
          ctx.state.overlays.annPopover = null;
        }
      } else if (!ctx.state.overlays.annTarget && ctx.state.overlays.annPopover) {
        ctx.state.overlays.annPopover.destroy();
        ctx.state.overlays.annPopover = null;
      }

      // Hint popover
      if (ctx.state.overlays.hintTarget && !ctx.state.overlays.hintPopover) {
        const h = ctx.state.overlays.hintTarget;
        ctx.state.overlays.hintPopover = new HintPopover({
          rect: h.rect,
          initialText: h.initialText,
          onConfirm: (text) => ctx.actions.handleHintConfirm(text),
          onRemove: h.initialText ? () => ctx.actions.handleHintRemove() : undefined,
          onClose: (e?: Event) => ctx.actions.closeHintTarget(e),
        });
      } else if (!ctx.state.overlays.hintTarget && ctx.state.overlays.hintPopover) {
        ctx.state.overlays.hintPopover.destroy();
        ctx.state.overlays.hintPopover = null;
      }
    } finally {
      ctx.state.flags.popoverSyncGuard = false;
    }
  }

  blockRenderCtx(): BlockRenderCtx {
    const model = this.ctx.state.model;
    const hints = model.hints ?? [];
    let maps = this.annMapCache;
    if (!maps || maps.anns !== model.annotations || maps.hints !== hints) {
      const annsByBlock = new Map<string, SSMLAnnotation[]>();
      for (const a of model.annotations) {
        let arr = annsByBlock.get(a.blockId);
        if (!arr) {
          arr = [];
          annsByBlock.set(a.blockId, arr);
        }
        arr.push(a);
      }
      const hintsByBlock = new Map<string, ModelHint[]>();
      for (const h of hints) {
        let arr = hintsByBlock.get(h.blockId);
        if (!arr) {
          arr = [];
          hintsByBlock.set(h.blockId, arr);
        }
        arr.push(h);
      }
      for (const arr of hintsByBlock.values()) {
        if (arr.length > 1) {
          arr.sort((a, b) => a.start - b.start);
        }
      }
      maps = { anns: model.annotations, hints, annsByBlock, hintsByBlock };
      this.annMapCache = maps;
    }
    return {
      model,
      spans: this.ctx.state.spans,
      cursor: this.ctx.state.cursor,
      composingText: this.ctx.state.composingText,
      readOnly: this.ctx.readOnly,
      hoveredPairId: this.ctx.state.overlays.hoveredPairId,
      Features: this.ctx.Features,
      annsByBlock: maps.annsByBlock,
      hintsByBlock: maps.hintsByBlock,
    };
  }

  renderBlocks(): void {
    const { ctx } = this;
    const model = ctx.state.model;
    const isEmpty = isEmptyModel(model);

    if (
      !ctx.state.render.paintedEls ||
      ctx.state.render.forceFullRender ||
      isEmpty !== ctx.state.render.paintedEmpty
    ) {
      this.paintAllLines();
      return;
    }

    const dirty = new Set<string>();
    const docChanged = ctx.state.render.paintedModel !== model;
    let annGroups: Map<string, string> | null = null;
    let hintGroups: Map<string, string> | null = null;

    if (docChanged) {
      if (ctx.state.render.paintedAnnList !== model.annotations) {
        annGroups = groupAnnotations(model.annotations);
      }
      if (ctx.state.render.paintedHintList !== (model.hints ?? null)) {
        hintGroups = groupHints(model.hints ?? []);
      }
      const pt = ctx.state.render.paintedText!;
      const pa = ctx.state.render.paintedAnn!;
      const ph = ctx.state.render.paintedHints!;
      for (const block of model.blocks) {
        let changed = pt.get(block.id) !== block.text;
        if (!changed && annGroups) {
          changed = (pa.get(block.id) ?? "") !== (annGroups.get(block.id) ?? "");
        }
        if (!changed && hintGroups) {
          changed = (ph.get(block.id) ?? "") !== (hintGroups.get(block.id) ?? "");
        }
        if (changed) {
          dirty.add(block.id);
        }
        pt.set(block.id, block.text);
      }
    }

    const caret = ctx.state.cursor;
    if (caret) {
      dirty.add(caret.blockId);
    }
    if (ctx.state.spans) {
      for (const s of ctx.state.spans) {
        dirty.add(s.blockId);
      }
    }
    if (
      ctx.state.render.lastSelSpans &&
      !spansEqual(ctx.state.render.lastSelSpans, ctx.state.spans)
    ) {
      for (const s of ctx.state.render.lastSelSpans) {
        dirty.add(s.blockId);
      }
    }

    if (docChanged) {
      if (annGroups) {
        const pa = ctx.state.render.paintedAnn!;
        for (const block of model.blocks) {
          pa.set(block.id, annGroups.get(block.id) ?? "");
        }
      }
      if (hintGroups) {
        const ph = ctx.state.render.paintedHints!;
        for (const block of model.blocks) {
          ph.set(block.id, hintGroups.get(block.id) ?? "");
        }
      }
      ctx.state.render.paintedModel = model;
      ctx.state.render.paintedAnnList = model.annotations;
      ctx.state.render.paintedHintList = model.hints ?? null;
    }

    if (!docChanged && dirty.size === 0) {
      if (!caret) {
        ctx.content.querySelectorAll(".se-caret").forEach((el) => el.remove());
        ctx.state.render.paintedCaretEl = null;
      }
      ctx.state.render.lastSelSpans = ctx.state.spans
        ? ctx.state.spans.map((s) => ({ ...s }))
        : null;
      return;
    }

    const els = ctx.state.render.paintedEls!;
    let structural = els.size !== model.blocks.length;
    if (!structural) {
      for (const id of dirty) {
        if (!els.has(id)) {
          structural = true;
          break;
        }
      }
    }
    if (structural) {
      this.reconcileLines(model, dirty);
    } else {
      this.rebuildDirtyLines(model, dirty);
    }

    if (!caret) {
      ctx.content.querySelectorAll(".se-caret").forEach((el) => el.remove());
      ctx.state.render.paintedCaretEl = null;
    } else {
      const oldCaret = ctx.state.render.paintedCaretEl;
      const blockEl = ctx.state.render.paintedEls!.get(caret.blockId) ?? null;
      if (oldCaret) {
        if (!oldCaret.isConnected) {
          ctx.state.render.paintedCaretEl = blockEl?.querySelector(".se-caret") ?? null;
        } else if (!blockEl || !blockEl.contains(oldCaret)) {
          oldCaret.remove();
          ctx.state.render.paintedCaretEl = blockEl?.querySelector(".se-caret") ?? null;
        }
      } else if (blockEl) {
        ctx.state.render.paintedCaretEl = blockEl.querySelector(".se-caret") ?? null;
      }
    }
    ctx.state.render.lastSelSpans = ctx.state.spans ? ctx.state.spans.map((s) => ({ ...s })) : null;
  }

  private paintAllLines(): void {
    const model = this.ctx.state.model;
    if (model.blocks.length >= IDLE_PAINT_MIN_BLOCKS) {
      this.beginChunkedPaint(model);
      return;
    }
    this.paintAllLinesSync(model);
  }

  private beginChunkedPaint(target: SSMLModel): void {
    const { ctx } = this;
    const epoch = ++ctx.state.render.paintEpoch;
    if (ctx.state.render.idlePaintCancel) {
      ctx.state.render.idlePaintCancel();
      ctx.state.render.idlePaintCancel = null;
    }
    ctx.state.render.paintingChunks = true;
    ctx.content.replaceChildren();
    const els = new Map<string, HTMLElement>();
    const text = new Map<string, string>();
    const vnodesMap = new Map<string, VNode[]>();
    const domRefs = new Map<string, VNodeDomRefs>();
    const renderCtx = this.blockRenderCtx();
    const blocks = target.blocks;
    let i = 0;

    const step = (): void => {
      if (epoch !== ctx.state.render.paintEpoch || !ctx.state.render.paintingChunks) {
        return;
      }
      if (ctx.state.model !== target) {
        ctx.state.render.paintingChunks = false;
        ctx.state.render.idlePaintCancel = null;
        ctx.state.render.contentDirty = true;
        this.render();
        return;
      }
      const frag = document.createDocumentFragment();
      const started = performance.now();
      let built = 0;
      while (i < blocks.length) {
        const block = blocks[i];
        const vns = buildBlockVNodes(renderCtx, block);
        const p = document.createElement("p");
        p.className = "se-line";
        p.setAttribute("data-block-id", block.id);
        p.append(...materializeVNodes(vns));
        frag.appendChild(p);
        els.set(block.id, p);
        text.set(block.id, block.text);
        vnodesMap.set(block.id, vns);
        domRefs.set(block.id, buildBlockDomRefs(vns, p));
        i++;
        built++;
        if (built >= IDLE_PAINT_CHUNK) {
          break;
        }
        if ((built & 63) === 0 && performance.now() - started > IDLE_PAINT_BUDGET_MS) {
          break;
        }
      }
      if (frag.childNodes.length > 0) {
        ctx.content.appendChild(frag);
      }

      if (i < blocks.length) {
        ctx.state.render.idlePaintCancel = scheduleIdle(step, IDLE_PAINT_TIMEOUT_MS);
        return;
      }

      ctx.state.render.paintingChunks = false;
      ctx.state.render.idlePaintCancel = null;
      ctx.state.render.paintedEls = els;
      ctx.state.render.paintedText = text;
      ctx.state.render.paintedVNodes = vnodesMap;
      ctx.state.render.paintedDomRefs = domRefs;
      ctx.state.render.paintedAnn = groupAnnotations(target.annotations);
      ctx.state.render.paintedHints = groupHints(target.hints ?? []);
      ctx.state.render.paintedModel = target;
      ctx.state.render.paintedAnnList = target.annotations;
      ctx.state.render.paintedHintList = target.hints ?? null;
      ctx.state.render.paintedEmpty = false;
      ctx.state.render.forceFullRender = false;
      ctx.state.render.lastSelSpans = ctx.state.spans
        ? ctx.state.spans.map((s) => ({ ...s }))
        : null;
      ctx.state.render.paintedCaretEl = ctx.content.querySelector(".se-caret") ?? null;
      ctx.state.render.contentDirty = true;
      this.render();
    };

    ctx.state.render.idlePaintCancel = scheduleIdle(step, IDLE_PAINT_TIMEOUT_MS);
  }

  private paintAllLinesSync(model: SSMLModel): void {
    const { ctx } = this;
    const empty = isEmptyModel(model);
    const frag = document.createDocumentFragment();
    if (empty && ctx.placeholder) {
      const ph = document.createElement("div");
      ph.className = "se-placeholder";
      ph.textContent = ctx.placeholder;
      frag.appendChild(ph);
    }
    const els = new Map<string, HTMLElement>();
    const text = new Map<string, string>();
    const vnodesMap = new Map<string, VNode[]>();
    const domRefs = new Map<string, VNodeDomRefs>();
    const anns = groupAnnotations(model.annotations);
    const hints = groupHints(model.hints ?? []);
    const renderCtx = this.blockRenderCtx();
    for (const block of model.blocks) {
      const vns = buildBlockVNodes(renderCtx, block);
      const p = document.createElement("p");
      p.className = "se-line";
      p.setAttribute("data-block-id", block.id);
      p.append(...materializeVNodes(vns));
      frag.appendChild(p);
      els.set(block.id, p);
      text.set(block.id, block.text);
      vnodesMap.set(block.id, vns);
      domRefs.set(block.id, buildBlockDomRefs(vns, p));
    }
    ctx.content.replaceChildren(frag);
    ctx.state.render.paintedEls = els;
    ctx.state.render.paintedText = text;
    ctx.state.render.paintedVNodes = vnodesMap;
    ctx.state.render.paintedDomRefs = domRefs;
    ctx.state.render.paintedAnn = anns;
    ctx.state.render.paintedHints = hints;
    ctx.state.render.paintedModel = model;
    ctx.state.render.paintedAnnList = model.annotations;
    ctx.state.render.paintedHintList = model.hints ?? null;
    ctx.state.render.paintedEmpty = empty;
    ctx.state.render.forceFullRender = false;
    ctx.state.render.lastSelSpans = ctx.state.spans ? ctx.state.spans.map((s) => ({ ...s })) : null;
    ctx.state.render.paintedCaretEl = ctx.content.querySelector(".se-caret") ?? null;
  }

  private rebuildDirtyLines(model: SSMLModel, dirty: Set<string>): void {
    if (dirty.size === 0) {
      return;
    }
    const { ctx } = this;
    const els = ctx.state.render.paintedEls!;
    const paintedVNs = ctx.state.render.paintedVNodes;
    const domRefs = ctx.state.render.paintedDomRefs;
    const renderCtx = this.blockRenderCtx();
    for (const block of model.blocks) {
      if (dirty.has(block.id)) {
        const el = els.get(block.id);
        if (el) {
          const prev = paintedVNs?.get(block.id);
          const next = buildBlockVNodes(renderCtx, block);
          if (prev) {
            diffBlockChildren(prev, next, el);
          } else {
            el.replaceChildren(...materializeVNodes(next));
          }
          paintedVNs?.set(block.id, next);
          domRefs?.set(block.id, buildBlockDomRefs(next, el));
        }
      }
    }
  }

  private reconcileLines(model: SSMLModel, dirty: Set<string>): void {
    const { ctx } = this;
    const content = ctx.content;
    const live = new Set(model.blocks.map((b) => b.id));
    const els = ctx.state.render.paintedEls!;
    const paintedVNs = ctx.state.render.paintedVNodes;
    const domRefs = ctx.state.render.paintedDomRefs;
    for (const [id, el] of els) {
      if (!live.has(id)) {
        el.remove();
        els.delete(id);
        ctx.state.render.paintedText!.delete(id);
        ctx.state.render.paintedAnn!.delete(id);
        ctx.state.render.paintedHints!.delete(id);
        paintedVNs?.delete(id);
        domRefs?.delete(id);
      }
    }

    const renderCtx = this.blockRenderCtx();
    let prev: HTMLElement | null = null;
    for (const block of model.blocks) {
      let el = els.get(block.id);
      if (!el) {
        el = document.createElement("p");
        el.className = "se-line";
        el.setAttribute("data-block-id", block.id);
        els.set(block.id, el);
        dirty.add(block.id);
      }
      if (dirty.has(block.id)) {
        const prevVNs = paintedVNs?.get(block.id);
        const next = buildBlockVNodes(renderCtx, block);
        if (prevVNs) {
          diffBlockChildren(prevVNs, next, el);
        } else {
          el.replaceChildren(...materializeVNodes(next));
        }
        paintedVNs?.set(block.id, next);
        domRefs?.set(block.id, buildBlockDomRefs(next, el));
      }
      const atPos =
        el.parentElement === content &&
        (prev === null ? content.firstElementChild === el : prev.nextElementSibling === el);
      if (!atPos) {
        content.insertBefore(el, prev ? prev.nextElementSibling : content.firstElementChild);
      }
      prev = el;
    }
    for (const child of Array.from(content.children)) {
      if (
        child.classList.contains("se-line") &&
        !live.has((child as HTMLElement).getAttribute("data-block-id") ?? "")
      ) {
        child.remove();
      }
    }
  }

  renderFloating(): void {
    const { ctx } = this;
    const fl = this.ensureFloatLayer();
    fl.replaceChildren();

    if (ctx.state.overlays.bracketTooltip) {
      const { ann, rect } = ctx.state.overlays.bracketTooltip;
      const live = ctx.container.querySelector<HTMLElement>(
        `.se-break[data-ann-id="${CSS.escape(ann.id)}"], .se-bracket[data-ann-id="${CSS.escape(
          ann.id,
        )}"]`,
      );
      fl.appendChild(buildBracketTooltip(ann, live?.getBoundingClientRect() ?? rect));
    }

    if (ctx.state.overlays.hoveredHint) {
      let h = ctx.state.overlays.hoveredHint;
      if (!h.el.isConnected) {
        const blockId = h.el.getAttribute("data-block-id");
        const selector = blockId
          ? `.se-hint-group[data-block-id="${CSS.escape(blockId)}"][data-hint="${CSS.escape(
              h.text,
            )}"]`
          : `[data-hint="${CSS.escape(h.text)}"]`;
        const fresh = ctx.container.querySelector<HTMLElement>(selector);
        if (fresh) {
          h = { ...h, el: fresh };
          ctx.state.overlays.hoveredHint = h;
        }
      }
      if (h.el.isConnected) {
        fl.appendChild(buildHintTooltip(h));
      }
    }

    if (ctx.state.overlays.overlapPrompt) {
      fl.appendChild(
        buildOverlapDialog(ctx.state.overlays.overlapPrompt, {
          onCancel: () => ctx.actions.handleOverlapCancel(),
          onSplit: () => ctx.actions.handleOverlapSplit(),
          onReplace: () => ctx.actions.handleOverlapReplace(),
        }),
      );
    }

    if (ctx.state.overlays.crossBoundaryPrompt) {
      fl.appendChild(
        buildCrossBoundaryDialog(ctx.state.overlays.crossBoundaryPrompt, {
          onDismiss: () => ctx.actions.handleCrossBoundaryDismiss(),
        }),
      );
    }
  }
}
