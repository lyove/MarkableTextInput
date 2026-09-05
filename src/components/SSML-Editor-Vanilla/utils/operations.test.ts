import { describe, expect, it } from "vitest";
import type { SSMLModel } from "../types";
import { deleteAtCursor, insertTextAtCursor, splitBlockAtCursor } from "./operations";

describe("text edit operations", () => {
  it("inserts text and shifts annotations", () => {
    const model: SSMLModel = {
      blocks: [{ id: "b1", text: "abc" }],
      annotations: [
        { id: "a1", type: "prosody", blockId: "b1", start: 1, end: 3, attrs: { rate: "slow" } },
      ],
      hints: [],
    };
    const next = insertTextAtCursor(model, { blockId: "b1", idx: 1 }, "X");
    expect(next.blocks[0].text).toBe("aXbc");
    expect(next.annotations[0]).toMatchObject({ start: 2, end: 4 });
  });

  it("deletes backward inside a block", () => {
    const model: SSMLModel = { blocks: [{ id: "b1", text: "abc" }], annotations: [], hints: [] };
    const r = deleteAtCursor(model, { blockId: "b1", idx: 2 }, true);
    expect(r?.model.blocks[0].text).toBe("ac");
    expect(r?.cursor).toEqual({ blockId: "b1", idx: 1 });
  });

  it("deletes across blocks and merges them", () => {
    const model: SSMLModel = {
      blocks: [
        { id: "b1", text: "ab" },
        { id: "b2", text: "cd" },
      ],
      annotations: [],
      hints: [],
    };
    const r = deleteAtCursor(model, { blockId: "b2", idx: 0 }, true);
    expect(r?.model.blocks.map((b) => b.text)).toEqual(["abcd"]);
    expect(r?.cursor).toEqual({ blockId: "b1", idx: 2 });
  });

  it("splits a block at the caret", () => {
    const model: SSMLModel = { blocks: [{ id: "b1", text: "abc" }], annotations: [], hints: [] };
    const r = splitBlockAtCursor(model, { blockId: "b1", idx: 1 });
    expect(r?.model.blocks.map((b) => b.text)).toEqual(["a", "bc"]);
    expect(r?.cursor.blockId).toBe(r?.model.blocks[1].id);
  });
});
