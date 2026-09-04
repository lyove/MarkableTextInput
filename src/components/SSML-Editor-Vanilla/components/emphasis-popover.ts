/**
 * Emphasis popover: stress level for the selected range.
 */
import { BasePopover, type ChipOption, type PopoverOptions } from "./base-popover";

export class EmphasisPopover extends BasePopover {
  constructor(opts: PopoverOptions) {
    super();
    const WIDTH = 260;
    const LEVELS: ChipOption[] = [
      { key: "reduced", label: "弱读" },
      { key: "moderate", label: "适中" },
      { key: "strong", label: "重读" },
    ];
    let level = opts.initial?.level ?? "moderate";

    // Title row.
    this.el.appendChild(this.buildTitle("重音", "强调选中文字的朗读力度"));

    // Candidates row.
    const candidates = document.createElement("div");
    candidates.className = "se-candidates";
    this.buildChips(
      candidates,
      LEVELS,
      (o) => level === o.key,
      (o) => {
        level = o.key;
      },
    );
    this.el.appendChild(candidates);

    // Actions row.
    this.el.appendChild(
      this.buildActions(opts.onRemove, () => {
        opts.onConfirm({ level });
      }),
    );

    this.mount(WIDTH, 130, opts.rect, opts.onClose, true);
  }
}
