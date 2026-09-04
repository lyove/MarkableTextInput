import type {
  AnnotationFeatures,
  PhonemeFeature,
  ResolvedAnnotationFeatures,
  ToneFormat,
} from "../types";

/**
 * Resolve a phoneme feature input into `{ enabled, toneFormat, showAll }`.
 * - `undefined` / `true`  → enabled, default toneFormat "symbol", showAll off
 * - `false`              → disabled (display fields still default, unused when disabled)
 * - `{ ... }`            → enabled with the given toneFormat / showAll
 */
function resolvePhoneme(
  v: boolean | PhonemeFeature | undefined,
): { enabled: boolean; toneFormat: ToneFormat; showAll: boolean } {
  if (v === false) {
    return { enabled: false, toneFormat: "symbol", showAll: false };
  }
  if (v && typeof v === "object") {
    return {
      enabled: true,
      toneFormat: v.toneFormat ?? "symbol",
      showAll: v.showAll ?? false,
    };
  }
  return { enabled: true, toneFormat: "symbol", showAll: false };
}

/** Convenience helper: normalize feature flags into {@link ResolvedAnnotationFeatures}. */
export function resolveFeatures(f?: AnnotationFeatures): ResolvedAnnotationFeatures {
  return {
    phoneme: resolvePhoneme(f?.phoneme),
    break: f?.break !== false,
    prosody: f?.prosody !== false,
    sayAs: f?.sayAs !== false,
    emphasis: f?.emphasis !== false,
    hint: f?.hint !== false,
  };
}
