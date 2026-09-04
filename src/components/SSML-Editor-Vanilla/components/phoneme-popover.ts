/**
 * Phoneme popover: edit pinyin (val + tone) per character in a selection.
 * Plain TypeScript port of the React PhonemePopover component.
 */
import { BasePopover } from "./base-popover";
import { applyTone, parsePinyin, pinyinFormats, stripTone } from "../utils/tone";

/** One editable char slot in the popover. */
export interface PopoverChar {
  /** Slot index in the chars array */
  idx: number;
  char: string;
  /** Current display reading (suī), empty = unannotated */
  val: string;
  /** Current machine reading (sui1) */
  tone: string;
  /** Engine readings, most common first */
  candidates?: string[];
  /** Character kind: han = Chinese → pinyin, other → IPA */
  kind?: "han" | "other";
}

/** Constructor options for PhonemePopover. */
export interface PhonemePopoverOptions {
  rect: DOMRect;
  chars: PopoverChar[];
  onCharChange: (pos: number, val: string, tone: string) => void;
  onCharRemove: (pos: number) => void;
  onClose: (e?: Event) => void;
}

type EditMode = "pinyin" | "phoneme";

// Tone mark button definitions, matching the React TONES constant.
const TONES: { tone: number; title: string }[] = [
  { tone: 1, title: "Tone 1" },
  { tone: 2, title: "Tone 2" },
  { tone: 3, title: "Tone 3" },
  { tone: 4, title: "Tone 4" },
  { tone: 0, title: "Neutral" },
];

// Popover fixed dimensions, matching the React useLayoutEffect constants.
const POPOVER_WIDTH = 320;
const POPOVER_FALLBACK_HEIGHT = 224;

/**
 * Build the inline SVG tone mark used in tone buttons, mirroring the React
 * ToneMark component. Returns an <svg> element.
 */
function buildToneMarkSvg(tone: number): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "se-tone-mark");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "12");
  svg.setAttribute("height", "12");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  let d: string;
  switch (tone) {
    case 1:
      d = "M4 12h16";
      break;
    case 2:
      d = "M4.5 17.5 19.5 6.5";
      break;
    case 3:
      d = "m4 8 8 8.5 8-8.5";
      break;
    case 4:
      d = "M4.5 6.5l15 11";
      break;
    default:
      d = "";
      break;
  }
  if (d) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  } else {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "12");
    circle.setAttribute("cy", "12");
    circle.setAttribute("r", "2.2");
    circle.setAttribute("fill", "currentColor");
    circle.setAttribute("stroke", "none");
    svg.appendChild(circle);
  }
  return svg;
}

/** Build the pencil edit-toggle icon, mirroring the React IconEdit constant. */
function buildEditIconSvg(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const p1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p1.setAttribute("d", "M12 20h9");
  const p2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p2.setAttribute("d", "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z");
  svg.appendChild(p1);
  svg.appendChild(p2);
  return svg;
}

export class PhonemePopover extends BasePopover {
  private readonly opts: PhonemePopoverOptions;
  private readonly hanChars: PopoverChar[];
  private readonly otherChars: PopoverChar[];
  private readonly hasHan: boolean;
  private readonly hasOther: boolean;

  private mode: EditMode;
  private active = 0;
  private letters = "";
  private toneNum = 0;
  private editorOpen = false;
  private picked: string | null = null;
  private readonly removed = new Set<number>();

  private tabsEl: HTMLDivElement | null = null;
  private candBoxEl: HTMLDivElement | null = null;
  private arrowEl: HTMLSpanElement | null = null;
  private inputEl: HTMLInputElement | null = null;

  constructor(opts: PhonemePopoverOptions) {
    super();
    this.opts = opts;

    // Split characters by kind, mirroring the React derived arrays.
    this.hanChars = opts.chars.filter((c) => c.kind !== "other");
    this.otherChars = opts.chars.filter((c) => c.kind === "other");
    this.hasHan = this.hanChars.length > 0;
    this.hasOther = this.otherChars.length > 0;

    this.mode = this.hasHan ? "pinyin" : "phoneme";
    this.syncFromCurrent(true);

    // Build content into this.el (created by super()).
    this.render();

    // Mount: position, attach close listeners, append to body.
    this.mount(POPOVER_WIDTH, POPOVER_FALLBACK_HEIGHT, opts.rect, opts.onClose);
  }

