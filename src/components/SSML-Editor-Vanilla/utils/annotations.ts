/**
 * Annotation CRUD and position shifting.
 */
import { uid } from "../model/model";
import { type AnnotationType, type ModelHint, type SSMLAnnotation, type SSMLModel } from "../types";
// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export function findRangeAnnotation(
  model: SSMLModel,
  type: AnnotationType,
  blockId: string,
  start: number,
  end: number,
): SSMLAnnotation | null {
  for (const a of model.annotations) {
    if (a.blockId !== blockId || a.type !== type) {
      continue;
    }
    if (a.start < end && a.end > start) {
      return a;
    }
  }
  return null;
}

/**
 * Conflict detection before inserting a new ranged annotation.
 */
export function findOverlappingAnnotations(
  model: SSMLModel,
  params: {
    type: AnnotationType;
    blockId: string;
    start: number;
    end: number;
    excludeId?: string;
  },
): SSMLAnnotation[] {
  const { type, blockId, start, end, excludeId } = params;
  const out: SSMLAnnotation[] = [];
  if (type === "break") {
    return out;
  }
  const strictSayAs = type === "sayAs";
  for (const a of model.annotations) {
    if (a.blockId !== blockId) {
      continue;
    }
    if (excludeId && a.id === excludeId) {
      continue;
    }
    if (a.type === "break" || (a.type === "phoneme" && type !== "phoneme")) {
      continue;
    }
    if (strictSayAs && a.type !== "sayAs") {
      continue;
    }
    if (!strictSayAs && a.type !== type) {
      continue;
    }
    if (a.start < end && a.end > start) {
      out.push(a);
    }
  }
  return out;
}

/**
 * Cross-boundary overlap detection.
 */
export function findCrossBoundaryAnnotations(
  model: SSMLModel,
  params: {
    type: AnnotationType;
    blockId: string;
    start: number;
    end: number;
    excludeId?: string;
  },
): SSMLAnnotation[] {
  const { type, blockId, start, end, excludeId } = params;
  const out: SSMLAnnotation[] = [];
  for (const a of model.annotations) {
    if (a.blockId !== blockId) {
      continue;
    }
    if (excludeId && a.id === excludeId) {
      continue;
    }
    if (a.type === type) {
      continue;
    }
    if (a.type === "break") {
      continue;
    }
    if (a.type === "phoneme") {
      continue;
    }
    if (a.end <= start || a.start >= end) {
      continue;
    }
    const existingContainsNew = a.start <= start && a.end >= end;
    const newContainsExisting = start <= a.start && end >= a.end;
    if (!existingContainsNew && !newContainsExisting) {
      out.push(a);
    }
  }
  return out;
}

/**
 * Laminar normalization for EXTERNAL data (SSML import / paste / host-built
 * documents).
 */
export function normalizeRangeNesting(annotations: SSMLAnnotation[]): SSMLAnnotation[] {
  const isRange = (a: SSMLAnnotation): boolean => a.type !== "break";
  const ranges = annotations.filter(isRange).map((a) => ({ ...a }));
  let changed = true;
  let guard = 0;
  while (changed && guard < 1000) {
    guard += 1;
    changed = false;
    outer: for (let i = 0; i < ranges.length; i++) {
      for (let j = i + 1; j < ranges.length; j++) {
        const a = ranges[i];
        const b = ranges[j];
        if (a.blockId !== b.blockId) {
          continue;
        }
        if (a.type === "phoneme" || b.type === "phoneme") {
          continue;
        }
        if (a.start >= b.end || b.start >= a.end) {
          continue;
        }
        if (a.start <= b.start && a.end >= b.end) {
          continue;
        }
        if (b.start <= a.start && b.end >= a.end) {
          continue;
        }
        const keepEarlier =
          a.start < b.start || (a.start === b.start && a.end - a.start >= b.end - b.start);
        const outer = keepEarlier ? a : b;
        const inner = keepEarlier ? b : a;
        const groupId = inner.groupId ?? inner.id;
        const pieces: SSMLAnnotation[] = [];
        if (inner.start < outer.start) {
          pieces.push({ ...inner, id: uid(), groupId, start: inner.start, end: outer.start });
        }
        pieces.push({
          ...inner,
          id: uid(),
          groupId,
          start: Math.max(inner.start, outer.start),
          end: Math.min(inner.end, outer.end),
        });
        if (inner.end > outer.end) {
          pieces.push({ ...inner, id: uid(), groupId, start: outer.end, end: inner.end });
        }
        const idx = ranges.indexOf(inner);
        ranges.splice(idx, 1, ...pieces);
        changed = true;
        break outer;
      }
    }
  }
  return [...annotations.filter((a) => a.type === "break"), ...ranges];
}

