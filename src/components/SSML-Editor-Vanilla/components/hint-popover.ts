/**
 * Hint popover: add/edit a hint annotation on the selected range.
 * Plain TypeScript port of the React HintPopover component.
 */
import { BasePopover } from "./base-popover";

export interface HintPopoverOptions {
  rect: DOMRect;
  initialText?: string;
  onConfirm: (text: string) => void;
  onRemove?: () => void;
  onClose: (e?: Event) => void;
}

export class HintPopover extends BasePopover {
  private readonly opts: HintPopoverOptions;
  private readonly initialText: string;
  private text: string;
  private textarea: HTMLTextAreaElement | null = null;
  private confirmBtn: HTMLButtonElement | null = null;

  constructor(opts: HintPopoverOptions) {
    super();
    this.opts = opts;
    this.initialText = (opts.initialText ?? "").trim();
    this.text = opts.initialText ?? "";

    this.el.classList.add("se-hint-popover");

    // Title row.
    this.el.appendChild(
      this.buildTitle(this.initialText ? "编辑提示" : "添加提示", "为选中内容附加说明文字"),
    );

    // Textarea.
    const textarea = document.createElement("textarea");
    textarea.className = "se-hint-textarea";
    textarea.rows = 2;
    textarea.maxLength = 100;
    textarea.placeholder = "输入提示内容，如：此处语速放慢";
    textarea.value = this.text;
    textarea.addEventListener("input", () => {
      this.text = textarea.value;
      this.syncConfirmState();
    });
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.confirm();
      }
    });
    this.el.appendChild(textarea);
    this.textarea = textarea;

    // Actions row.
    const actions = document.createElement("div");
    actions.className = "se-popover-actions";

    // Remove button is only shown when editing an existing hint.
    if (this.initialText || this.opts.onRemove) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "se-btn se-btn-danger";
      removeBtn.textContent = "移除提示";
      removeBtn.addEventListener("click", () => {
        this.opts.onRemove?.();
      });
      actions.appendChild(removeBtn);
    } else {
      // Spacer to mirror the React <span /> placeholder branch.
      actions.appendChild(document.createElement("span"));
    }

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "se-btn se-btn-primary";
    confirmBtn.textContent = "确定";
    confirmBtn.disabled = !this.text.trim();
    confirmBtn.addEventListener("click", () => this.confirm());
    actions.appendChild(confirmBtn);
    this.el.appendChild(actions);

    this.confirmBtn = confirmBtn;

    // Mount: position, attach close listeners, append to body.
    this.mount(280, 170, opts.rect, opts.onClose);
  }

  protected onMounted(): void {
    this.textarea?.focus();
  }

  protected onDestroy(): void {
    this.textarea = null;
    this.confirmBtn = null;
  }

  // Enable/disable the confirm button based on the current text value.
  private syncConfirmState(): void {
    if (this.confirmBtn) {
      this.confirmBtn.disabled = !this.text.trim();
    }
  }

  // Confirm the current text, mirroring the React confirm() helper.
  private confirm(): void {
    const trimmed = this.text.trim();
    if (!trimmed) {
      return;
    }
    this.opts.onConfirm(trimmed);
  }
}
