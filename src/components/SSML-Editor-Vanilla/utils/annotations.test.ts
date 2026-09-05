import { describe, expect, it } from "vitest";
import type { SSMLAnnotation } from "../types";
import { normalizeRangeNesting } from "./annotations";

describe("normalizeRangeNesting", () => {
  it("splits partially overlapping range annotations", () => {
    const anns: SSMLAnnotation[] = [
      { id: "a", type: "prosody", blockId: "b1", start: 0, end: 5, attrs: { rate: "slow" } },
      { id: "b", type: "emphasis", blockId: "b1", start: 3, end: 8, attrs: { level: "strong" } },
    ];
    const normalized = normalizeRangeNesting(anns);
    const groups = new Map<string, number>();
    for (const a of normalized) {
      groups.set(a.groupId ?? a.id, (groups.get(a.groupId ?? a.id) ?? 0) + (a.end - a.start));
    }
    // Both original ranges keep their full coverage, split into non-overlapping pieces.
    expect(groups.get("a")).toBe(5);
    expect(groups.get("b")).toBe(5);
  });
});