// ---------------------------------------------------------------------------
// Mutation
// ---------------------------------------------------------------------------

export function addAnnotation(model: SSMLModel, ann: Omit<SSMLAnnotation, "id">): SSMLModel {
  return { ...model, annotations: [...model.annotations, { ...ann, id: uid() }] };
}

export function replaceOverlapsAndAdd(
  model: SSMLModel,
  removeIds: string[],
  ann: Omit<SSMLAnnotation, "id">,
): SSMLModel {
  const drop = new Set(removeIds);
  const annotations = [...model.annotations.filter((a) => !drop.has(a.id)), { ...ann, id: uid() }];
  return { ...model, annotations };
}

/**
 * Shared low-level helper used by both splitOverlapsAndAdd and splitConflictsOnly. 
 */
function sliceConflictAnnotations(
  annotations: SSMLAnnotation[],
  conflicts: SSMLAnnotation[],
  ann: Omit<SSMLAnnotation, "id">,
): SSMLAnnotation[] {
  const splitIds = new Set(conflicts.map((a) => a.id));
  const kept: SSMLAnnotation[] = [];
  for (const a of annotations) {
    if (!splitIds.has(a.id)) {
      kept.push(a);
      continue;
    }
    const groupId = a.groupId ?? a.id;
    const hasPrefix = a.start < ann.start;
    const hasSuffix = a.end > ann.end;
    if (hasPrefix && hasSuffix) {
      kept.push({ ...a, id: uid(), groupId, end: ann.start });
      kept.push({ ...a, id: uid(), groupId, start: ann.end });
    } else if (hasPrefix) {
      kept.push({ ...a, end: ann.start });
    } else if (hasSuffix) {
      kept.push({ ...a, start: ann.end });
    }
  }
  return kept;
}

/**
 * Conflict resolution #2 — SPLIT & MERGE.
 */
export function splitOverlapsAndAdd(
  model: SSMLModel,
  conflicts: SSMLAnnotation[],
  ann: Omit<SSMLAnnotation, "id">,
): SSMLModel {
  const kept = sliceConflictAnnotations(model.annotations, conflicts, ann);
  kept.push({ ...ann, id: uid() });
  return { ...model, annotations: kept };
}

/**
 * Conflict resolution helper — SPLIT ONLY, no new annotation added.
 */
export function splitConflictsOnly(
  model: SSMLModel,
  conflicts: SSMLAnnotation[],
  ann: Omit<SSMLAnnotation, "id">,
): SSMLModel {
  const kept = sliceConflictAnnotations(model.annotations, conflicts, ann);
  return { ...model, annotations: kept };
}

/**
 * Insert or replace an annotation.
 */
export function upsertAnnotation(model: SSMLModel, ann: Omit<SSMLAnnotation, "id">): SSMLModel {
  const conflicts = findOverlappingAnnotations(model, ann);
  if (conflicts.length === 0) {
    return addAnnotation(model, ann);
  }
  const removedIds = conflicts.map((c) => c.id);
  return replaceOverlapsAndAdd(model, removedIds, ann);
}

/** Remove an annotation by id */
export function removeAnnotation(model: SSMLModel, id: string): SSMLModel {
  const annotations = model.annotations.filter((a) => a.id !== id);
  return annotations.length === model.annotations.length ? model : { ...model, annotations };
}

/** Set phoneme reading on a single char */
export function setCharPhoneme(
  model: SSMLModel,
  blockId: string,
  charIdx: number,
  val: string,
  tone: string,
): SSMLModel {
  if (!val) {
    const existing = findRangeAnnotation(model, "phoneme", blockId, charIdx, charIdx + 1);
    return existing ? removeAnnotation(model, existing.id) : model;
  }
  return upsertAnnotation(model, {
    type: "phoneme",
    blockId,
    start: charIdx,
    end: charIdx + 1,
    attrs: { val, tone },
  });
}

// ---------------------------------------------------------------------------
// Position shifting
// ---------------------------------------------------------------------------

interface ShiftableRange {
  id: string;
  blockId: string;
  start: number;
  end: number;
  groupId?: string;
}

/** After inserting len chars at pos inside blockId. */
function shiftOnInsertAny<T extends ShiftableRange>(
  items: T[],
  blockId: string,
  pos: number,
  len: number,
): T[] {
  if (len <= 0) {
    return items;
  }
  return items.map((a) => {
    if (a.blockId !== blockId) {
      return a;
    }
    if (a.start >= pos) {
      return { ...a, start: a.start + len, end: a.end + len } as T;
    }
    if (a.end > pos) {
      return { ...a, end: a.end + len } as T;
    }
    return a;
  });
}

