/**
 * Pure DOM construction for the editor's floating overlays: the bracket
 * tooltip, the hint tooltip, and the two conflict dialogs (overlap repair /
 * cross-boundary inform).
 */
import { type AnnotationType, type SSMLAnnotation } from "../types";

/** Compact annotation title map */
const ANN_TITLE: Record<string, string> = {
  phoneme: "音标",
  emphasis: "重音",
  sayAs: "读法",
  prosody: "韵律",
  break: "停顿",
};

/** Max width of the hint tooltip, used for viewport clamping. */
const TIP_MAX_W = 320;

/** Same-type / sayAs overlap prompt — three-way resolution dialog */
export interface OverlapPrompt {
  type: AnnotationType;
  blockId: string;
  start: number;
  end: number;
  attrs: Record<string, string>;
  conflicts: SSMLAnnotation[];
}

/** Cross-boundary overlap prompt — inform-only, no repair options */
export interface CrossBoundaryPrompt {
  type: AnnotationType;
  start: number;
  end: number;
  existing: SSMLAnnotation[];
}

/** Human-readable attribute summary for one annotation. */
export function annotationLabel(a: SSMLAnnotation): string {
  if (a.type === "prosody") {
    const parts = [
      a.attrs.rate ? `rate ${a.attrs.rate}` : "",
      a.attrs.pitch ? `pitch ${a.attrs.pitch}` : "",
      a.attrs.volume ? `volume ${a.attrs.volume}` : "",
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : "default";
  }
  if (a.type === "emphasis") {
    return `level ${a.attrs.level ?? "moderate"}`;
  }
  if (a.type === "sayAs") {
    const extra = a.attrs.format ? ` ${a.attrs.format}` : "";
    return `${a.attrs.interpretAs ?? "characters"}${extra}`;
  }
  if (a.type === "break") {
    return a.attrs.time ? `time ${a.attrs.time}` : "";
  }
  return "";
}

/** Build the bracket hover tooltip showing type chip + attrs (+ range). */
export function buildBracketTooltip(ann: SSMLAnnotation, rect: DOMRect): Node {
  const tip = document.createElement("div");
  tip.className = "se-bracket-tooltip";
  tip.style.left = `${Math.min(rect.left, window.innerWidth - 220)}px`;
  tip.style.top = `${rect.bottom + 6}px`;
  const chip = document.createElement("span");
  chip.className = `se-ann-type-chip se-ann-type-chip--${ann.type}`;
  chip.textContent = ANN_TITLE[ann.type] ?? ann.type;
  tip.appendChild(chip);
  const attrsEl = document.createElement("span");
  attrsEl.textContent = annotationLabel(ann);
  tip.appendChild(attrsEl);
  if (ann.type !== "break") {
    const range = document.createElement("span");
    range.className = "se-bracket-tooltip__range";
    range.textContent = `[${ann.start},${ann.end})`;
    tip.appendChild(range);
  }
  return tip;
}

/** Build the hint bubble below the hovered hint group. */
export function buildHintTooltip(h: { el: HTMLElement; text: string }): Node {
  const rect = h.el.getBoundingClientRect();
  const W = window.innerWidth;
  const H = window.innerHeight;
  const cx = rect.left + rect.width / 2;
  const tip = document.createElement("div");
  tip.className = "se-hint-tooltip";
  const halfEst = TIP_MAX_W / 2 + 8;
  const leftEst = Math.max(halfEst, Math.min(W - halfEst, cx));
  const bottomEst = H - rect.top + 12;
  tip.style.left = `${leftEst}px`;
  tip.style.bottom = `${bottomEst}px`;
  tip.textContent = h.text;
  const arrow = document.createElement("span");
  arrow.className = "se-hint-tooltip__arrow";
  tip.appendChild(arrow);
  return tip;
}

/** Shared dialog action button builder. */
function dialogBtn(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = cls;
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

/** Opaque full-screen overlay + centered dialog wrapper. */
function dialogShell(
  titleText: string,
  onOverlayClick: () => void,
): {
  wrap: HTMLDivElement;
  body: HTMLDivElement;
  actions: HTMLDivElement;
} {
  const wrap = document.createElement("div");
  const overlay = document.createElement("div");
  overlay.className = "se-overlay se-overlay--opaque";
  overlay.addEventListener("click", onOverlayClick);
  overlay.addEventListener("mousedown", (e) => e.stopPropagation());
  wrap.appendChild(overlay);

  const dlg = document.createElement("div");
  dlg.className = "se-dialog";
  dlg.setAttribute("role", "dialog");
  dlg.setAttribute("aria-modal", "true");
  const title = document.createElement("div");
  title.className = "se-dialog__title";
  title.textContent = titleText;
  dlg.appendChild(title);
  const body = document.createElement("div");
  body.className = "se-dialog__body";
  dlg.appendChild(body);
  const actions = document.createElement("div");
  actions.className = "se-dialog__actions";
  dlg.appendChild(actions);
  wrap.appendChild(dlg);
  return { wrap, body, actions };
}

/** Build the "annotations overlap" three-way resolution dialog. */
export function buildOverlapDialog(
  p: OverlapPrompt,
  handlers: {
    onCancel: () => void;
    onSplit: () => void;
    onReplace: () => void;
  },
): Node {
  const { wrap, body, actions } = dialogShell("检测到重叠标注", handlers.onCancel);

  const summary =
    p.type === "sayAs"
      ? "与已有「读法」标注区间重叠 — say-as 不能同时生效两种读法规则"
      : `与已有 ${p.conflicts.length} 条「${ANN_TITLE[p.type] ?? p.type}」标注区间重叠`;
  const desc = document.createElement("div");
  desc.className = "se-dialog__desc";
  desc.textContent = `${summary}，请选择处理方式：`;
  body.appendChild(desc);

  const ul = document.createElement("ul");
  ul.className = "se-dialog__list";
  for (const c of p.conflicts) {
    const li = document.createElement("li");
    li.className = "se-dialog__item";
    const chip = document.createElement("span");
    chip.className = `se-ann-type-chip se-ann-type-chip--${c.type}`;
    chip.textContent = ANN_TITLE[c.type] ?? c.type;
    li.appendChild(chip);
    const r = document.createElement("span");
    r.className = "se-dialog__range";
    r.textContent = `[${c.start}…${c.end})`;
    li.appendChild(r);
    const attrs = document.createElement("span");
    attrs.className = "se-dialog__attrs";
    attrs.textContent = annotationLabel(c);
    li.appendChild(attrs);
    ul.appendChild(li);
  }
  body.appendChild(ul);

  const hint = document.createElement("div");
  hint.className = "se-dialog__hint";
  hint.textContent = "选择「拆段合并」可保留旧标注的非重叠前后段，中间用新标注覆盖。";
  body.appendChild(hint);

  actions.append(
    dialogBtn("取消", "se-btn se-btn--ghost", handlers.onCancel),
    dialogBtn("拆段合并", "se-btn se-btn--warning", handlers.onSplit),
    dialogBtn("替换已有", "se-btn se-btn--danger", handlers.onReplace),
  );
  return wrap;
}

/** Build the inform-only cross-boundary overlap dialog. */
export function buildCrossBoundaryDialog(
  p: CrossBoundaryPrompt,
  handlers: { onDismiss: () => void },
): Node {
  const { wrap, body, actions } = dialogShell("无法添加标注", handlers.onDismiss);

  const annTitle = ANN_TITLE[p.type] ?? p.type;
  const existingList = p.existing
    .map((a) => `${ANN_TITLE[a.type] ?? a.type} [${a.start},${a.end})`)
    .join(", ");
  const d1 = document.createElement("p");
  d1.className = "se-dialog__desc";
  d1.textContent = `新的「${annTitle}」区间 [${p.start}, ${p.end}) 与已有标注重叠：${existingList}。`;
  const d2 = document.createElement("p");
  d2.className = "se-dialog__desc";
  d2.textContent =
    "不同类型的标注必须完全嵌套（一个完全包含另一个）。请调整选区，使新区间完全位于每条已有标注的内部或外部后再试。";
  body.append(d1, d2);

  actions.appendChild(dialogBtn("知道了", "se-btn se-btn--primary", handlers.onDismiss));
  return wrap;
}
