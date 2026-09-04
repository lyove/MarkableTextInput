/**
 * Context menu on a selection: annotation entry points.
 */

import type { AnnotationType, ResolvedAnnotationFeatures } from "../types";

/** Per-feature enable/disable flags (resolved form). */
export type ContextMenuFeatures = ResolvedAnnotationFeatures;

export interface ContextMenuOptions {
  x: number;
  y: number;
  hasSelection: boolean;
  hasClipboard: boolean;
  /** Selection spans multiple blocks — range/phoneme/hint marks cannot start. */
  multiBlock?: boolean;
  features: ContextMenuFeatures;
  onPhoneme: () => void;
  onBreak: () => void;
  onHint: () => void;
  onRange: (type: AnnotationType) => void;
  onSelectAll: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onClose: () => void;
}

// --- Inline SVG icons (preserved verbatim from the React source) ---

const ICON_PHONEME = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.75 2.75h16"></path><ellipse cx="10.75" cy="15.25" rx="8" ry="6.75"></ellipse><path d="M18.75 8.5v13.5"></path></svg>`;

const ICON_BREAK = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 4v16"></path><path d="M9 5.5v13" stroke-dasharray="2.5 3"></path></svg>`;

const ICON_PROSODY = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 17c3-9 5 5 8-4 2.2-6.5 4 3 8-2"></path></svg>`;

const ICON_EMPHASIS = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"></path><path d="M6 8l6-5 6 5"></path><path d="M6 16l6 5 6-5"></path></svg>`;

const ICON_SAYAS = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="6" cy="6" r="2.4"></circle><circle cx="18" cy="6" r="2.4"></circle><circle cx="6" cy="18" r="2.4"></circle><circle cx="18" cy="18" r="2.4"></circle></svg>`;

const ICON_HINT = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>`;

const ICON_SELECTALL = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect><path d="M8 12l3 3 5-5"></path></svg>`;

const ICON_COPY = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;

const ICON_PASTE = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1"></rect></svg>`;

/**
 * Build a menu item button with an SVG icon and a text label.
 */
function createMenuItem(
  iconHtml: string,
  label: string,
  onClick: () => void,
  disabled: boolean = false,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "se-ctx-item";
  if (disabled) {
    btn.disabled = true;
  }
  // Icon container
  const iconWrap = document.createElement("span");
  iconWrap.innerHTML = iconHtml;
  btn.appendChild(iconWrap);
  // Label
  const labelSpan = document.createElement("span");
  labelSpan.textContent = label;
  btn.appendChild(labelSpan);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (disabled) {
      return;
    }
    onClick();
  });
  return btn;
}

export class ContextMenu {
  private readonly root: HTMLDivElement;
  private readonly opts: ContextMenuOptions;
  private destroyed = false;

  constructor(opts: ContextMenuOptions) {
    this.opts = opts;

    const features = opts.features;
    const phonemeEnabled = features.phoneme.enabled;
    const breakEnabled = features.break;
    const prosodyEnabled = features.prosody;
    const emphasisEnabled = features.emphasis;
    const sayAsEnabled = features.sayAs;
    const hintEnabled = features.hint;
    const rangeBlocked = opts.hasSelection && opts.multiBlock === true;

    const root = document.createElement("div");
    root.className = "se-ctx";
    root.style.left = `${opts.x}px`;
    root.style.top = `${opts.y}px`;
    root.style.visibility = "hidden";
    root.addEventListener("mousedown", (e) => e.preventDefault());
    root.addEventListener("contextmenu", (e) => e.preventDefault());
    this.root = root;

    // ---- Annotation section ----
    if (
      opts.hasSelection &&
      (phonemeEnabled || prosodyEnabled || emphasisEnabled || sayAsEnabled || hintEnabled)
    ) {
      if (phonemeEnabled) {
        root.appendChild(
          createMenuItem(ICON_PHONEME, "音标 Phoneme", opts.onPhoneme, rangeBlocked),
        );
      }
      if (prosodyEnabled) {
        root.appendChild(
          createMenuItem(ICON_PROSODY, "韵律 Prosody", () => opts.onRange("prosody"), rangeBlocked),
        );
      }
      if (emphasisEnabled) {
        root.appendChild(
          createMenuItem(
            ICON_EMPHASIS,
            "重音 Emphasis",
            () => opts.onRange("emphasis"),
            rangeBlocked,
          ),
        );
      }
      if (sayAsEnabled) {
        root.appendChild(
          createMenuItem(ICON_SAYAS, "读法 SayAs", () => opts.onRange("sayAs"), rangeBlocked),
        );
      }
      if (hintEnabled) {
        root.appendChild(createMenuItem(ICON_HINT, "提示 Hint", opts.onHint, rangeBlocked));
      }
    }

    if (!opts.hasSelection && breakEnabled) {
      root.appendChild(createMenuItem(ICON_BREAK, "停顿 Break", opts.onBreak));
    }

    // ---- Edit section ----
    const divider = document.createElement("div");
    divider.className = "se-ctx-divider";
    root.appendChild(divider);

    root.appendChild(createMenuItem(ICON_SELECTALL, "全选 Select All", opts.onSelectAll));

    root.appendChild(createMenuItem(ICON_COPY, "复制 Copy", opts.onCopy, !opts.hasSelection));

    if (opts.hasClipboard) {
      root.appendChild(createMenuItem(ICON_PASTE, "粘贴", opts.onPaste));
    }

    document.body.appendChild(root);

    // Clamp the menu within the viewport, mirroring the React useLayoutEffect.
    this.updatePosition();

    // Dismiss listeners.
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    document.addEventListener("mousedown", this.onMouseDown);
    document.addEventListener("keydown", this.onKeyDown);
  }

  /** Clamp the menu position within the viewport, preferring the requested point. */
  private updatePosition(): void {
    const el = this.root;
    const left = Math.max(8, Math.min(this.opts.x, window.innerWidth - el.offsetWidth - 8));
    const top = Math.max(8, Math.min(this.opts.y, window.innerHeight - el.offsetHeight - 8));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = "visible";
  }

  private onMouseDown(e: MouseEvent): void {
    if (this.destroyed) {
      return;
    }
    if (!this.root.contains(e.target as Node)) {
      this.opts.onClose();
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.destroyed) {
      return;
    }
    if (e.key === "Escape") {
      this.opts.onClose();
    }
  }

  /** Remove the DOM tree and detach all listeners. Safe to call multiple times. */
  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    document.removeEventListener("mousedown", this.onMouseDown);
    document.removeEventListener("keydown", this.onKeyDown);
    if (this.root.parentNode) {
      this.root.parentNode.removeChild(this.root);
    }
  }
}
