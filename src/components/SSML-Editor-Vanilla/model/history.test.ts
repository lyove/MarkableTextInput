import { describe, expect, it } from "vitest";
import { History } from "./history";

function createTracked(initial: string): { h: History<string>; value: () => string } {
  let current = initial;
  const h = new History<string>(initial, (next) => {
    current = next;
  });
  return { h, value: () => current };
}

describe("History merge granularity", () => {
  it("merges commits that share the same merge key", () => {
    const { h, value } = createTracked("");
    h.commit("a", true, "typing:1");
    h.commit("ab", true, "typing:1");
    h.undo();
    expect(value()).toBe("");
  });

  it("does not merge commits with different merge keys", () => {
    const { h, value } = createTracked("");
    h.commit("a", true, "typing:1");
    h.commit("ab", true, "delete-backward");
    h.undo();
    expect(value()).toBe("a");
  });

  it("breakMerge resets the current merge run", () => {
    const { h, value } = createTracked("");
    h.commit("a", true, "typing:1");
    h.breakMerge();
    h.commit("ab", true, "typing:1");
    h.undo();
    expect(value()).toBe("a");
  });

  it("redo restores the next value and clears merge state", () => {
    const { h, value } = createTracked("");
    h.commit("a");
    h.commit("ab", true, "typing:1");
    h.undo();
    h.redo();
    expect(value()).toBe("ab");
  });
});