/** After deleting [start, end) inside blockId. */
function shiftOnDeleteAny<T extends ShiftableRange>(
  items: T[],
  blockId: string,
  start: number,
  end: number,
): T[] {
  const len = end - start;
  if (len <= 0) {
    return items;
  }
  const out: T[] = [];
  for (const a of items) {
    if (a.blockId !== blockId) {
      out.push(a);
      continue;
    }
    if (a.end <= start) {
      out.push(a);
      continue;
    }
    if (a.start >= end) {
      out.push({ ...a, start: a.start - len, end: a.end - len } as T); // fully right, shift left
      continue;
    }
    const ns = a.start < start ? a.start : start;
    const ne = a.end > end ? a.end - len : start;
    if (ne > ns) {
      out.push({ ...a, start: ns, end: ne } as T);
    }
  }
  return out;
}

/**
 * After splitting blockId at pos into blockId | rightBlockId.
 */
function shiftOnSplitAny<T extends ShiftableRange>(
  items: T[],
  blockId: string,
  rightBlockId: string,
  pos: number,
): T[] {
  const out: T[] = [];
  for (const a of items) {
    if (a.blockId !== blockId || a.end <= pos) {
      out.push(a);
      continue;
    }
    if (a.start >= pos) {
      out.push({ ...a, blockId: rightBlockId, start: a.start - pos, end: a.end - pos } as T);
      continue;
    }
    const groupId = a.groupId ?? a.id;
    out.push({ ...a, id: uid(), groupId, end: pos } as T); // crossing: left half
    out.push({
      ...a,
      id: uid(),
      groupId,
      blockId: rightBlockId,
      start: 0,
      end: a.end - pos,
    } as T); // crossing: right half
  }
  return out;
}

/** After merging nextBlockId into mergedBlockId (which grows by prevLen). */
function shiftOnMergeAny<T extends ShiftableRange>(
  items: T[],
  nextBlockId: string,
  mergedBlockId: string,
  prevLen: number,
): T[] {
  return items.map((a) =>
    a.blockId === nextBlockId
      ? ({ ...a, blockId: mergedBlockId, start: a.start + prevLen, end: a.end + prevLen } as T)
      : a,
  );
}

/**
 * After inserting a single-block paste (which merged anchor-left + pasted +
 * anchor-right into newBlockId): left part keeps offsets, right part shifts by
 * (leftLen + pastedLen - idx).
 */
function reanchorOnInsertSingleAny<T extends ShiftableRange>(
  items: T[],
  oldBlockId: string,
  newBlockId: string,
  idx: number,
  rightShift: number,
): T[] {
  const out: T[] = [];
  for (const a of items) {
    if (a.blockId !== oldBlockId) {
      out.push(a);
      continue;
    }
    if (a.end <= idx) {
      out.push({ ...a, blockId: newBlockId } as T);
    } else if (a.start >= idx) {
      out.push({
        ...a,
        blockId: newBlockId,
        start: a.start + rightShift,
        end: a.end + rightShift,
      } as T);
    } else {
      const groupId = a.groupId ?? a.id;
      out.push({ ...a, id: uid(), groupId, blockId: newBlockId, end: idx } as T);
      out.push({
        ...a,
        id: uid(),
        groupId,
        blockId: newBlockId,
        start: idx + rightShift,
        end: a.end + rightShift,
      } as T);
    }
  }
  return out;
}

/**
 * After inserting a multi-block paste (first block absorbs anchor-left, last
 * block absorbs anchor-right): left ranges go to firstBlockId, right ranges
 * move to lastBlockId shifted by lastLen - idx, crossing ones split.
 */