  protected onMounted(): void {
    this.updateArrow();
    if (this.editorOpen) {
      this.inputEl?.focus();
    }
  }

  protected onDestroy(): void {
    this.tabsEl = null;
    this.candBoxEl = null;
    this.arrowEl = null;
    this.inputEl = null;
  }

  // Current editable char list for the active mode.
  private get currentChars(): PopoverChar[] {
    return this.mode === "pinyin" ? this.hanChars : this.otherChars;
  }

  // Guard against stale active index after mode switch.
  private get safeActive(): number {
    return Math.min(this.active, Math.max(0, this.currentChars.length - 1));
  }

  private get current(): PopoverChar | null {
    return this.currentChars[this.safeActive] ?? null;
  }

  /** Re-parse the active char's source into letters/tone/picked. */
  private syncFromCurrent(initial: boolean): void {
    const c = this.current;
    const source = c?.val || c?.tone || c?.candidates?.[0] || "";
    const p = parsePinyin(source);
    this.letters = p.letters;
    this.toneNum = p.tone;
    this.picked = source || null;
    if (initial) {
      // Mirror the useState initial values; nothing else to reset.
    }
  }

  /** Commit the draft letters + tone to the host via onCharChange. */
  private commit(l: string, t: number): void {
    const c = this.current;
    if (!c) {
      return;
    }
    const fmt = pinyinFormats(l, t);
    this.opts.onCharChange(c.idx, fmt.val, fmt.tone);
  }

  /** Preview string (applyTone of current letters + tone). */
  private get preview(): string {
    return applyTone(this.letters, this.toneNum);
  }

  /** Re-render the body of the popover for the current state. */
  private render(): void {
    // Clear any prior content.
    while (this.el.firstChild) {
      this.el.removeChild(this.el.firstChild);
    }
    this.tabsEl = null;
    this.candBoxEl = null;
    this.arrowEl = null;
    this.inputEl = null;

    this.el.appendChild(this.buildTitleRow());

    if (this.mode === "pinyin" && this.current) {
      this.appendPinyinSection();
    } else if (this.mode === "phoneme") {
      this.appendPhonemeSection();
    }
  }

  /** Build the title row with mode tabs + hint. */
  private buildTitleRow(): HTMLDivElement {
    const title = document.createElement("div");
    title.className = "se-popover-title";

    const tabs = document.createElement("div");
    tabs.className = "se-mode-tabs";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "编辑模式");

