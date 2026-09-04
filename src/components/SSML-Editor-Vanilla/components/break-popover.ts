/**
 * Break (pause) popover: pick a pause duration and/or strength anchored at the
 * caret.
 */
import { BasePopover, type ChipOption, type PopoverOptions } from "./base-popover";

export class BreakPopover extends BasePopover {
  constructor(opts: PopoverOptions) {
    super();
    const WIDTH = 260;
    const isNew = !opts.initial;
    const times = ["100ms", "200ms", "400ms", "500ms", "800ms", "1s"];
    let currentTime = isNew ? "400ms" : opts.initial?.time ?? "";
    let timeTouched = false;
    const STRENGTHS: ChipOption[] = [
      { key: "none", label: "默认" },
      { key: "weak", label: "弱" },
      { key: "medium", label: "中" },
      { key: "strong", label: "强" },
      { key: "x-strong", label: "极强" },
    ];
    let currentStrength = opts.initial?.strength ?? "none";
    let strengthTouched = false;

    // Title row.
    this.el.appendChild(this.buildTitle("停顿", "在此处插入静默停顿"));

    // Duration field.
    const timeField = this.buildField("时长");
    this.buildChips(
      timeField.candidates,
      times.map((t) => ({ key: t, label: t })),
      (o) => currentTime === o.key,
      (o) => {
        currentTime = o.key;
        timeTouched = true;
      },
    );
    this.el.appendChild(timeField.field);

    // Strength field.
    const strengthField = this.buildField("强度");
    this.buildChips(
      strengthField.candidates,
      STRENGTHS,
      (o) => currentStrength === o.key,
      (o) => {
        currentStrength = o.key;
        strengthTouched = true;
      },
    );
    this.el.appendChild(strengthField.field);

    this.el.appendChild(
      this.buildActions(opts.onRemove, () => {
        const attrs: Record<string, string> = {};
        if (timeTouched) {
          attrs.time = currentTime;
        } else if (isNew) {
          attrs.time = currentTime;
        } else if (opts.initial?.time) {
          attrs.time = opts.initial.time;
        }
        if (strengthTouched) {
          if (currentStrength !== "none") {
            attrs.strength = currentStrength;
          }
        } else if (opts.initial?.strength) {
          attrs.strength = opts.initial.strength;
        }
        opts.onConfirm(attrs);
      }),
    );

    this.mount(WIDTH, 190, opts.rect, opts.onClose, true);
  }
}