function reanchorOnInsertMultiAny<T extends ShiftableRange>(
  items: T[],
  oldBlockId: string,
  firstBlockId: string,
  lastBlockId: string,
  idx: number,
  lastLen: number,
): T[] {
  const out: T[] = [];
  for (const a of items) {
    if (a.blockId !== oldBlockId) {
      out.push(a);
      continue;
    }
    if (a.end <= idx) {
      out.push({ ...a, blockId: firstBlockId } as T);
    } else if (a.start >= idx) {
      out.push({
        ...a,
        blockId: lastBlockId,
        start: a.start - idx + lastLen,
        end: a.end - idx + lastLen,
      } as T);
    } else {
      const groupId = a.groupId ?? a.id;
      out.push({ ...a, id: uid(), groupId, blockId: firstBlockId, end: idx } as T);
      out.push({
        ...a,
        id: uid(),
        groupId,
        blockId: lastBlockId,
        start: lastLen,
        end: lastLen + (a.end - idx),
      } as T);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Annotation shifts (public API)
// ---------------------------------------------------------------------------

/** After inserting len chars at pos inside blockId */
export function shiftOnInsert(
  annotations: SSMLAnnotation[],
  blockId: string,
  pos: number,
  len: number,
): SSMLAnnotation[] {
  return shiftOnInsertAny(annotations, blockId, pos, len);
}

/** After deleting [start, end) inside blockId */
export function shiftOnDelete(
  annotations: SSMLAnnotation[],
  blockId: string,
  start: number,
  end: number,
): SSMLAnnotation[] {
  return shiftOnDeleteAny(annotations, blockId, start, end);
}

/** After splitting blockId at pos into blockId | rightBlockId */
export function shiftOnSplit(
  annotations: SSMLAnnotation[],
  blockId: string,
  rightBlockId: string,
  pos: number,
): SSMLAnnotation[] {
  return shiftOnSplitAny(annotations, blockId, rightBlockId, pos);
}

/** After merging nextBlockId into mergedBlockId (which grows by prevLen) */
export function shiftOnMerge(
  annotations: SSMLAnnotation[],
  nextBlockId: string,
  mergedBlockId: string,
  prevLen: number,
): SSMLAnnotation[] {
  return shiftOnMergeAny(annotations, nextBlockId, mergedBlockId, prevLen);
}

/** Single-block paste absorption — see reanchorOnInsertSingleAny. */
export function reanchorOnInsertSingle(
  annotations: SSMLAnnotation[],
  oldBlockId: string,
  newBlockId: string,
  idx: number,
  rightShift: number,
): SSMLAnnotation[] {
  return reanchorOnInsertSingleAny(annotations, oldBlockId, newBlockId, idx, rightShift);
}

/** Multi-block paste absorption — see reanchorOnInsertMultiAny. */
export function reanchorOnInsertMulti(
  annotations: SSMLAnnotation[],
  oldBlockId: string,
  firstBlockId: string,
  lastBlockId: string,
  idx: number,
  lastLen: number,
): SSMLAnnotation[] {
  return reanchorOnInsertMultiAny(annotations, oldBlockId, firstBlockId, lastBlockId, idx, lastLen);
}

// ---------------------------------------------------------------------------
// Hint shifts (public API)
// ---------------------------------------------------------------------------

/** Hint counterpart of shiftOnInsert — insert `len` chars at `pos`. */
export function shiftHintsOnInsert(
  hints: ModelHint[],
  blockId: string,
  pos: number,
  len: number,
): ModelHint[] {
  return shiftOnInsertAny(hints, blockId, pos, len);
}

/** Hint counterpart of shiftOnDelete — delete the range [start, end). */
export function shiftHintsOnDelete(
  hints: ModelHint[],
  blockId: string,
  start: number,
  end: number,
): ModelHint[] {
  return shiftOnDeleteAny(hints, blockId, start, end);
}

/** Hint counterpart of shiftOnSplit — split `blockId` into two blocks at `pos`. */
export function shiftHintsOnSplit(
  hints: ModelHint[],
  blockId: string,
  rightBlockId: string,
  pos: number,
): ModelHint[] {
  return shiftOnSplitAny(hints, blockId, rightBlockId, pos);
}

/** Hint counterpart of shiftOnMerge — merge `nextBlockId` into `mergedBlockId`. */
export function shiftHintsOnMerge(
  hints: ModelHint[],
  nextBlockId: string,
  mergedBlockId: string,
  prevLen: number,
): ModelHint[] {
  return shiftOnMergeAny(hints, nextBlockId, mergedBlockId, prevLen);
}

/** Hint counterpart of reanchorOnInsertSingle — single-block paste absorption. */
export function reanchorHintsOnInsertSingle(
  hints: ModelHint[],
  oldBlockId: string,
  newBlockId: string,
  idx: number,
  rightShift: number,
): ModelHint[] {
  return reanchorOnInsertSingleAny(hints, oldBlockId, newBlockId, idx, rightShift);
}

/** Hint counterpart of reanchorOnInsertMulti — multi-block paste absorption. */
export function reanchorHintsOnInsertMulti(
  hints: ModelHint[],
  oldBlockId: string,
  firstBlockId: string,
  lastBlockId: string,
  idx: number,
  lastLen: number,
): ModelHint[] {
  return reanchorOnInsertMultiAny(hints, oldBlockId, firstBlockId, lastBlockId, idx, lastLen);
}
