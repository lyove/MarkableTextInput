/**
 * Declarative virtual-DOM layer for block rendering.
 */
import type { AnnotationType, ModelHint, SSMLAnnotation, SSMLBlock } from "../types";
import { inSel } from "../utils/selection";
import { defaultPinyinFormatsForText } from "../utils/pinyin";
import { rangeFeatureEnabled, type BlockRenderCtx, type BracketSlot } from "./block-render";

// ---------------------------------------------------------------------------
// VNode type system
// ---------------------------------------------------------------------------

export type VNodeType = "char" | "bracket" | "break" | "caret" | "composing" | "hint-group";

interface VNodeBase {
  type: VNodeType;
}

export interface CharVNode extends VNodeBase {
  type: "char";
  /** Code-point index within the block text */
  charIdx: number;
  /** The character itself */
  char: string;
  /** CSS classes (e.g. "se-ch se-sel se-py") */
  classes: string[];
  /**
   * Phoneme display data */
  phoneme?: { annId: string; val: string; tone: string };
  /** Hovered annotation type, if this char is inside a hovered range */
  hoverType?: string;
}

export interface BracketVNode extends VNodeBase {
  type: "bracket";
  annId: string;
  annType: AnnotationType;
  side: "left" | "right";
  start: number;
  end: number;
  classes: string[];
}

export interface BreakVNode extends VNodeBase {
  type: "break";
  annId: string;
  /** Code-point offset where the break sits */
  pos: number;
  classes: string[];
}

export interface CaretVNode extends VNodeBase {
  type: "caret";
}

export interface ComposingVNode extends VNodeBase {
  type: "composing";
  text: string;
}

export interface HintGroupVNode extends VNodeBase {
  type: "hint-group";
  blockId: string;
  hint: string;
  start: number;
  end: number;
  children: VNode[];
}

export type VNode =
  | CharVNode
  | BracketVNode
  | BreakVNode
  | CaretVNode
  | ComposingVNode
  | HintGroupVNode;

/** Stable key for diffing — two VNodes with the same key represent the same logical node. */
export function vnodeKey(vn: VNode): string {
  switch (vn.type) {
    case "char":
      return `ch:${vn.charIdx}`;
    case "bracket":
      return `br:${vn.annId}:${vn.side}`;
    case "break":
      return `bk:${vn.annId}`;
    case "caret":
      return "caret";
    case "composing":
      return "comp";
    case "hint-group":
      return `hg:${vn.start}`;
  }
}

// ---------------------------------------------------------------------------
// SVG constant for break marks (reused — never varies between VNodes)
// ---------------------------------------------------------------------------

const BREAK_SVG_HTML =
  '<svg viewBox="0 0 24 24" class="se-break-svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 4v16"></path><path d="M9 5.5v13" stroke-dasharray="2.5 3"></path></svg>';

// ---------------------------------------------------------------------------
// buildBlockVNodes — declarative block description
// ---------------------------------------------------------------------------

