/** Annotation kinds supported by the editor */
export type AnnotationType = "phoneme" | "break" | "prosody" | "sayAs" | "emphasis";

/** Display format for phoneme tones (pure view layer, never changes stored data) */
export type ToneFormat = "symbol" | "number";

/**
 * Phoneme sub-config. The annotation capability is on/off (via the `boolean`
 * shorthand on {@link AnnotationFeatures.phoneme}); `toneFormat` and `showAll`
 * are display details that need a home beyond a bare boolean.
 */
export interface PhonemeFeature {
  /** Tone display format, defaults to "symbol". */
  toneFormat?: ToneFormat;
  /**
   * Show an auto-generated pinyin ruby above every Han character without an
   * explicit phoneme annotation. */
  showAll?: boolean;
}

/**
 * Toggles for every configurable annotation / hint feature in the editor.
 * `phoneme` accepts a bare boolean (default true) for on/off, or an object to
 * additionally pass `toneFormat`. Other keys are simple booleans, all defaulting
 * to `true`.
 */
export interface AnnotationFeatures {
  /** phoneme menu entry + range badge click-to-edit  */
  phoneme?: boolean | PhonemeFeature;
  /** Break / pause menu entry + inline mark click-to-edit */
  break?: boolean;
  /** Prosody menu entry + range badge click-to-edit */
  prosody?: boolean;
  /** Say-as menu entry + range badge click-to-edit */
  sayAs?: boolean;
  /** Emphasis menu entry + range badge click-to-edit */
  emphasis?: boolean;
  /** Hint ("Add hint") menu entry + inline hint range click-to-edit */
  hint?: boolean;
}

/**
 * Resolved form of {@link AnnotationFeatures}: every key is required and
 * `phoneme` is flattened into `{ enabled, toneFormat, showAll }`. This is the
 * shape of `editor.Features` and everywhere downstream code reads feature flags.
 */
export interface ResolvedAnnotationFeatures {
  phoneme: { enabled: boolean; toneFormat: ToneFormat; showAll: boolean };
  break: boolean;
  prosody: boolean;
  sayAs: boolean;
  emphasis: boolean;
  hint: boolean;
}

/** One paragraph of plain text */
export interface SSMLBlock {
  id: string;
  text: string;
}

/**
 * A range annotation anchored to [start, end) of a block (code point offsets).
 * `break` is a point annotation expressed as start === end.
 */
export interface SSMLAnnotation {
  id: string;
  type: AnnotationType;
  blockId: string;
  start: number;
  end: number;
  attrs: Record<string, string>;
  groupId?: string;
}

/**
 * Editor content model: plain-text blocks + range annotations + hints.
 * This is the in-memory structured representation of the SSML content
 * (the typed counterpart to a raw SSML string).
 */
export interface SSMLModel {
  blocks: SSMLBlock[];
  annotations: SSMLAnnotation[];
  hints?: ModelHint[];
}

/**
 * Accepted `value` shapes for the editor.
 */
export type SSMLEditorValue = SSMLModel | string;

/** Hint model */
export interface ModelHint {
  id: string;
  blockId: string;
  start: number;
  end: number;
  text: string;
  groupId?: string;
}

/** Caret position: block id + code point offset in [0, blockLen] */
export interface Cursor {
  blockId: string;
  idx: number;
}

/** Selection span within one block, [start, end) */
export interface SelectionSpan {
  blockId: string;
  start: number;
  end: number;
}

export interface CharPos {
  blockId: string;
  idx: number;
}
