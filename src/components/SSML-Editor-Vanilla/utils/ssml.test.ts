import { describe, expect, it } from "vitest";
import type { SSMLModel } from "../types";
import { modelToSSML } from "./ssml";

const model: SSMLModel = {
  blocks: [{ id: "b1", text: "你好" }],
  annotations: [
    {
      id: "a1",
      type: "prosody",
      blockId: "b1",
      start: 0,
      end: 2,
      attrs: { rate: "slow" },
    },
  ],
  hints: [{ id: "h1", blockId: "b1", start: 0, end: 2, text: "备注" }],
};

describe("modelToSSML hint policy", () => {
  it("strips editor-only hints by default", () => {
    const ssml = modelToSSML(model);
    expect(ssml).toContain('<prosody rate="slow">');
    expect(ssml).not.toContain("<hint");
  });

  it("emits hints only when includeHints is requested", () => {
    const ssml = modelToSSML(model, { includeHints: true });
    expect(ssml).toContain('<hint text="备注">');
  });
});
