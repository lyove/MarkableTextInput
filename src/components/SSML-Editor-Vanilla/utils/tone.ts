/**
 * Pinyin tone utilities.
 */

/** Toned vowel -> plain letter */
const STRIP_MAP: Record<string, string> = {
  ā: "a",
  á: "a",
  ǎ: "a",
  à: "a",
  ō: "o",
  ó: "o",
  ǒ: "o",
  ò: "o",
  ē: "e",
  é: "e",
  ě: "e",
  è: "e",
  ī: "i",
  í: "i",
  ǐ: "i",
  ì: "i",
  ū: "u",
  ú: "u",
  ǔ: "u",
  ù: "u",
  ǖ: "ü",
  ǘ: "ü",
  ǚ: "ü",
  ǜ: "ü",
};

/** Toned vowel -> tone number (1-4) */
const TONE_MAP: Record<string, number> = {
  ā: 1,
  á: 2,
  ǎ: 3,
  à: 4,
  ō: 1,
  ó: 2,
  ǒ: 3,
  ò: 4,
  ē: 1,
  é: 2,
  ě: 3,
  è: 4,
  ī: 1,
  í: 2,
  ǐ: 3,
  ì: 4,
  ū: 1,
  ú: 2,
  ǔ: 3,
  ù: 4,
  ǖ: 1,
  ǘ: 2,
  ǚ: 3,
  ǜ: 4,
};

/** Voiced forms per vowel (tone 1-4); v is treated as ü */
const TONE_VOWELS: Record<string, string[]> = {
  a: ["ā", "á", "ǎ", "à"],
  o: ["ō", "ó", "ǒ", "ò"],
  e: ["ē", "é", "ě", "è"],
  i: ["ī", "í", "ǐ", "ì"],
  u: ["ū", "ú", "ǔ", "ù"],
  ü: ["ǖ", "ǘ", "ǚ", "ǜ"],
  v: ["ǖ", "ǘ", "ǚ", "ǜ"],
};

/** Strip tone marks, keep plain letters (ü preserved) */
export function stripTone(pinyin: string): string {
  return Array.from(pinyin)
    .map((ch) => STRIP_MAP[ch] ?? ch)
    .join("");
}

/** Detect tone of a toned pinyin: 0 = neutral / none, 1-4 */
function detectTone(pinyin: string): number {
  for (const ch of pinyin) {
    const t = TONE_MAP[ch];
    if (t) {
      return t;
    }
  }
  return 0;
}

/** Index of the vowel that carries the tone (standard pinyin rules) */
function findToneIndex(letters: string): number {
  const s = letters.toLowerCase();
  const idxA = s.indexOf("a");
  if (idxA >= 0) {
    return idxA;
  }
  const idxO = s.indexOf("o");
  if (idxO >= 0) {
    return idxO;
  }
  const idxE = s.indexOf("e");
  if (idxE >= 0) {
    return idxE;
  }
  const idxIu = s.indexOf("iu");
  if (idxIu >= 0) {
    return idxIu + 1;
  }
  const idxUi = s.indexOf("ui");
  if (idxUi >= 0) {
    return idxUi + 1;
  }
  const idxI = s.indexOf("i");
  if (idxI >= 0) {
    return idxI;
  }
  const idxU = s.indexOf("u");
  if (idxU >= 0) {
    return idxU;
  }
  const idxV = s.indexOf("v");
  if (idxV >= 0) {
    return idxV;
  }
  const idxUmlaut = s.indexOf("ü");
  if (idxUmlaut >= 0) {
    return idxUmlaut;
  }
  return -1;
}

/** Apply a tone to plain letters: tone 0 = neutral (no mark) */
export function applyTone(letters: string, tone: number): string {
  const clean = stripTone(letters.trim().toLowerCase());
  if (!clean) {
    return "";
  }
  if (tone <= 0) {
    return clean;
  }
  const idx = findToneIndex(clean);
  if (idx < 0) {
    return clean;
  }
  const voiced = TONE_VOWELS[clean[idx]];
  if (!voiced) {
    return clean;
  }
  return clean.slice(0, idx) + voiced[Math.min(tone, 4) - 1] + clean.slice(idx + 1);
}

/**
 * Parse any pinyin format (suī / sui1 / sui) into { letters, tone }.
 */
export function parsePinyin(pinyin: string): { letters: string; tone: number } {
  const s = pinyin.trim().toLowerCase();
  if (!s) {
    return { letters: "", tone: 0 };
  }
  // Numbered format: han4 / ma5 (5 = neutral tone)
  const num = s.match(/^(.*?)([1-5])$/);
  if (num && /^[a-züv]+$/.test(num[1])) {
    const t = Number(num[2]);
    return { letters: stripTone(num[1]), tone: t === 5 ? 0 : t };
  }
  return { letters: stripTone(s), tone: detectTone(s) };
}

/** Build both display formats from letters + tone: { val: 'suī', tone: 'sui1' } */
export function pinyinFormats(letters: string, tone: number): { val: string; tone: string } {
  const toneNum = Math.min(Math.max(tone, 0), 4);
  return {
    val: applyTone(letters, toneNum),
    tone: toneNum > 0 ? `${stripTone(letters)}${toneNum}` : stripTone(letters),
  };
}
