/**
 * Abstract base class for popover components.
 */

/** A labelled single-select option for chip groups. */
export interface ChipOption {
  key: string;
  label: string;
}

/** Common options shape shared by the break / prosody / sayAs / emphasis popovers. */
export interface PopoverOptions {
  rect: DOMRect;
  initial: Record<string, string> | null;
  onConfirm: (attrs: Record<string, string>) => void;
  onRemove?: () => void;
  onClose: (e?: Event) => void;
}

export abstract class BasePopover {
  /** The popover surface element (.se-popover). */
  protected readonly el: HTMLDivElement;
  /** Cleanup function for document-level close listeners (null until mount). */
  private detach: (() => void) | null = null;

  /** Creates the surface element only — subclass must build content then call mount(). */
  constructor() {
    this.el = this.createSurface();
  }

  /** Create the .se-popover surface div with fixed positioning + stopPropagation. */
  private createSurface(): HTMLDivElement {
    const el = document.createElement("div");
    el.className = "se-popover";
    el.style.position = "fixed";
    el.style.zIndex = "1000";
    el.addEventListener("mousedown", (e) => e.stopPropagation());
    el.addEventListener("contextmenu", (e) => e.stopPropagation());
    return el;
  }

  /**
   * Position, attach close listeners, and append to body.
   * Must be called AFTER the subclass has populated `this.el` with content
   * (so the height measurement is accurate).
   *
   * @param width           Popover width in px.
   * @param fallbackHeight  Used when offsetHeight can't be measured.
   * @param rect            Anchor rect (usually the selection/caret rect).
   * @param onClose         Called on Escape or outside-mousedown.
   * @param focusable       If true, sets tabIndex=-1 and focuses the surface
   *                        (for popovers without their own text input).
   */
  protected mount(
    width: number,
    fallbackHeight: number,
    rect: DOMRect,
    onClose: (e?: Event) => void,
    focusable = false,
  ): void {
    this.el.style.width = `${width}px`;
    if (focusable) {
      this.el.tabIndex = -1;
    }
    this.el.style.left = "0px";
    this.el.style.top = "0px";
    this.el.style.visibility = "hidden";
    document.body.appendChild(this.el);
    const H = this.el.offsetHeight || fallbackHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const maxLeft = Math.max(8, vw - width - 8);
    const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, 8), maxLeft);
    let top = rect.bottom + 8;
    if (top + H > vh - 8) {
      top = rect.top - H - 8;
    }
    top = Math.min(Math.max(top, 8), Math.max(8, vh - H - 8));
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
    this.el.style.visibility = "visible";
    if (focusable) {
      this.el.focus({ preventScroll: true });
    }
    this.detach = this.attachClose(onClose);
    this.onMounted();
  }

  /** Hook called after the popover is positioned and visible. Override in subclass. */
  protected onMounted(): void {}

  /** Attach Escape + outside-mousedown listeners that trigger onClose. */
  private attachClose(onClose: (e: Event) => void): () => void {
    const onMouseDown = (e: MouseEvent) => {
      if (!this.el.contains(e.target as Node)) {
        onClose(e);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose(e);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }

  /** Remove the DOM tree and detach all listeners. */
  destroy(): void {
    this.detach?.();
    if (this.el.parentNode) {
      this.el.parentNode.removeChild(this.el);
    }
    this.onDestroy();
  }

  /** Hook called during destroy. Override to null out subclass references. */
  protected onDestroy(): void {}

  // ── Shared element builders ──────────────────────────────────────

  /** Build a title row with optional hint text. */
  protected buildTitle(text: string, hint?: string): HTMLDivElement {
    const title = document.createElement("div");
    title.className = "se-popover-title";
    title.textContent = text;
    if (hint) {
      const hintEl = document.createElement("span");
      hintEl.className = "se-popover-hint";
      hintEl.textContent = hint;
      title.appendChild(hintEl);
    }
    return title;
  }

  /** Build the standard actions row (Remove + Confirm). */
  protected buildActions(
    onRemove: (() => void) | undefined,
    onConfirm: () => void,
  ): HTMLDivElement {
    const actions = document.createElement("div");
    actions.className = "se-popover-actions";
    if (onRemove) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "se-btn se-btn-danger";
      removeBtn.textContent = "移除";
      removeBtn.addEventListener("click", onRemove);
      actions.appendChild(removeBtn);
    } else {
      actions.appendChild(document.createElement("span"));
    }
    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "se-btn se-btn-primary";
    confirmBtn.textContent = "确定";
    confirmBtn.addEventListener("click", onConfirm);
    actions.appendChild(confirmBtn);
    return actions;
  }

  /** Build a .se-field row with a label and a .se-candidates chip container. */
  protected buildField(label: string): {
    field: HTMLDivElement;
    candidates: HTMLDivElement;
  } {
    const field = document.createElement("div");
    field.className = "se-field";
    const labelEl = document.createElement("div");
    labelEl.className = "se-field-label";
    labelEl.textContent = label;
    field.appendChild(labelEl);
    const candidates = document.createElement("div");
    candidates.className = "se-candidates";
    field.appendChild(candidates);
    return { field, candidates };
  }

  /**
   * Build a single-select chip group inside `container`.
   * Selecting one chip runs onSelect and re-syncs EVERY chip so the
   * previously active chip loses its highlight (radio behavior).
   */
  protected buildChips(
    container: HTMLElement,
    options: ChipOption[],
    isCurrent: (opt: ChipOption) => boolean,
    onSelect: (opt: ChipOption) => void,
  ): void {
    const syncs: Array<() => void> = [];
    const syncAll = (): void => {
      syncs.forEach((s) => s());
    };
    options.forEach((opt) => {
      const { el, sync } = this.createChip(
        opt,
        () => isCurrent(opt),
        () => {
          onSelect(opt);
          syncAll();
        },
      );
      syncs.push(sync);
      container.appendChild(el);
    });
  }

  /** Create a chip button with active-state toggle. */
  private createChip(
    opt: ChipOption,
    isCurrent: () => boolean,
    onClick: () => void,
  ): { el: HTMLButtonElement; sync: () => void } {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = opt.label;
    const sync = () => {
      btn.className = `se-chip${isCurrent() ? " se-chip-active" : ""}`;
    };
    sync();
    btn.addEventListener("click", () => {
      onClick();
      sync();
    });
    return { el: btn, sync };
  }
}
