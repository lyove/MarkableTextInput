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

function isLaminarFast(anns: SSMLAnnotation[]): boolean {
  const ranges = anns
    .filter((a) => a.type !== "break" && a.type !== "phoneme")
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const stack: SSMLAnnotation[] = [];
  for (const r of ranges) {
    while (stack.length > 0 && stack[stack.length - 1].end <= r.start) {
      stack.pop();
    }
    const top = stack[stack.length - 1];
    if (top && top.end < r.end) {
      return false;
    }
    stack.push(r);
  }
  return true;
}

describe("normalizeRangeNesting stress", () => {
  it("handles 1200 overlapping ranges without the old guard escape", () => {
    const anns: SSMLAnnotation[] = [];
    for (let i = 0; i < 1200; i++) {
      anns.push({ id: `id${i}`, type: "prosody", blockId: "b1", start: i, end: i + 30, attrs: {} });
    }
    const out = normalizeRangeNesting(anns);
    expect(out.length).toBeGreaterThan(1200);
    expect(isLaminarFast(out)).toBe(true);
    // Every original annotation keeps its full coverage through groupId-linked pieces.
    const coverage = new Map<string, number>();
    for (const a of out) {
      const key = a.groupId ?? a.id;
      coverage.set(key, (coverage.get(key) ?? 0) + (a.end - a.start));
    }
    for (let i = 0; i < 1200; i++) {
      expect(coverage.get(`id${i}`)).toBe(30);
    }
  });
});
