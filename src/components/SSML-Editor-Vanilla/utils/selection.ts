/**
 * Selection <-> code point offset conversion.
 * The DOM is a flat per-char span tree ([data-block-id] > [data-char-idx]),
 * so a selection can always be resolved into in-block ranges.

 */
import { type CharPos, type SelectionSpan } from "../types";
export type { CharPos, SelectionSpan };

const CHAR_ATTR = "data-char-idx";
const BLOCK_ATTR = "data-block-id";
const FULL = Number.MAX_SAFE_INTEGER;

/** Deep-equal two selection span lists (same order). */
export function spansEqual(a: SelectionSpan[] | null, b: SelectionSpan[] | null): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b || a.length !== b.length) {
    return false;
  }
  return a.every((s, i) => {
    const o = b[i];
    return !!o && s.blockId === o.blockId && s.start === o.start && s.end === o.end;
  });
}

interface BlockPos {
  blockId: string;
  idx: number;
  el: HTMLElement;
}

/** Char element -> its code point index and enclosing block element. */
function posOf(el: Element, adjust: 0 | 1): BlockPos | null {
  const idx = Number(el.getAttribute(CHAR_ATTR));
  const blockEl = el.closest<HTMLElement>(`[${BLOCK_ATTR}]`);
  if (!blockEl) {
    return null;
  }
  return { blockId: blockEl.getAttribute(BLOCK_ATTR) ?? "", idx: idx + adjust, el: blockEl };
}

/** First char element inside (or being) the node */
function firstCharIn(node: Node): HTMLElement | null {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    if (el.hasAttribute?.(CHAR_ATTR)) {
      return el as HTMLElement;
    }
    return el.querySelector<HTMLElement>(`[${CHAR_ATTR}]`);
  }
  return node.parentElement?.closest<HTMLElement>(`[${CHAR_ATTR}]`) ?? null;
}

/** Last char element inside (or being) the node */
function lastCharIn(node: Node): HTMLElement | null {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    if (el.hasAttribute?.(CHAR_ATTR)) {
      return el as HTMLElement;
    }
    const chars = el.querySelectorAll<HTMLElement>(`[${CHAR_ATTR}]`);
    return chars.length > 0 ? chars[chars.length - 1] : null;
  }
  return node.parentElement?.closest<HTMLElement>(`[${CHAR_ATTR}]`) ?? null;
}

function resolveCharPos(node: Node, offset: number): BlockPos | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const el = node.parentElement?.closest<HTMLElement>(`[${CHAR_ATTR}]`);
    if (!el) {
      return null;
    }
    return posOf(el, offset >= 1 ? 1 : 0);
  }
  const el = node as Element;
  if (el.hasAttribute?.(CHAR_ATTR)) {
    return posOf(el, offset >= 1 ? 1 : 0);
  }
  if (!el.childNodes) {
    return null;
  }
  const kids = el.childNodes;
  for (let i = Math.min(offset, kids.length); i < kids.length; i++) {
    const c = firstCharIn(kids[i]);
    if (c) {
      const pos = posOf(c, 0);
      if (pos) {
        return pos;
      }
    }
  }
  for (let i = Math.min(offset, kids.length) - 1; i >= 0; i--) {
    const c = lastCharIn(kids[i]);
    if (c) {
      const pos = posOf(c, 1);
      if (pos) {
        return pos;
      }
    }
  }
  return null;
}

/**
 * Reference implementation used only as a fallback when the DOM does not
 * match the flat [data-block-id] sibling layout the editor maintains
 * (e.g. future nesting) — resolves the same spans with a container scan.
 */
function spansByFullScan(
  container: HTMLElement,
  head: BlockPos,
  tail: BlockPos,
): SelectionSpan[] | null {
  const blocks = Array.from(container.querySelectorAll<HTMLElement>(`[${BLOCK_ATTR}]`));
  const order = new Map(blocks.map((el, i) => [el.getAttribute(BLOCK_ATTR), i]));
  const orderOf = (id: string) => order.get(id) ?? -1;
  const startBeforeEnd =
    orderOf(head.blockId) < orderOf(tail.blockId) ||
    (orderOf(head.blockId) === orderOf(tail.blockId) && head.idx <= tail.idx);
  const s = startBeforeEnd ? { start: head, end: tail } : { start: tail, end: head };
  const spans: SelectionSpan[] = [];
  const push = (blockId: string, start: number, end: number): void => {
    if (start < end) {
      spans.push({ blockId, start, end });
    }
  };
  if (s.start.blockId === s.end.blockId) {
    push(s.start.blockId, s.start.idx, s.end.idx);
    return spans.length > 0 ? spans : null;
  }
  let active = false;
  for (const el of blocks) {
    const id = el.getAttribute(BLOCK_ATTR)!;
    if (id === s.start.blockId) {
      active = true;
      push(id, s.start.idx, FULL);
      continue;
    }
    if (id === s.end.blockId) {
      active = true;
      push(id, 0, s.end.idx);
      break;
    }
    if (active) {
      push(id, 0, FULL);
    }
  }
  return spans.length > 0 ? spans : null;
}

export function inSel(i: number, spans: SelectionSpan[] | null, blockId: string): boolean {
  if (!spans) {
    return false;
  }
  return spans.some((s) => s.blockId === blockId && i >= s.start && i < s.end);
}

export function getSelectionSpans(container: HTMLElement): SelectionSpan[] | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
    return null;
  }
  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) {
    return null;
  }

  const start = resolveCharPos(range.startContainer, range.startOffset);
  const end = resolveCharPos(range.endContainer, range.endOffset);
  if (!start || !end) {
    return null;
  }
  if (start.el === end.el) {
    const lo = Math.min(start.idx, end.idx);
    const hi = Math.max(start.idx, end.idx);
    return lo < hi ? [{ blockId: start.blockId, start: lo, end: hi }] : null;
  }

  let head = start;
  let tail = end;
  const cmp = start.el.compareDocumentPosition(end.el);
  if ((cmp & Node.DOCUMENT_POSITION_FOLLOWING) === 0) {
    if ((cmp & Node.DOCUMENT_POSITION_PRECEDING) === 0) {
      return spansByFullScan(container, start, end);
    }
    head = end;
    tail = start;
  }

  const middle: SelectionSpan[] = [];
  let el: Element | null = head.el.nextElementSibling;
  while (el && el !== tail.el) {
    if (el.hasAttribute(BLOCK_ATTR)) {
      middle.push({ blockId: el.getAttribute(BLOCK_ATTR)!, start: 0, end: FULL });
    }
    el = el.nextElementSibling;
  }
  if (el !== tail.el) {
    return spansByFullScan(container, start, end);
  }
  const spans: SelectionSpan[] = [];
  if (head.idx < FULL) {
    spans.push({ blockId: head.blockId, start: head.idx, end: FULL });
  }
  spans.push(...middle);
  if (tail.idx > 0) {
    spans.push({ blockId: tail.blockId, start: 0, end: tail.idx });
  }
  return spans.length > 0 ? spans : null;
}
