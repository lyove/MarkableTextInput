/**
 * Say-as popover: how the engine should interpret the selected text.
 * Preserves initial.format on confirm when present.
 */
import { BasePopover, type ChipOption, type PopoverOptions } from "./base-popover";

export class SayAsPopover extends BasePopover {
  constructor(opts: PopoverOptions) {
    super();
    const WIDTH = 320;
    const MODES: ChipOption[] = [
      { key: "date", label: "日期" },
      { key: "time", label: "时间" },
      { key: "number", label: "数字" },
      { key: "digits", label: "逐位" },
      { key: "telephone", label: "电话" },
      { key: "characters", label: "逐字" },
    ];
    let mode = opts.initial?.interpretAs ?? "characters";

    // Title row.
    this.el.appendChild(this.buildTitle("读法", "指定引擎如何解读选中文字"));

    // Candidates row.
    const candidates = document.createElement("div");
    candidates.className = "se-candidates";
    this.buildChips(
      candidates,
      MODES,
      (o) => mode === o.key,
      (o) => {
        mode = o.key;
      },
    );
    this.el.appendChild(candidates);

    // Actions row; preserve initial.format on confirm.
    this.el.appendChild(
      this.buildActions(opts.onRemove, () => {
        const attrs: Record<string, string> = { interpretAs: mode };
        if (opts.initial?.format) {
          attrs.format = opts.initial.format;
        }
        opts.onConfirm(attrs);
      }),
    );

    this.mount(WIDTH, 140, opts.rect, opts.onClose, true);
  }
}
