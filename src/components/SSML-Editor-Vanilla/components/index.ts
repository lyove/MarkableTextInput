/**
 * Popover & menu barrel: one import surface for all annotation popovers,
 * the shared base, and the context menu.
 */
export { BasePopover, type ChipOption, type PopoverOptions } from "./base-popover";
export { BreakPopover } from "./break-popover";
export { ProsodyPopover } from "./prosody-popover";
export { SayAsPopover } from "./say-as-popover";
export { EmphasisPopover } from "./emphasis-popover";
export { PhonemePopover, type PopoverChar } from "./phoneme-popover";
export { HintPopover, type HintPopoverOptions } from "./hint-popover";
export { ContextMenu, type ContextMenuOptions, type ContextMenuFeatures } from "./context-menu";