const EMPTY_ANN: readonly SSMLAnnotation[] = [];
const EMPTY_HINTS: readonly ModelHint[] = [];
export function buildBlockVNodes(ctx: BlockRenderCtx, block: SSMLBlock): VNode[] {
  const out: VNode[] = [];
  const chars = Array.from(block.text);
  const cursorInBlock = ctx.cursor?.blockId === block.id ? ctx.cursor.idx : null;

  const anns = ctx.annsByBlock.get(block.id) ?? EMPTY_ANN;
  const breakAt = new Map<number, SSMLAnnotation>();
  for (const b of anns) {
    if (b.type === "break") {
      breakAt.set(b.start, b);
    }
  }

  // Hint lookups — monotonic pointer for O(1) amortised per-char query
  const hintList: readonly ModelHint[] = ctx.Features.hint
    ? ctx.hintsByBlock.get(block.id) ?? EMPTY_HINTS
    : EMPTY_HINTS;
  let hintPtr = 0;
  const hintTextAt = (i: number): string | null => {
    if (hintList.length === 0) return null;
    while (hintPtr < hintList.length && hintList[hintPtr].end <= i) hintPtr++;
    const h = hintList[hintPtr];
    return h && i >= h.start ? h.text : null;
  };

  // Phoneme lookups
  const phonemeList = ctx.Features.phoneme.enabled
    ? anns.filter((a) => a.type === "phoneme").sort((a, b) => a.start - b.start)
    : [];
  let phonemePtr = 0;
  const phonemeAt = (i: number): SSMLAnnotation | null => {
    if (phonemeList.length === 0) return null;
    while (phonemePtr < phonemeList.length && phonemeList[phonemePtr].end <= i) phonemePtr++;
    const a = phonemeList[phonemePtr];
    return a && i >= a.start ? a : null;
  };

  const autoReadings =
    ctx.Features.phoneme.enabled && ctx.Features.phoneme.showAll
      ? defaultPinyinFormatsForText(block.text)
      : null;

  // Bracket system
  const bracketsAt = new Map<number, BracketSlot[]>();
  const rangedAnns = anns.filter(
    (a) => a.type !== "break" && a.type !== "phoneme" && rangeFeatureEnabled(ctx.Features, a.type),
  );
  for (const a of rangedAnns) {
    for (const side of ["left", "right"] as const) {
      const pos = side === "left" ? a.start : a.end;
      const arr = bracketsAt.get(pos) ?? [];
      arr.push({ ann: a, side });
      bracketsAt.set(pos, arr);
    }
  }
  const sortBracketSlots = (slots: BracketSlot[]): BracketSlot[] => {
    return [...slots].sort((a, b) => {
      if (a.side !== b.side) return a.side === "right" ? -1 : 1;
      const lenA = a.ann.end - a.ann.start;
      const lenB = b.ann.end - b.ann.start;
      return a.side === "left" ? lenB - lenA : lenA - lenB;
    });
  };

  const hoveredAnn = ctx.hoveredPairId
    ? anns.find((a) => a.id === ctx.hoveredPairId && a.start < a.end)
    : null;
  const hoverRange =
    hoveredAnn && hoveredAnn.type !== "break"
      ? { start: hoveredAnn.start, end: hoveredAnn.end }
      : null;

  // ---- VNode factories (pure data, no DOM) ----

  const makeBracket = (ann: SSMLAnnotation, side: "left" | "right"): BracketVNode => {
    const isHovered = ctx.hoveredPairId === ann.id;
    const editable = !ctx.readOnly && rangeFeatureEnabled(ctx.Features, ann.type);
    const overlapsSelection =
      ctx.spans &&
      ctx.spans.some((s) => s.blockId === block.id && ann.start < s.end && ann.end > s.start);
    const classes = [
      "se-bracket",
      `se-bracket--${ann.type}`,
      `se-bracket--${side}`,
      isHovered ? "se-bracket--hovered" : "",
      editable ? "" : "se-bracket--ro",
      overlapsSelection ? "se-sel" : "",
    ].filter(Boolean);
    return {
      type: "bracket",
      annId: ann.id,
      annType: ann.type,
      side,
      start: ann.start,
      end: ann.end,
      classes,
    };
  };

  const makeCaret = (): CaretVNode => ({ type: "caret" });

  const makeComposing = (text: string): ComposingVNode => ({ type: "composing", text });

  const pushCaret = (i: number) => {
    if (cursorInBlock === i) {
      if (ctx.composingText) out.push(makeComposing(ctx.composingText));
      out.push(makeCaret());
    }
  };

  const makeCharSpan = (i: number, hinted: boolean): CharVNode => {
    const ch = chars[i];
    const py = phonemeAt(i);
    const hoveredType =
      hoverRange !== null && i >= hoverRange.start && i < hoverRange.end
        ? hoveredAnn?.type ?? ""
        : "";
    let phoneme: CharVNode["phoneme"];
    if (py) {
      phoneme = {
        annId: py.id,
        val: py.attrs.val ?? "",
        tone: py.attrs.tone ?? "",
      };
    } else if (autoReadings) {
      const r = autoReadings[i];
      if (r) {
        phoneme = { annId: "", val: r.val, tone: r.tone };
      }
    }
    const classes = [
      "se-ch",
      hoveredType ? "se-ch--bracket-hover" : "",
      inSel(i, ctx.spans, block.id) ? "se-sel" : "",
      phoneme ? "se-py" : "",
      hinted ? "se-hinted" : "",
    ].filter(Boolean);
    const vn: CharVNode = {
      type: "char",
      charIdx: i,
      char: ch,
      classes,
    };
    if (hoveredType) vn.hoverType = hoveredType;
    if (phoneme) {
      vn.phoneme = phoneme;
    }
    return vn;
  };

  const makeBreak = (bk: SSMLAnnotation, pos: number): BreakVNode => {
    const editable = !ctx.readOnly && ctx.Features.break;
    const classes = [
      "se-break",
      inSel(pos, ctx.spans, block.id) ? "se-sel" : "",
      editable ? "" : "se-break--ro",
    ].filter(Boolean);
    return { type: "break", annId: bk.id, pos, classes };
  };

  let i = 0;
  while (i < chars.length) {
    const bracketSlots = bracketsAt.get(i);
    if (bracketSlots) {
      const rights = bracketSlots.filter((s) => s.side === "right");
      if (rights.length > 0) {
        for (const slot of sortBracketSlots(rights)) {
          out.push(makeBracket(slot.ann, slot.side));
        }
      }
    }

    const bk = breakAt.get(i);
    const breakActive = !!bk && ctx.Features.break;
    if (breakActive) {
      pushCaret(i);
      out.push(makeBreak(bk, i));
    }

    if (bracketSlots) {
      const lefts = bracketSlots.filter((s) => s.side === "left");
      if (lefts.length > 0) {
        for (const slot of sortBracketSlots(lefts)) {
          out.push(makeBracket(slot.ann, slot.side));
        }
      }
    }

    if (!breakActive) {
      pushCaret(i);
    }

    const hint = hintTextAt(i);
    if (hint) {
      let j = i + 1;
      while (j < chars.length && hintTextAt(j) === hint) j++;
      const children: VNode[] = [];
      for (let k = i; k < j; k++) {
        if (k > i && cursorInBlock === k) {
          if (ctx.composingText) children.push(makeComposing(ctx.composingText));
          children.push(makeCaret());
        }
        children.push(makeCharSpan(k, true));
      }
      out.push({
        type: "hint-group",
        blockId: block.id,
        hint,
        start: i,
        end: j,
        children,
      });
      i = j;
    } else {
      out.push(makeCharSpan(i, false));
      i++;
    }
  }

  const trailing = bracketsAt.get(chars.length);
  if (trailing) {
    for (const slot of sortBracketSlots(trailing)) {
      out.push(makeBracket(slot.ann, slot.side));
    }
  }
  const tailBreak = breakAt.get(chars.length);
  if (tailBreak && ctx.Features.break) {
    pushCaret(chars.length);
    out.push(makeBreak(tailBreak, chars.length));
  } else {
    pushCaret(chars.length);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Materialization: VNode → DOM
// ---------------------------------------------------------------------------

/** Create the caret span element (shared with block-render.ts). */
function createCaretSpan(): HTMLSpanElement {
  const c = document.createElement("span");
  c.className = "se-caret";
  return c;
}

/** Create the IME composition mirror span. */
function createComposingSpan(text: string): HTMLSpanElement {
  const c = document.createElement("span");
  c.className = "se-composing";
  c.textContent = text;
  return c;
}

/** Convert a single VNode to a real DOM node (recursive for hint groups). */
export function materializeVNode(vn: VNode): Node {
  switch (vn.type) {
    case "char": {
      const span = document.createElement("span");
      span.className = vn.classes.join(" ");
      if (vn.hoverType) span.setAttribute("data-hover-type", vn.hoverType);
      span.setAttribute("data-char-idx", String(vn.charIdx));
      if (vn.phoneme) {
        span.setAttribute("data-ann-id", vn.phoneme.annId);
        span.setAttribute("data-ann-type", "phoneme");
        span.setAttribute("data-val", vn.phoneme.val);
        span.setAttribute("data-tone", vn.phoneme.tone);
        const line = document.createElement("span");
        line.className = "se-py-line";
        line.textContent = vn.phoneme.val;
        span.appendChild(line);
      }
      span.appendChild(document.createTextNode(vn.char));
      return span;
    }
    case "bracket": {
      const span = document.createElement("span");
      span.className = vn.classes.join(" ");
      span.setAttribute("data-ann-id", vn.annId);
      span.setAttribute("data-side", vn.side);
      span.setAttribute("data-ann-type", vn.annType);
      span.setAttribute("data-ann-start", String(vn.start));
      span.setAttribute("data-ann-end", String(vn.end));
      span.setAttribute("aria-label", `${vn.annType} ${vn.side === "left" ? "start" : "end"}`);
      return span;
    }
    case "break": {
      const span = document.createElement("span");
      span.className = vn.classes.join(" ");
      span.setAttribute("data-ann-id", vn.annId);
      span.setAttribute("data-pos", String(vn.pos));
      span.innerHTML = BREAK_SVG_HTML;
      return span;
    }
    case "caret":
      return createCaretSpan();
    case "composing":
      return createComposingSpan(vn.text);
    case "hint-group": {
      const group = document.createElement("span");
      group.className = "se-hint-group";
      group.setAttribute("data-block-id", vn.blockId);
      group.setAttribute("data-hint", vn.hint);
      group.setAttribute("data-hint-start", String(vn.start));
      group.setAttribute("data-hint-end", String(vn.end));
      for (const child of vn.children) {
        group.appendChild(materializeVNode(child));
      }
      return group;
    }
  }
}

/** Materialize a list of VNodes to an array of DOM nodes. */
export function materializeVNodes(vnodes: VNode[]): Node[] {
  return vnodes.map(materializeVNode);
}

// ---------------------------------------------------------------------------
// Keyed reconciliation: diff + patch
// ---------------------------------------------------------------------------

/** Patch an existing DOM element in-place to match the new VNode (same key). */
function patchVNode(prev: VNode, next: VNode, el: HTMLElement): void {
  switch (next.type) {
    case "char": {
      const newCls = next.classes.join(" ");
      if (el.className !== newCls) {
        el.className = newCls;
      }

      if (next.hoverType) {
        if (el.getAttribute("data-hover-type") !== next.hoverType) {
          el.setAttribute("data-hover-type", next.hoverType);
        }
      } else if (el.hasAttribute("data-hover-type")) {
        el.removeAttribute("data-hover-type");
      }

      const idxStr = String(next.charIdx);
      if (el.getAttribute("data-char-idx") !== idxStr) {
        el.setAttribute("data-char-idx", idxStr);
      }

      // Phoneme: update or add/remove the .se-py-line child
      const pyLine = el.querySelector(".se-py-line");
      if (next.phoneme) {
        if (el.getAttribute("data-ann-id") !== next.phoneme.annId) {
          el.setAttribute("data-ann-id", next.phoneme.annId);
        }
        if (el.getAttribute("data-ann-type") !== "phoneme") {
          el.setAttribute("data-ann-type", "phoneme");
        }
        if (el.getAttribute("data-val") !== next.phoneme.val) {
          el.setAttribute("data-val", next.phoneme.val);
        }
        if (el.getAttribute("data-tone") !== next.phoneme.tone) {
          el.setAttribute("data-tone", next.phoneme.tone);
        }
        if (pyLine) {
          if (pyLine.textContent !== next.phoneme.val) {
            pyLine.textContent = next.phoneme.val;
          }
        } else {
          const line = document.createElement("span");
          line.className = "se-py-line";
          line.textContent = next.phoneme.val;
          el.insertBefore(line, el.firstChild);
        }
      } else {
        if (el.hasAttribute("data-ann-id")) {
          el.removeAttribute("data-ann-id");
        }
        if (el.hasAttribute("data-ann-type")) {
          el.removeAttribute("data-ann-type");
        }
        if (el.hasAttribute("data-val")) {
          el.removeAttribute("data-val");
        }
        if (el.hasAttribute("data-tone")) {
          el.removeAttribute("data-tone");
        }
        if (pyLine) {
          pyLine.remove();
        }
      }

      const textNode = el.lastChild;
      if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        if (textNode.textContent !== next.char) {
          textNode.textContent = next.char;
        }
      } else {
        el.appendChild(document.createTextNode(next.char));
      }
      break;
    }
    case "bracket": {
      const bracket = next as BracketVNode;
      const newCls = bracket.classes.join(" ");
      if (el.className !== newCls) {
        el.className = newCls;
      }
      el.setAttribute("data-ann-id", bracket.annId);
      el.setAttribute("data-ann-type", bracket.annType);
      el.setAttribute("data-side", bracket.side);
      el.setAttribute("data-ann-start", String(bracket.start));
      el.setAttribute("data-ann-end", String(bracket.end));
      el.setAttribute(
        "aria-label",
        `${bracket.annType} ${bracket.side === "left" ? "start" : "end"}`,
      );
      break;
    }
    case "break": {
      const breakVNode = next as BreakVNode;
      const newCls = breakVNode.classes.join(" ");
      if (el.className !== newCls) {
        el.className = newCls;
      }
      el.setAttribute("data-pos", String(breakVNode.pos));
      break;
    }
    case "caret":
      // Ephemeral zero-width marker — nothing to patch.
      break;
    case "composing": {
      const text = (next as ComposingVNode).text;
      if (el.textContent !== text) {
        el.textContent = text;
      }
      break;
    }
    case "hint-group": {
      const prevGroup = prev as HintGroupVNode;
      const nextGroup = next as HintGroupVNode;
      el.setAttribute("data-block-id", nextGroup.blockId);
      el.setAttribute("data-hint", nextGroup.hint);
      el.setAttribute("data-hint-start", String(nextGroup.start));
      el.setAttribute("data-hint-end", String(nextGroup.end));
      diffBlockChildren(prevGroup.children, nextGroup.children, el);
      break;
    }
  }
}

/**
 * Diff two VNode lists and patch the parent's DOM children in-place.
 */
export function diffBlockChildren(prev: VNode[], next: VNode[], parent: HTMLElement): void {
  if (prev.length === next.length) {
    let allMatch = true;
    for (let i = 0; i < prev.length; i++) {
      if (vnodeKey(prev[i]) !== vnodeKey(next[i])) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) {
      const children = parent.children;
      for (let i = 0; i < next.length; i++) {
        const el = children[i];
        if (el instanceof HTMLElement) {
          patchVNode(prev[i], next[i], el);
        }
      }
      return;
    }
  }

  const children = Array.from(parent.children).filter(
    (el): el is HTMLElement => el instanceof HTMLElement,
  );
  const prevElByKey = new Map<string, HTMLElement>();
  const prevVNodeByKey = new Map<string, VNode>();
  for (let i = 0; i < prev.length; i++) {
    const key = vnodeKey(prev[i]);
    const el = children[i];
    if (el) {
      prevElByKey.set(key, el);
      prevVNodeByKey.set(key, prev[i]);
    }
  }

  const used = new Set<string>();
  const nextEls: HTMLElement[] = [];
  for (const nextVNode of next) {
    const key = vnodeKey(nextVNode);
    let el = prevElByKey.get(key);
    if (el && !used.has(key)) {
      used.add(key);
      const prevVNode = prevVNodeByKey.get(key);
      if (prevVNode) {
        patchVNode(prevVNode, nextVNode, el);
      }
    } else {
      el = materializeVNode(nextVNode) as HTMLElement;
    }
    nextEls.push(el);
  }

  const nextElSet = new Set(nextEls);
  for (const oldEl of children) {
    if (!nextElSet.has(oldEl)) {
      oldEl.remove();
    }
  }
  for (const el of nextEls) {
    parent.appendChild(el);
  }
}

// ---------------------------------------------------------------------------
// Caret placement: VNode-based caret ref
// ---------------------------------------------------------------------------

export interface CaretDomRef {
  parent: HTMLElement;
  refNode: Node | null;
}

/**
 * Build VNodes for a block and find where the caret's DOM element should be
 * inserted so it matches what a full `buildBlockVNodes` + `materializeVNodes`
 * would produce.
 */
export function caretRefFromVNodes(blockEl: HTMLElement, vnodes: VNode[]): CaretDomRef | null {
  for (let i = 0; i < vnodes.length; i++) {
    const vn = vnodes[i];

    if (vn.type === "caret") {
      const ref = nextDomSibling(vnodes, i + 1, blockEl);
      return { parent: blockEl, refNode: ref };
    }

    if (vn.type === "hint-group") {
      const groupEl = blockEl.querySelector<HTMLElement>(
        `.se-hint-group[data-hint-start="${vn.start}"]`,
      );
      if (groupEl) {
        for (let j = 0; j < vn.children.length; j++) {
          if (vn.children[j].type === "caret") {
            const ref = nextDomSibling(vn.children, j + 1, groupEl);
            return { parent: groupEl, refNode: ref };
          }
        }
      }
    }
  }
  return null;
}

/**
 * Locate where `buildBlockVNodes` would place the caret for char offset `idx`
 * by walking an ALREADY-BUILT vnode list (the cached per-block array) instead
 * of rebuilding one.
 */
export interface CaretInsertion {
  /** Child list receiving the caret: block top level or hint-group children. */
  list: VNode[];
  /** Insert index within `list`. */
  index: number;
  /** Enclosing hint group, when the caret goes inside one. */
  group: HintGroupVNode | null;
}

export function caretInsertionPoint(vnodes: VNode[], idx: number): CaretInsertion | null {
  let ci = 0;
  for (let p = 0; p < vnodes.length; p++) {
    const vn = vnodes[p];
    switch (vn.type) {
      case "caret":
      case "composing":
        continue;
      case "char":
        if (vn.charIdx === idx) {
          return { list: vnodes, index: p, group: null };
        }
        ci = vn.charIdx + 1;
        continue;
      case "break":
        if (vn.pos === idx) {
          return { list: vnodes, index: p, group: null };
        }
        continue;
      case "hint-group": {
        if (vn.start === idx) {
          return { list: vnodes, index: p, group: null };
        }
        if (idx > vn.start && idx < vn.end) {
          for (let q = 0; q < vn.children.length; q++) {
            const ch = vn.children[q];
            if (ch.type === "char" && ch.charIdx === idx) {
              return { list: vn.children, index: q, group: vn };
            }
          }
          return null;
        }
        ci = vn.end;
        continue;
      }
      case "bracket":
        continue;
    }
  }
  if (idx === ci) {
    return { list: vnodes, index: vnodes.length, group: null };
  }
  return null;
}

// ---------------------------------------------------------------------------
// VNode → element map (cached caret placement support)
// ---------------------------------------------------------------------------

/** Object-keyed vnode → live element association for one block. */
export type VNodeDomRefs = Map<VNode, HTMLElement>;

/**
 * Build a vnode → element map by walking the vnode list alongside the live DOM.  Materialization and the keyed diff fast path both keep
 */
export function buildBlockDomRefs(vnodes: VNode[], root: HTMLElement): VNodeDomRefs {
  const refs: VNodeDomRefs = new Map();
  walkDomRefs(vnodes, root, refs);
  return refs;
}

function walkDomRefs(vnodes: VNode[], parent: HTMLElement, refs: VNodeDomRefs): void {
  const children = parent.children;
  for (let i = 0; i < vnodes.length; i++) {
    const el = children[i];
    if (!(el instanceof HTMLElement)) {
      continue;
    }
    const vn = vnodes[i];
    refs.set(vn, el);
    if (vn.type === "hint-group") {
      walkDomRefs(vn.children, el, refs);
    }
  }
}

/**
 * Find the DOM element that corresponds to the VNode at `index` in `vnodes`,
 * skipping any caret/composing VNodes.  Returns `null` if no such element
 * exists (caret should be appended).
 */
function nextDomSibling(vnodes: VNode[], index: number, parent: HTMLElement): Node | null {
  for (let i = index; i < vnodes.length; i++) {
    const vn = vnodes[i];
    if (vn.type === "caret" || vn.type === "composing") continue;
    return vnodeToDom(vn, parent);
  }
  return null;
}

/** Find the DOM element corresponding to a VNode within `parent`. */
function vnodeToDom(vn: VNode, parent: HTMLElement): Node | null {
  switch (vn.type) {
    case "char":
      return parent.querySelector<HTMLElement>(`[data-char-idx="${vn.charIdx}"]`) ?? null;
    case "bracket":
      return (
        parent.querySelector<HTMLElement>(
          `.se-bracket[data-ann-id="${CSS.escape(vn.annId)}"][data-side="${vn.side}"]`,
        ) ?? null
      );
    case "break":
      return (
        parent.querySelector<HTMLElement>(`.se-break[data-ann-id="${CSS.escape(vn.annId)}"]`) ??
        null
      );
    case "hint-group":
      return (
        parent.querySelector<HTMLElement>(`.se-hint-group[data-hint-start="${vn.start}"]`) ?? null
      );
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Block-level diff (declarative replacement for renderBlocks ad-hoc diff)
// ---------------------------------------------------------------------------

export interface BlockVNode {
  blockId: string;
  text: string;
  children: VNode[];
}

export interface BlockDiff {
  /** Block IDs that exist in `next` but not in `prev`. */
  added: string[];
  /** Block IDs that exist in `prev` but not in `next`. */
  removed: string[];
  /** Block IDs whose content (VNode children) changed. */
  dirty: Set<string>;
  /** True when block count or ordering changed (requires reconcileLines). */
  structural: boolean;
}
