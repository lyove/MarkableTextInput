/**
 * Text editing operations on the annotation document.
 */
import {
  reanchorHintsOnInsertMulti,
  reanchorHintsOnInsertSingle,
  reanchorOnInsertMulti,
  reanchorOnInsertSingle,
  shiftHintsOnDelete,
  shiftHintsOnInsert,
  shiftHintsOnMerge,
  shiftHintsOnSplit,
  shiftOnDelete,
  shiftOnInsert,
  shiftOnMerge,
  shiftOnSplit,
} from "./annotations";
import { blockLen, createBlockId, uid } from "../model/model";
import {
  type Cursor,
  type ModelHint,
  type SelectionSpan,
  type SSMLAnnotation,
  type SSMLBlock,
  type SSMLModel,
} from "../types";

/** Shared shape of anything anchored to a block range (annotations, hints). */
interface CarriableRange {
  id: string;
  blockId: string;
  start: number;
  end: number;
}

/**
 * Copy fully-inside ranges from `source` (same block as `blockId`) into
 * `target`, re-keyed with a globally unique id and re-anchored to `newId`.
 * Used by extractModelSpans — annotations and hints share this exact policy.
 */
function carryCopied<T extends CarriableRange>(
  source: T[],
  blockId: string,
  s: number,
  e: number,
  newId: string,
  target: T[],
): void {
  for (const item of source) {
    if (item.blockId !== blockId || item.start < s || item.end > e) {
      continue;
    }
    target.push({
      ...item,
      id: uid(),
      blockId: newId,
      start: item.start - s,
      end: item.end - s,
    } as T);
  }
}

/**
 * Bring pasted ranges (from a copied model) into `target`, re-keyed with a
 * globally unique id.  `project` decides the destination block and offset;
 * returning null drops the item (orphans not anchored on pasted blocks).
 * Used by insertModelAt — annotations and hints share this exact policy.
 */
function carryPasted<T extends CarriableRange>(
  source: T[],
  target: T[],
  project: (item: T) => { blockId: string; start: number; end: number } | null,
): void {
  for (const item of source) {
    const p = project(item);
    if (!p) {
      continue;
    }
    target.push({ ...item, id: uid(), ...p } as T);
  }
}

/** Insert text (no newlines) at a caret position */
export function insertTextAtCursor(model: SSMLModel, cursor: Cursor, text: string): SSMLModel {
  const bi = model.blocks.findIndex((b) => b.id === cursor.blockId);
  if (bi < 0) {
    return model;
  }
  const len = Array.from(text).length;
  const blocks = [...model.blocks];
  const block = blocks[bi];
  const chars = Array.from(block.text);
  blocks[bi] = {
    ...block,
    text: [...chars.slice(0, cursor.idx), ...Array.from(text), ...chars.slice(cursor.idx)].join(""),
  };
  const annotations = shiftOnInsert(model.annotations, cursor.blockId, cursor.idx, len);
  const hints = shiftHintsOnInsert(model.hints, cursor.blockId, cursor.idx, len);
  return { blocks, annotations, hints };
}

/** Delete one char before (backward) or after the caret; merges blocks at edges */
export function deleteAtCursor(
  model: SSMLModel,
  cursor: Cursor,
  backward: boolean,
): { model: SSMLModel; cursor: Cursor } | null {
  const bi = model.blocks.findIndex((b) => b.id === cursor.blockId);
  if (bi < 0) {
    return null;
  }
  const block = model.blocks[bi];
  const len = blockLen(block);
  if (backward) {
    if (cursor.idx > 0) {
      const chars = Array.from(block.text);
      const blocks = [...model.blocks];
      blocks[bi] = {
        ...block,
        text: [...chars.slice(0, cursor.idx - 1), ...chars.slice(cursor.idx)].join(""),
      };
      const annotations = shiftOnDelete(model.annotations, block.id, cursor.idx - 1, cursor.idx);
      const hints = shiftHintsOnDelete(model.hints, block.id, cursor.idx - 1, cursor.idx);
      return {
        model: { blocks, annotations, hints },
        cursor: { ...cursor, idx: cursor.idx - 1 },
      };
    }
    if (bi === 0) {
      return null;
    }
    const prev = model.blocks[bi - 1];
    const prevLen = blockLen(prev);
    const blocks = [...model.blocks];
    blocks.splice(bi - 1, 2, { id: prev.id, text: prev.text + block.text });
    const annotations = shiftOnMerge(model.annotations, block.id, prev.id, prevLen);
    const hints = shiftHintsOnMerge(model.hints, block.id, prev.id, prevLen);
    return {
      model: { blocks, annotations, hints },
      cursor: { blockId: prev.id, idx: prevLen },
    };
  }

  if (cursor.idx < len) {
    const chars = Array.from(block.text);
    const blocks = [...model.blocks];
    blocks[bi] = {
      ...block,
      text: [...chars.slice(0, cursor.idx), ...chars.slice(cursor.idx + 1)].join(""),
    };
    const annotations = shiftOnDelete(model.annotations, block.id, cursor.idx, cursor.idx + 1);
    const hints = shiftHintsOnDelete(model.hints, block.id, cursor.idx, cursor.idx + 1);
    return { model: { blocks, annotations, hints }, cursor };
  }
  if (bi >= model.blocks.length - 1) {
    return null;
  }
  const next = model.blocks[bi + 1];
  const blocks = [...model.blocks];
  blocks.splice(bi, 2, { id: block.id, text: block.text + next.text });
  const annotations = shiftOnMerge(model.annotations, next.id, block.id, len);
  const hints = shiftHintsOnMerge(model.hints, next.id, block.id, len);
  return { model: { blocks, annotations, hints }, cursor };
}

