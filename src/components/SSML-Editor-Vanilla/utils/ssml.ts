/**
 * SSML serialization: annotation document <-> SSML markup.
 * Supports <phoneme>, <break>, <prosody>, <say-as>, <emphasis> plus <p>/<s>
 * block elements; unknown elements are traversed transparently.
 */
import {
  type ModelHint,
  type SSMLAnnotation,
  type SSMLModel,
  type SSMLBlock,
  type SSMLEditorValue,
} from "../types";
import { createBlockId, uid } from "../model/model";
import { pinyinFormats, parsePinyin } from "./tone";
import { normalizeRangeNesting } from "./annotations";
import { modelToPlain } from "./serialize";

const clampInt = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, hi));

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface TagSpec {
  open: (attrs: Record<string, string>) => string;
  close: string;
}

const TAG_SPECS: Record<string, TagSpec> = {
  phoneme: {
    open: (a) => `<phoneme ph="${escapeXml(a.tone || a.val)}">`,
    close: "</phoneme>",
  },
  prosody: {
    open: (a) => {
      const attrs = [
        a.rate ? ` rate="${escapeXml(a.rate)}"` : "",
        a.pitch ? ` pitch="${escapeXml(a.pitch)}"` : "",
        a.volume ? ` volume="${escapeXml(a.volume)}"` : "",
      ].join("");
      return `<prosody${attrs}>`;
    },
    close: "</prosody>",
  },
  sayAs: {
    open: (a) =>
      `<say-as interpret-as="${escapeXml(a.interpretAs ?? "characters")}"${
        a.format ? ` format="${escapeXml(a.format)}"` : ""
      }>`,
    close: "</say-as>",
  },
  emphasis: {
    open: (a) => `<emphasis level="${escapeXml(a.level ?? "moderate")}">`,
    close: "</emphasis>",
  },
  hint: {
    open: (a) => `<hint text="${escapeXml(a.text ?? "")}">`,
    close: "</hint>",
  },
};

