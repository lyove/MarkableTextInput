/**
 * Block-tree DOM construction — declarative VNode pipeline.
 */
import type { AnnotationType, ResolvedAnnotationFeatures, SSMLAnnotation, SSMLModel } from "../types";
import type { SelectionSpan } from "../utils/selection";

import {
  buildBlockDomRefs,
  buildBlockVNodes,
  caretInsertionPoint,
  caretRefFromVNodes,
  diffBlockChildren,
  materializeVNode,
  materializeVNodes,
  vnodeKey,
  type BlockDiff,
  type BlockVNode,
  type BracketVNode,
  type BreakVNode,
  type CaretDomRef,
  type CaretInsertion,
  type CaretVNode,
  type CharVNode,
  type ComposingVNode,
  type HintGroupVNode,
  type VNode,
  type VNodeDomRefs,
  type VNodeType,
} from "./vnode";

// ---------------------------------------------------------------------------
// Public types (re-exported for consumers)
// ---------------------------------------------------------------------------

export type {
  BlockDiff,
  BlockVNode,
  BracketVNode,
  BreakVNode,
  CaretDomRef,
  CaretInsertion,
  CaretVNode,
  CharVNode,
  ComposingVNode,
  HintGroupVNode,
  VNode,
  VNodeDomRefs,
  VNodeType,
};

export {
  buildBlockDomRefs,
  buildBlockVNodes,
  caretInsertionPoint,
  caretRefFromVNodes,
  diffBlockChildren,
  materializeVNode,
  materializeVNodes,
  vnodeKey,
};

// ---------------------------------------------------------------------------
// Shared types (defined here, consumed by vnode.ts)
// ---------------------------------------------------------------------------

/** Bracket open/close event at a code-point offset */
export interface BracketSlot {
  ann: SSMLAnnotation;
  side: "left" | "right";
}

/** Immutable snapshot of the editor state needed to paint one block. */
export interface BlockRenderCtx {
  model: SSMLModel;
  spans: SelectionSpan[] | null;
  cursor: { blockId: string; idx: number } | null;
  composingText: string;
  readOnly: boolean;
  hoveredPairId: string | null;
  Features: ResolvedAnnotationFeatures;
  annsByBlock: Map<string, SSMLAnnotation[]>;
  hintsByBlock: Map<string, import("../types").ModelHint[]>;
}

// ---------------------------------------------------------------------------
// Feature gate
// ---------------------------------------------------------------------------

/** Whether a range annotation type is enabled by the resolved features. */
export function rangeFeatureEnabled(
  features: ResolvedAnnotationFeatures,
  type: AnnotationType,
): boolean {
  switch (type) {
    case "phoneme":
      return features.phoneme.enabled;
    case "prosody":
      return features.prosody;
    case "sayAs":
      return features.sayAs;
    case "emphasis":
      return features.emphasis;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Shared element factories (used by ime.ts fast-path)
// ---------------------------------------------------------------------------

/** Build the zero-width caret marker. */
export function createCaretSpan(): HTMLSpanElement {
  const c = document.createElement("span");
  c.className = "se-caret";
  return c;
}

/** Build the IME composition mirror span shown at the caret while composing. */
export function createComposingSpan(text: string): HTMLSpanElement {
  const c = document.createElement("span");
  c.className = "se-composing";
  c.textContent = text;
  return c;
}