/** Split the block at the caret (Enter key) */
export function splitBlockAtCursor(
  model: SSMLModel,
  cursor: Cursor,
): { model: SSMLModel; cursor: Cursor } | null {
  const bi = model.blocks.findIndex((b) => b.id === cursor.blockId);
  if (bi < 0) {
    return null;
  }
  const block = model.blocks[bi];
  const chars = Array.from(block.text);
  const rightId = createBlockId();
  const blocks = [...model.blocks];
  blocks.splice(
    bi,
    1,
    { id: block.id, text: chars.slice(0, cursor.idx).join("") },
    {
      id: rightId,
      text: chars.slice(cursor.idx).join(""),
    },
  );
  const annotations = shiftOnSplit(model.annotations, block.id, rightId, cursor.idx);
  const hints = shiftHintsOnSplit(model.hints, block.id, rightId, cursor.idx);
  return {
    model: { blocks, annotations, hints },
    cursor: { blockId: rightId, idx: 0 },
  };
}

/** Remove a set of in-block ranges (selection delete / cut) */
export function removeSpansFromModel(model: SSMLModel, spans: SelectionSpan[]): SSMLModel {
  let next = model;
  let hints = model.hints;
  for (const sp of spans) {
    const bi = next.blocks.findIndex((b) => b.id === sp.blockId);
    if (bi < 0) {
      continue;
    }
    const block = next.blocks[bi];
    const chars = Array.from(block.text);
    const s = Math.max(0, Math.min(sp.start, chars.length));
    const e = Math.max(s, Math.min(sp.end, chars.length));
    if (e <= s) {
      continue;
    }
    const blocks = [...next.blocks];
    blocks[bi] = {
      ...block,
      text: [...chars.slice(0, s), ...chars.slice(e)].join(""),
    };
    const annotations = shiftOnDelete(next.annotations, sp.blockId, s, e);
    hints = shiftHintsOnDelete(hints, sp.blockId, s, e);
    next = { blocks, annotations, hints };
  }
  if (next !== model && next.blocks.length > 1 && next.blocks.every((b) => b.text.length === 0)) {
    return { blocks: [{ id: next.blocks[0].id, text: "" }], annotations: [], hints: [] };
  }
  return next;
}

/** Extract a sub document covered by selection spans (for copy / cut) */
export function extractModelSpans(model: SSMLModel, spans: SelectionSpan[]): SSMLModel {
  const blocks: SSMLBlock[] = [];
  const annotations: SSMLAnnotation[] = [];
  const hints: ModelHint[] = [];
  for (const sp of spans) {
    const block = model.blocks.find((b) => b.id === sp.blockId);
    if (!block) {
      continue;
    }
    const chars = Array.from(block.text);
    const s = Math.max(0, Math.min(sp.start, chars.length));
    const e = Math.max(s, Math.min(sp.end, chars.length));
    if (e <= s) {
      continue;
    }
    const newId = createBlockId();
    blocks.push({ id: newId, text: chars.slice(s, e).join("") });
    carryCopied(model.annotations, sp.blockId, s, e, newId, annotations);
    carryCopied(model.hints, sp.blockId, s, e, newId, hints);
  }
  return { blocks, annotations, hints };
}

interface InsertModelResult {
  model: SSMLModel;
  cursor: Cursor;
}

/**
 * Shared implementation of insertModelAt / insertModelAtWithCursor.  Computes the
 * caret that should follow the inserted content:
 *
 *   - single pasted block: idx + pastedLen (right after the pasted text, i.e.
 *     before the anchor's original tail),
 *   - multi-block paste: the *end of the pasted last block* (the anchor's tail
 *     text is appended after it, so the caret must stop before that tail),
 *   - empty target document: every pasted block becomes the document and the
 *     caret lands at the very end.
 */
