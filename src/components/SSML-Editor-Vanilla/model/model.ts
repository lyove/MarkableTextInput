import { type Cursor, type SSMLBlock, type SSMLModel } from "../types";
/**
 * SSMLEditor data model.
 */

/**
 * Random base-36 suffix. Guards against id collisions between duplicated
 * copies of this module (e.g. the Vanilla + React editions mounted on the
 * same page), where the per-module `uidCounter` would otherwise restart at 1.
 */
function rand36(len: number): string {
  let s = "";
  while (s.length < len) {
    s += Math.random().toString(36).slice(2);
  }
  return s.slice(0, len);
}

/** Locally unique id (unique across module copies thanks to the random part). */
let uidCounter = 0;
export function uid(): string {
  uidCounter += 1;
  return `ann-${Date.now().toString(36)}-${rand36(8)}-${uidCounter.toString(36)}`;
}

/** New block id */
export function createBlockId(): string {
  return `seb-${Date.now().toString(36)}-${rand36(8)}`;
}

/** Whether the char is a CJK ideograph */
export function isHan(char: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9fff]/.test(char);
}

/** Build a model from plain text (paragraphs separated by newlines) */
export function createModelFromText(text: string): SSMLModel {
  const blocks = text
    .split(/\n+/)
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.length > 0)
    .map((line) => ({ id: createBlockId(), text: line }));
  return { blocks, annotations: [], hints: [] };
}

/** Code point length of a block */
export function blockLen(block: SSMLBlock): number {
  return Array.from(block.text).length;
}

/**
 * Resolve a possibly stale cursor against the current document.
 */
export function sanitizeCursor(model: SSMLModel, cursor: Cursor | null): Cursor | null {
  if (!cursor || model.blocks.length === 0) {
    return null;
  }
  const block = model.blocks.find((b) => b.id === cursor.blockId);
  if (block) {
    const len = blockLen(block);
    return { blockId: block.id, idx: cursor.idx < 0 ? 0 : Math.min(cursor.idx, len) };
  }
  const last = model.blocks[model.blocks.length - 1];
  return { blockId: last.id, idx: blockLen(last) };
}