/** Serialize one block: scan offsets and emit open/close events around the text */
function blockToSSML(block: SSMLBlock, annotations: SSMLAnnotation[]): string {
  const chars = Array.from(block.text);
  const len = chars.length;

  interface Ev {
    closes: SSMLAnnotation[];
    opens: SSMLAnnotation[];
  }
  const events = new Map<number, Ev>();
  const evAt = (i: number): Ev => {
    let e = events.get(i);
    if (!e) {
      e = { closes: [], opens: [] };
      events.set(i, e);
    }
    return e;
  };

  const phonemes = annotations.filter((a) => a.type === "phoneme");
  const ranged = annotations.filter(
    (a) => a.type !== "break" && a.type !== "phoneme" && TAG_SPECS[a.type],
  );
  for (const a of ranged) {
    evAt(Math.max(0, Math.min(a.start, len))).opens.push(a);
    evAt(Math.max(0, Math.min(a.end, len))).closes.push(a);
  }
  const breaks = annotations.filter((a) => a.type === "break").sort((x, y) => x.start - y.start);

  let out = "";
  const stack: SSMLAnnotation[] = [];
  const closeAnn = (a: SSMLAnnotation) => {
    const spec = TAG_SPECS[a.type];
    if (spec) {
      out += spec.close;
    }
  };
  const openAnn = (a: SSMLAnnotation) => {
    const spec = TAG_SPECS[a.type];
    if (spec) {
      out += spec.open(a.attrs);
      stack.push(a);
    }
  };
  const reopenQueue: SSMLAnnotation[] = [];
  for (let i = 0; i <= len; i++) {
    const ev = events.get(i);
    if (ev && ev.closes.length > 0) {
      const closeSet = new Set(ev.closes.map((a) => a.id));
      while (stack.length > 0) {
        const top = stack[stack.length - 1];
        if (top.end <= i) {
          stack.pop();
          closeAnn(top);
          continue;
        }
        // top extends beyond i: only unwind it if a closing tag is buried beneath.
        const buried = stack.findIndex((t) => closeSet.has(t.id));
        if (buried === -1) {
          break;
        }
        while (stack.length - 1 > buried) {
          const above = stack.pop()!;
          closeAnn(above);
          if (above.end > i) {
            reopenQueue.push(above);
          }
        }
        const target = stack.pop()!;
        closeAnn(target);
      }
      while (reopenQueue.length > 0) {
        openAnn(reopenQueue.pop()!);
      }
    } else {
      while (stack.length > 0 && stack[stack.length - 1].end === i) {
        closeAnn(stack.pop()!);
      }
    }
    while (breaks.length > 0 && breaks[0].start === i) {
      const b = breaks.shift()!;
      const t = b.attrs.time ? ` time="${escapeXml(b.attrs.time)}"` : "";
      const s = b.attrs.strength ? ` strength="${escapeXml(b.attrs.strength)}"` : "";
      out += `<break${t}${s}/>`;
    }
    if (ev) {
      for (const a of ev.opens.sort((x, y) => {
        const lx = x.end - x.start,
          ly = y.end - y.start;
        if (ly !== lx) {
          return ly - lx;
        }
        if (x.start !== y.start) {
          return x.start - y.start;
        }
        const hx = (x.type as string) === "hint" ? 0 : 1;
        const hy = (y.type as string) === "hint" ? 0 : 1;
        if (hx !== hy) {
          return hx - hy;
        }
        return x.id.localeCompare(y.id);
      })) {
        openAnn(a);
      }
    }
    if (i < len) {
      const ch = chars[i];
      const py = phonemes.find((a) => a.start === i && a.end === i + 1);
      if (py) {
        out += `<phoneme ph="${escapeXml(py.attrs.tone || py.attrs.val)}">${escapeXml(
          ch,
        )}</phoneme>`;
      } else {
        out += escapeXml(ch);
      }
    }
  }
  while (stack.length > 0) closeAnn(stack.pop()!);
  return out;
}

export function valueToModel(value: SSMLEditorValue): SSMLModel {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return { blocks: [], annotations: [] };
    }
    return ssmlToModel(value);
  }
  return value;
}

/**
 * SSML string -> plain text.
 */
export function ssmlToPlain(xml: string): string {
  return modelToPlain(ssmlToModel(xml));
}

/**
 * Model -> SSML string. Hints are emitted as the custom <hint text="..."> tag
 * (round-trips with ssmlToModel). Hints are folded into the block's range
 * annotations so the same open/close event stack orders them correctly against
 * the standard range tags.
 */
