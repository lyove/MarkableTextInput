/**
 * Prosody popover: rate / pitch / volume for the selected range.
 */
import { BasePopover, type ChipOption, type PopoverOptions } from "./base-popover";

export class ProsodyPopover extends BasePopover {
  constructor(opts: PopoverOptions) {
    super();
    const WIDTH = 300;
    const RATES: ChipOption[] = [
      { key: "x-slow", label: "极慢" },
      { key: "slow", label: "慢" },
      { key: "medium", label: "中等" },
      { key: "fast", label: "快" },
      { key: "x-fast", label: "极快" },
    ];
    const PITCHES: ChipOption[] = [
      { key: "x-low", label: "极低" },
      { key: "low", label: "低" },
      { key: "medium", label: "中等" },
      { key: "high", label: "高" },
      { key: "x-high", label: "极高" },
    ];
    const VOLUMES: ChipOption[] = [
      { key: "soft", label: "轻柔" },
      { key: "medium", label: "中等" },
      { key: "loud", label: "响亮" },
    ];

    let rate = opts.initial?.rate ?? "medium";
    let pitch = opts.initial?.pitch ?? "medium";
    let volume = opts.initial?.volume ?? "medium";
    let rateTouched = false;
    let pitchTouched = false;
    let volumeTouched = false;

    // Title row.
    this.el.appendChild(this.buildTitle("韵律", "调整选中文字的语速 · 音调 · 音量"));

    // Rate field.
    const rateField = this.buildField("语速");
    this.buildChips(
      rateField.candidates,
      RATES,
      (o) => rate === o.key,
      (o) => {
        rate = o.key;
        rateTouched = true;
      },
    );
    this.el.appendChild(rateField.field);

    // Pitch field.
    const pitchField = this.buildField("音调");
    this.buildChips(
      pitchField.candidates,
      PITCHES,
      (o) => pitch === o.key,
      (o) => {
        pitch = o.key;
        pitchTouched = true;
      },
    );
    this.el.appendChild(pitchField.field);

    // Volume field.
    const volumeField = this.buildField("音量");
    this.buildChips(
      volumeField.candidates,
      VOLUMES,
      (o) => volume === o.key,
      (o) => {
        volume = o.key;
        volumeTouched = true;
      },
    );
    this.el.appendChild(volumeField.field);

    this.el.appendChild(
      this.buildActions(opts.onRemove, () => {
        const hasInitial = !!opts.initial && Object.keys(opts.initial).length > 0;
        if (!hasInitial) {
          opts.onConfirm({ rate, pitch, volume });
          return;
        }
        const attrs: Record<string, string> = {};
        if (rateTouched) {
          attrs.rate = rate;
        } else if (opts.initial!.rate) {
          attrs.rate = opts.initial!.rate;
        }
        if (pitchTouched) {
          attrs.pitch = pitch;
        } else if (opts.initial!.pitch) {
          attrs.pitch = opts.initial!.pitch;
        }
        if (volumeTouched) {
          attrs.volume = volume;
        } else if (opts.initial!.volume) {
          attrs.volume = opts.initial!.volume;
        }
        opts.onConfirm(attrs);
      }),
    );

    this.mount(WIDTH, 200, opts.rect, opts.onClose, true);
  }
}