function insertModelAtImpl(
  model: SSMLModel,
  blockId: string,
  idx: number,
  pasted: SSMLModel,
): InsertModelResult {
  if (pasted.blocks.length === 0) {
    return { model, cursor: { blockId, idx } };
  }
  if (model.blocks.length === 0) {
    const idMap = new Map<string, string>();
    const blocks: SSMLBlock[] = pasted.blocks.map((b) => {
      const id = createBlockId();
      idMap.set(b.id, id);
      return { id, text: b.text };
    });
    const annotations = pasted.annotations
      .map((a) =>
        idMap.has(a.blockId) ? { ...a, id: uid(), blockId: idMap.get(a.blockId)! } : null,
      )
      .filter((a): a is SSMLAnnotation => a !== null);
    const hints = pasted.hints
      .map((h) =>
        idMap.has(h.blockId) ? { ...h, id: uid(), blockId: idMap.get(h.blockId)! } : null,
      )
      .filter((h): h is ModelHint => h !== null);
    const last = blocks[blocks.length - 1];
    return {
      model: { blocks, annotations, hints },
      cursor: { blockId: last.id, idx: blockLen(last) },
    };
  }

  const bi = model.blocks.findIndex((b) => b.id === blockId);
  if (bi < 0) {
    return { model, cursor: { blockId, idx } };
  }
  const block = model.blocks[bi];
  const chars = Array.from(block.text);
  const head = model.blocks.slice(0, bi);
  const tail = model.blocks.slice(bi + 1);

  if (pasted.blocks.length === 1) {
    const p = pasted.blocks[0];
    const newId = createBlockId();
    const pastedLen = Array.from(p.text).length;
    const blocks = [
      ...head,
      {
        id: newId,
        text: [...chars.slice(0, idx), ...Array.from(p.text), ...chars.slice(idx)].join(""),
      },
      ...tail,
    ];
    const annotations = reanchorOnInsertSingle(model.annotations, blockId, newId, idx, pastedLen);
    const hints = reanchorHintsOnInsertSingle(model.hints, blockId, newId, idx, pastedLen);
    carryPasted(pasted.annotations, annotations, (a) =>
      a.blockId === p.id ? { blockId: newId, start: a.start + idx, end: a.end + idx } : null,
    );
    carryPasted(pasted.hints, hints, (h) =>
      h.blockId === p.id ? { blockId: newId, start: h.start + idx, end: h.end + idx } : null,
    );
    return {
      model: { blocks, annotations, hints },
      cursor: { blockId: newId, idx: idx + pastedLen },
    };
  }

  const first = pasted.blocks[0];
  const last = pasted.blocks[pasted.blocks.length - 1];
  const lastLen = blockLen(last);
  const idMap = new Map<string, string>();
  for (const b of pasted.blocks) {
    idMap.set(b.id, createBlockId());
  }
  const firstId = idMap.get(first.id)!;
  const lastId = idMap.get(last.id)!;
  const blocks: SSMLBlock[] = [
    ...head,
    { id: firstId, text: [...chars.slice(0, idx), ...Array.from(first.text)].join("") },
    ...pasted.blocks.slice(1, -1).map((b) => ({ id: idMap.get(b.id)!, text: b.text })),
    { id: lastId, text: [...Array.from(last.text), ...chars.slice(idx)].join("") },
    ...tail,
  ];
  const annotations = reanchorOnInsertMulti(
    model.annotations,
    blockId,
    firstId,
    lastId,
    idx,
    lastLen,
  );
  const hints = reanchorHintsOnInsertMulti(model.hints, blockId, firstId, lastId, idx, lastLen);
  carryPasted(pasted.annotations, annotations, (a) => {
    const mappedBlockId = idMap.get(a.blockId);
    if (!mappedBlockId) {
      return null;
    }
    const inFirst = a.blockId === first.id;
    return {
      blockId: mappedBlockId,
      start: inFirst ? a.start + idx : a.start,
      end: inFirst ? a.end + idx : a.end,
    };
  });
  carryPasted(pasted.hints, hints, (h) => {
    const mappedBlockId = idMap.get(h.blockId);
    if (!mappedBlockId) {
      return null;
    }
    const inFirst = h.blockId === first.id;
    return {
      blockId: mappedBlockId,
      start: inFirst ? h.start + idx : h.start,
      end: inFirst ? h.end + idx : h.end,
    };
  });
  return {
    model: { blocks, annotations, hints },
    cursor: { blockId: lastId, idx: lastLen },
  };
}

/** Insert a pasted document (possibly multi-block) at a position */
export function insertModelAt(
  model: SSMLModel,
  blockId: string,
  idx: number,
  pasted: SSMLModel,
): SSMLModel {
  return insertModelAtImpl(model, blockId, idx, pasted).model;
}

/** Like insertModelAt, but also reports the caret position after the insert. */
export function insertModelAtWithCursor(
  model: SSMLModel,
  blockId: string,
  idx: number,
  pasted: SSMLModel,
): { model: SSMLModel; cursor: Cursor } {
  return insertModelAtImpl(model, blockId, idx, pasted);
}

export function setBlockHint(
  model: SSMLModel,
  blockId: string,
  start: number,
  end: number,
  text: string,
): SSMLModel {
  const hints = model.hints.filter(
    (h) => !(h.blockId === blockId && h.start === start && h.end === end),
  );
  if (text.length > 0) {
    hints.push({ id: uid(), blockId, start, end, text });
  }
  return { ...model, hints };
}

export function findHint(
  model: SSMLModel,
  blockId: string,
  start: number,
  end: number,
): ModelHint | null {
  for (const h of model.hints) {
    if (h.blockId === blockId && h.start === start && h.end === end) {
      return h;
    }
  }
  return null;
}