export function modelToSSML(model: SSMLModel): string {
  const parts = model.blocks.map((block) => {
    const anns = model.annotations.filter((a) => a.blockId === block.id);
    const hintAnns: SSMLAnnotation[] = (model.hints ?? [])
      .filter((h) => h.blockId === block.id && h.end > h.start)
      .map((h) => ({
        id: h.id,
        // "hint" is not a real AnnotationType; the TAG_SPECS.hint entry emits it.
        type: "hint" as SSMLAnnotation["type"],
        blockId: h.blockId,
        start: h.start,
        end: h.end,
        attrs: { text: h.text },
      }));
    return `<p>${blockToSSML(block, [...anns, ...hintAnns])}</p>`;
  });
  return `<speak>${parts.join("")}</speak>`;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** SSML string -> document */
export function ssmlToModel(xml: string): SSMLModel {
  const blocks: SSMLBlock[] = [];
  const annotations: SSMLAnnotation[] = [];
  const hints: ModelHint[] = [];
  let cur: SSMLBlock = { id: createBlockId(), text: "" };

  const flush = () => {
    const blockId = cur.id;
    const trimmed = cur.text.trim();
    const lead = Array.from(cur.text).length - Array.from(cur.text.trimStart()).length;
    const trimmedLen = Array.from(trimmed).length;
    cur.text = trimmed;
    for (const a of annotations) {
      if (a.blockId !== blockId) {
        continue;
      }
      if (a.type === "break") {
        a.start = clampInt(a.start - lead, 0, trimmedLen);
        a.end = a.start;
      } else {
        a.start = clampInt(a.start - lead, 0, trimmedLen);
        a.end = clampInt(a.end - lead, 0, trimmedLen);
      }
    }
    for (const h of hints) {
      if (h.blockId !== blockId) {
        continue;
      }
      h.start = clampInt(h.start - lead, 0, trimmedLen);
      h.end = clampInt(h.end - lead, 0, trimmedLen);
    }
    if (trimmed.length > 0 || blocks.length === 0) {
      blocks.push(cur);
    }
    cur = { id: createBlockId(), text: "" };
  };

  const walk = (node: Node, openRanges: { ann: SSMLAnnotation; start: number }[]) => {
    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
      const t = node.textContent ?? "";
      if (node.nodeType === Node.TEXT_NODE && /^\s*$/.test(t)) {
        return;
      }
      cur.text += t;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }
    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    if (tag === "p" || tag === "s") {
      flush();
      el.childNodes.forEach((c) => walk(c, openRanges));
      flush();
      return;
    }

    if (tag === "break") {
      const attrs: Record<string, string> = {};
      if (el.getAttribute("time")) {
        attrs.time = el.getAttribute("time")!;
      }
      if (el.getAttribute("strength")) {
        attrs.strength = el.getAttribute("strength")!;
      }
      const offset = Array.from(cur.text).length;
      const existing = annotations.some(
        (a) => a.type === "break" && a.blockId === cur.id && a.start === offset,
      );
      if (!existing) {
        annotations.push({
          id: uid(),
          type: "break",
          blockId: cur.id,
          start: offset,
          end: offset,
          attrs,
        });
      }
      el.childNodes.forEach((c) => walk(c, openRanges));
      return;
    }

    if (tag === "phoneme") {
      const ph = el.getAttribute("ph") ?? "";
      const start = Array.from(cur.text).length;
      el.childNodes.forEach((c) => walk(c, openRanges));
      const end = Array.from(cur.text).length;
      const spanLen = end - start;
      if (spanLen <= 1) {
        const p = parsePinyin(ph);
        const fmt = pinyinFormats(p.letters, p.tone);
        annotations.push({
          id: uid(),
          type: "phoneme",
          blockId: cur.id,
          start,
          end,
          attrs: {
            val: fmt.val,
            tone: /[1-5]$/.test(ph.trim()) ? ph.trim() : fmt.tone,
          },
        });
      } else {
        const readings = ph.split(/\s+/).filter(Boolean);
        const count = Math.min(spanLen, readings.length);
        for (let i = 0; i < count; i++) {
          const raw = readings[i];
          const p = parsePinyin(raw);
          const fmt = pinyinFormats(p.letters, p.tone);
          const s = start + i;
          annotations.push({
            id: uid(),
            type: "phoneme",
            blockId: cur.id,
            start: s,
            end: s + 1,
            attrs: {
              val: fmt.val,
              tone: /[1-5]$/.test(raw.trim()) ? raw.trim() : fmt.tone,
            },
          });
        }
      }
      return;
    }

    let opened: { ann: SSMLAnnotation; start: number } | null = null;
    if (tag === "hint") {
      const hintText = (el.getAttribute("text") ?? "").trim();
      const hintStart = Array.from(cur.text).length;
      el.childNodes.forEach((c) => walk(c, openRanges));
      const hintEnd = Array.from(cur.text).length;
      if (hintText && hintEnd > hintStart) {
        hints.push({
          id: uid(),
          blockId: cur.id,
          start: hintStart,
          end: hintEnd,
          text: hintText,
        });
      }
      return;
    }
    if (tag === "prosody") {
      const attrs: Record<string, string> = {};
      for (const k of ["rate", "pitch", "volume"]) {
        const v = el.getAttribute(k);
        if (v) {
          attrs[k] = v;
        }
      }
      opened = {
        ann: {
          id: uid(),
          type: "prosody",
          blockId: cur.id,
          start: 0,
          end: 0,
          attrs,
        },
        start: Array.from(cur.text).length,
      };
    } else if (tag === "say-as") {
      opened = {
        ann: {
          id: uid(),
          type: "sayAs",
          blockId: cur.id,
          start: 0,
          end: 0,
          attrs: {
            interpretAs:
              el.getAttribute("interpret-as") ?? el.getAttribute("interpretAs") ?? "characters",
            ...(el.getAttribute("format") ? { format: el.getAttribute("format")! } : {}),
          },
        },
        start: Array.from(cur.text).length,
      };
    } else if (tag === "emphasis") {
      opened = {
        ann: {
          id: uid(),
          type: "emphasis",
          blockId: cur.id,
          start: 0,
          end: 0,
          attrs: { level: el.getAttribute("level") ?? "moderate" },
        },
        start: Array.from(cur.text).length,
      };
    }

    const stack = opened ? [...openRanges, opened] : openRanges;
    el.childNodes.forEach((c) => walk(c, stack));

    if (opened) {
      annotations.push({
        ...opened.ann,
        start: opened.start,
        end: Array.from(cur.text).length,
      });
    }
  };

  const parse = (mode: "text/xml" | "text/html") => {
    const dom = new DOMParser().parseFromString(xml, mode);
    return dom.querySelector("parsererror") ? null : dom;
  };
  const dom = parse("text/xml") ?? parse("text/html");
  try {
    if (!dom) {
      throw new Error("parse error");
    }
    walk(dom.documentElement, []);
  } catch {
    blocks.length = 0;
    annotations.length = 0;
    hints.length = 0;
    let text = xml.replace(/<[^>]+>/g, "");
    try {
      const ta = document.createElement("textarea");
      ta.innerHTML = text;
      text = ta.value;
    } catch {
      // Non-DOM environment — keep the raw stripped text.
    }
    cur = { id: createBlockId(), text };
  }
  flush();

  const liveBlocks = blocks.filter((b) => b.text.length > 0);
  const liveIds = new Set(liveBlocks.map((b) => b.id));
  const cleaned: SSMLAnnotation[] = [];
  for (const a of annotations) {
    if (!liveIds.has(a.blockId)) {
      continue;
    }
    const len = Array.from(liveBlocks.find((b) => b.id === a.blockId)!.text).length;
    if (a.type === "break") {
      const pos = clampInt(a.start, 0, len);
      cleaned.push({ ...a, start: pos, end: pos });
      continue;
    }
    const start = clampInt(a.start, 0, len);
    const end = clampInt(a.end, 0, len);
    if (end <= start) {
      continue;
    }
    cleaned.push({ ...a, start, end });
  }
  // Hints: clamp to live blocks, drop empty ranges, dedupe by range
  // (last occurrence wins, mirroring setBlockHint replace semantics).
  const cleanedHints: ModelHint[] = [];
  const hintIndex = new Map<string, number>();
  for (const h of hints) {
    if (!liveIds.has(h.blockId)) {
      continue;
    }
    const len = Array.from(liveBlocks.find((b) => b.id === h.blockId)!.text).length;
    const start = clampInt(h.start, 0, len);
    const end = clampInt(h.end, 0, len);
    if (end <= start) {
      continue;
    }
    const key = `${h.blockId}:${start}:${end}`;
    const idx = hintIndex.get(key);
    if (idx === undefined) {
      hintIndex.set(key, cleanedHints.length);
      cleanedHints.push({ ...h, start, end });
    } else {
      cleanedHints[idx] = { ...h, start, end };
    }
  }
  return {
    blocks: liveBlocks,
    annotations: normalizeRangeNesting(cleaned),
    ...(cleanedHints.length > 0 ? { hints: cleanedHints } : {}),
  };
}