    if (this.hasHan) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", String(this.mode === "pinyin"));
      btn.className = `se-mode-tab${this.mode === "pinyin" ? " se-mode-tab-active" : ""}`;
      btn.textContent = "拼音";
      const count = document.createElement("span");
      count.className = "se-mode-tab-count";
      count.textContent = String(this.hanChars.length);
      btn.appendChild(count);
      btn.addEventListener("click", () => this.setMode("pinyin"));
      tabs.appendChild(btn);
    }
    if (this.hasOther) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", String(this.mode === "phoneme"));
      btn.className = `se-mode-tab${this.mode === "phoneme" ? " se-mode-tab-active" : ""}`;
      btn.textContent = "音标";
      const count = document.createElement("span");
      count.className = "se-mode-tab-count";
      count.textContent = String(this.otherChars.length);
      btn.appendChild(count);
      btn.addEventListener("click", () => this.setMode("phoneme"));
      tabs.appendChild(btn);
    }
    title.appendChild(tabs);

    const hint = this.computeHint();
    if (hint) {
      const hintEl = document.createElement("span");
      hintEl.className = "se-popover-hint";
      hintEl.textContent = hint;
      title.appendChild(hintEl);
    }
    return title;
  }

  /** Compute the title hint, mirroring the React hint derivation. */
  private computeHint(): string | undefined {
    if (this.mode === "phoneme") {
      return "国际音标 · 开发中";
    }
    if (this.currentChars.length > 1) {
      return "逐字编辑 · 点文字切换";
    }
    const recs = this.current?.candidates ?? [];
    if (recs.length > 1) {
      return "多音字 · 选择一种读音";
    }
    return undefined;
  }

  /** Append the pinyin mode section (tabs, candidates, editor, actions). */
  private appendPinyinSection(): void {
    // Char tabs.
    const tabs = document.createElement("div");
    tabs.className = "se-char-tabs";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Char to edit");
    this.hanChars.forEach((c, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", String(i === this.safeActive));
      btn.className = `se-char-tab${i === this.safeActive ? " se-char-tab-active" : ""}`;
      btn.textContent = c.char;
      btn.addEventListener("click", () => this.setActive(i));
      tabs.appendChild(btn);
    });
    this.el.appendChild(tabs);
    this.tabsEl = tabs;

    // Candidates box.
    const box = document.createElement("div");
    box.className = "se-candidates-box";

    const arrow = document.createElement("span");
    arrow.className = "se-candidates-arrow";
    arrow.style.visibility = "hidden";
    box.appendChild(arrow);
    this.arrowEl = arrow;

    const c = this.current!;
    const recommendations = c.candidates ?? [];
    const currentReading = c.val || c.tone || "";
    const isCustom = !!currentReading && !recommendations.includes(currentReading);

    if (recommendations.length > 0 || isCustom) {
      const candidates = document.createElement("div");
      candidates.className = "se-candidates";

      if (isCustom) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = `se-chip se-chip-custom${
          this.picked === currentReading ? " se-chip-active" : ""
        }`;
        chip.title = "自定义读音";
        chip.textContent = c.val || currentReading;
        const tag = document.createElement("span");
        tag.className = "se-chip-tag";
        tag.textContent = "自定义";
        chip.appendChild(tag);
        chip.addEventListener("click", () => {
          const p = parsePinyin(currentReading);
          this.picked = currentReading;
          this.letters = p.letters;
          this.toneNum = p.tone;
          this.rerender();
        });
        candidates.appendChild(chip);
      }

      recommendations.forEach((rc) => {
        const p = parsePinyin(rc);
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = `se-chip${rc === this.picked ? " se-chip-active" : ""}`;
        if (recommendations.length <= 1) {
          chip.title = "最常用读音";
        }
        chip.textContent = applyTone(p.letters, p.tone);
        chip.addEventListener("click", () => {
          this.picked = rc;
          this.letters = p.letters;
          this.toneNum = p.tone;
          this.rerender();
        });
        candidates.appendChild(chip);
      });
      box.appendChild(candidates);

      if (isCustom && recommendations.length > 0) {
        const restore = document.createElement("div");
        restore.className = "se-restore";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "se-chip-restore";
        btn.title = "恢复最常用读音（点确定后生效）";
        btn.textContent = "恢复";
        btn.addEventListener("click", () => {
          const first = recommendations[0];
          const p = parsePinyin(first);
          this.picked = first;
          this.letters = p.letters;
          this.toneNum = p.tone;
          this.rerender();
        });
        restore.appendChild(btn);
        box.appendChild(restore);
      }
    }

    // Edit toggle (always present in the candidates box).
    const editToggle = document.createElement("button");
    editToggle.type = "button";
    editToggle.className = `se-edit-toggle${this.editorOpen ? " se-edit-toggle-open" : ""}`;
    editToggle.title = this.editorOpen ? "收起编辑器" : "自定义拼音";
    editToggle.setAttribute("aria-label", this.editorOpen ? "收起编辑器" : "自定义拼音");
    editToggle.setAttribute("aria-expanded", String(this.editorOpen));
    editToggle.appendChild(buildEditIconSvg());
    editToggle.addEventListener("click", () => {
      this.editorOpen = !this.editorOpen;
      this.rerender();
      if (this.editorOpen) {
        this.inputEl?.focus();
      }
    });
    box.appendChild(editToggle);

    this.el.appendChild(box);
    this.candBoxEl = box;

    // Custom editor section.
    if (this.editorOpen) {
      this.el.appendChild(this.buildEditor());
    }

    // Actions.
    this.el.appendChild(this.buildActionsRow());
  }

  /** Build the custom pinyin editor (tones + input + preview). */
  private buildEditor(): HTMLDivElement {
    const editor = document.createElement("div");
    editor.className = "se-popover-editor";

    const left = document.createElement("div");
    left.className = "se-popover-editor-left";

    const tones = document.createElement("div");
    tones.className = "se-tones";
    tones.setAttribute("role", "group");
    tones.setAttribute("aria-label", "Tone");
    TONES.forEach((t) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `se-tone-btn${this.toneNum === t.tone ? " se-tone-btn-active" : ""}`;
      btn.setAttribute("data-tip", t.title);
      btn.setAttribute("aria-label", t.title);
      btn.appendChild(buildToneMarkSvg(t.tone));
      btn.addEventListener("click", () => {
        this.toneNum = t.tone;
        this.rerender();
        this.inputEl?.focus();
      });
      tones.appendChild(btn);
    });
    left.appendChild(tones);

    const inputRow = document.createElement("div");
    inputRow.className = "se-popover-input-row";
    const input = document.createElement("input");
    input.className = "se-input";
    input.value = this.letters;
    input.placeholder = "letters";
    input.spellcheck = false;
    input.addEventListener("input", () => {
      const l = stripTone(input.value)
        .replace(/[^a-züv]/gi, "")
        .toLowerCase();
      this.letters = l;
      input.value = l;
      // Update only the preview + confirm state without rebuilding inputs.
      this.syncPreviewOnly();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        this.commit(this.letters, this.toneNum);
        this.opts.onClose();
      }
    });
    inputRow.appendChild(input);
    left.appendChild(inputRow);
    editor.appendChild(left);

    const preview = document.createElement("div");
    preview.className = "se-popover-preview";
    preview.title = "实时预览";
    preview.textContent = this.preview || "—";
    preview.dataset.preview = "1";
    editor.appendChild(preview);

    this.inputEl = input;
    return editor;
  }

  /** Build the actions row (Remove + Confirm) plus an optional auto-fill
   *  notice that explains — when the popover contains multiple han chars —
   *  that pressing 确定 will also populate their first candidate reading. */
  private buildActionsRow(): HTMLDivElement {
    const c = this.current!;
    const currentReading = c.val || c.tone || "";

    const autoFillCount = this.hanChars.filter(
      (hc) =>
        hc.idx !== c.idx &&
        !this.removed.has(hc.idx) &&
        !hc.val &&
        (hc.candidates?.length ?? 0) > 0,
    ).length;

    const wrap = document.createElement("div");

    const actions = document.createElement("div");
    actions.className = "se-popover-actions";

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "se-btn se-btn-danger";
    removeBtn.textContent = "移除";
    removeBtn.disabled = !currentReading;
    removeBtn.addEventListener("click", () => {
      this.removed.add(c.idx);
      this.opts.onCharRemove(c.idx);
      this.opts.onClose();
    });
    actions.appendChild(removeBtn);

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "se-btn se-btn-primary";
    confirmBtn.textContent = "确定";
    confirmBtn.disabled = !this.preview;
    if (autoFillCount > 0) {
      confirmBtn.title = `确定后还会为其余 ${autoFillCount} 个未标注汉字填入首选读音`;
    }
    confirmBtn.addEventListener("click", () => {
      this.commit(this.letters, this.toneNum);
      this.hanChars.forEach((hc) => {
        if (hc.idx === c.idx || this.removed.has(hc.idx) || hc.val || !hc.candidates?.length) {
          return;
        }
        const p = parsePinyin(hc.candidates[0]);
        const fmt = pinyinFormats(p.letters, p.tone);
        this.opts.onCharChange(hc.idx, fmt.val, fmt.tone);
      });
      this.opts.onClose();
    });
    confirmBtn.dataset.confirm = "1";
    actions.appendChild(confirmBtn);

    wrap.appendChild(actions);

    if (autoFillCount > 0) {
      const notice = document.createElement("div");
      notice.className = "se-phoneme-notice";
      const b = document.createElement("b");
      b.textContent = `还有 ${autoFillCount} 个汉字`;
      notice.appendChild(b);
      notice.appendChild(
        document.createTextNode(
          " 尚未标注拼音，点击确定时会自动填入它们的首选读音（可之后单独修改）。",
        ),
      );
      wrap.appendChild(notice);
    }

    return wrap;
  }

  /** Append the phoneme (IPA) placeholder section. */
  private appendPhonemeSection(): void {
    const wrap = document.createElement("div");
    wrap.className = "se-phoneme-empty";

    const icon = document.createElement("div");
    icon.className = "se-phoneme-empty-icon";
    icon.textContent = "🎙️";
    wrap.appendChild(icon);

    const title = document.createElement("div");
    title.className = "se-phoneme-empty-title";
    title.textContent = "国际音标（IPA）";
    wrap.appendChild(title);

    const desc = document.createElement("div");
    desc.className = "se-phoneme-empty-desc";
    desc.textContent = "该功能正在开发中，敬请期待";
    wrap.appendChild(desc);

    if (this.otherChars.length > 0) {
      const list = document.createElement("div");
      list.className = "se-phoneme-char-list";
      this.otherChars.forEach((c) => {
        const span = document.createElement("span");
        span.className = "se-phoneme-char";
        span.textContent = c.char;
        list.appendChild(span);
      });
      wrap.appendChild(list);
    }

    this.el.appendChild(wrap);
  }

  /** Switch edit mode and reset active index, mirroring the React useEffect. */
  private setMode(mode: EditMode): void {
    if (this.mode === mode) {
      return;
    }
    this.mode = mode;
    this.active = 0;
    this.editorOpen = false;
    this.syncFromCurrent(false);
    this.rerender();
    this.updateArrow();
  }

  /** Select a char tab by index. */
  private setActive(i: number): void {
    if (this.active === i) {
      return;
    }
    this.active = i;
    this.editorOpen = false;
    this.syncFromCurrent(false);
    this.rerender();
    this.updateArrow();
  }

  /** Rebuild the body and recompute the arrow position. */
  private rerender(): void {
    const hadFocus = document.activeElement === this.inputEl && this.inputEl !== null;
    this.render();
    this.updateArrow();
    if (hadFocus && this.editorOpen) {
      this.inputEl?.focus();
    }
  }

  /**
   * Update only the preview text + confirm disabled state after typing,
   * avoiding a full rebuild that would lose input focus mid-keystroke.
   */
  private syncPreviewOnly(): void {
    const preview = this.el.querySelector<HTMLElement>("[data-preview='1']");
    if (preview) {
      preview.textContent = this.preview || "—";
    }
    const confirmBtn = this.el.querySelector<HTMLButtonElement>("[data-confirm='1']");
    if (confirmBtn) {
      confirmBtn.disabled = !this.preview;
    }
  }

  /** Recompute the candidates-box arrow left offset after layout. */
  private updateArrow(): void {
    if (!this.tabsEl || !this.candBoxEl || !this.arrowEl) {
      return;
    }
    const tab = this.tabsEl.children[this.safeActive] as HTMLElement | undefined;
    if (!tab) {
      this.arrowEl.style.visibility = "hidden";
      return;
    }
    const tr = tab.getBoundingClientRect();
    const br = this.candBoxEl.getBoundingClientRect();
    const left = tr.left + tr.width / 2 - br.left;
    const clamped = Math.max(14, Math.min(left, br.width - 14));
    this.arrowEl.style.left = `${clamped}px`;
    this.arrowEl.style.visibility = "visible";
  }
}
