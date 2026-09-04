/**
 * Pinyin engine adapter (pinyin-pro based).
 * Provides per-char conversion and polyphone candidate readings.
 */
import { pinyin } from "pinyin-pro";
import { isHan } from "../model/model";
import { parsePinyin, pinyinFormats } from "./tone";

export interface PinyinResult {
  char: string;
  val: string;
  candidates: string[];
}

export interface PinyinEngine {
  convert(text: string): (PinyinResult | null)[];
  getAllReadings(char: string): string[];
}

/**
 * Polyphone readings are a pure per-char function of pinyin-pro, so memoise
 * them per session.  Long texts repeat common chars a lot (e.g. 地/重/乐),
 * and opening the phoneme popover over a selection would otherwise re-run the
 * (fairly expensive) polyphone lookup for every occurrence of each char.
 */
const readingCache = new Map<string, string[]>();

function readingsOf(char: string): string[] {
  const cached = readingCache.get(char);
  if (cached) {
    return cached;
  }
  let readings: string[];
  try {
    const all = (
      pinyin(char, { toneType: "symbol", multiple: true, type: "array" }) as string[]
    ).filter(Boolean);
    if (all.length > 0) {
      readings = all;
    } else {
      readings = [pinyin(char, { toneType: "symbol", type: "string" }) as string];
    }
  } catch {
    readings = [char];
  }
  readingCache.set(char, readings);
  return readings;
}

/**
 * Default reading for a single Han char in both display formats, or null for
 * non-Han chars. Used by the features.phoneme.showAll ruby rendering and to
 * pre-select the default reading in the phoneme popover.
 */
export function defaultPinyinFormats(char: string): { val: string; tone: string } | null {
  const [r] = pinyinEngine.convert(char);
  if (!r) {
    return null;
  }
  const { letters, tone } = parsePinyin(r.val);
  return pinyinFormats(letters, tone);
}

export const pinyinEngine: PinyinEngine = {
  convert(text) {
    const chars = Array.from(text);
    if (chars.length === 0) {
      return [];
    }
    return chars.map((char) => {
      if (!isHan(char)) {
        return null;
      }
      const candidates = readingsOf(char);
      return { char, val: candidates[0] ?? char, candidates };
    });
  },

  getAllReadings(char) {
    return readingsOf(char);
  },
};
