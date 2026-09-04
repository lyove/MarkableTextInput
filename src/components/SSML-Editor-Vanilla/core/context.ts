/**
 * EditorContext — the shared-state contract that all Services depend on.
 */

import type {
  AnnotationFeatures,
  ResolvedAnnotationFeatures,
  SSMLModel,
  SSMLEditorValue,
} from "../types";
import type { History } from "../model/history";
import type { EditorState } from "./state";
import type { EventBus, EditorEvents } from "./event-bus";
import type { DomService } from "./dom";
import type { ImeService } from "./ime";
import type { RenderService } from "./render";
import type { ActionsService } from "./actions";
import type { ClipboardService } from "./clipboard";
import type { SelectionService } from "./selection";
import type { KeyboardService } from "./keyboard";
import type { PointerService } from "./pointer";

// ---------------------------------------------------------------------------
// Public construction options
// ---------------------------------------------------------------------------

export interface SSMLEditorOptions {
  el: HTMLElement;
  value: SSMLEditorValue;
  onChange?: (value: SSMLModel) => void;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
  style?: Partial<CSSStyleDeclaration>;
  features?: AnnotationFeatures;
}

// ---------------------------------------------------------------------------
// EditorContext — the contract every Service receives
// ---------------------------------------------------------------------------

export interface EditorContext {
  // --- Construction options (read-only after constructor) ---
  hostEl: HTMLElement;
  onChangeCb: (value: SSMLModel) => void;
  styleOpts?: Partial<CSSStyleDeclaration>;
  readOnly: boolean;
  placeholder: string;
  className: string;

  // --- Root DOM elements (assigned by DomService.buildDOM) ---
  container: HTMLDivElement;
  content: HTMLDivElement;
  inputHost: HTMLDivElement;

  // --- Controlled document bridge ---
  history: History<SSMLModel>;

  // --- Event bus (typed pub/sub for inter-module decoupling) ---
  bus: EventBus<EditorEvents>;

  // --- Feature flags ---
  Features: ResolvedAnnotationFeatures;

  // --- Consolidated editor state (see core/state.ts) ---
  state: EditorState;

  // --- Bound handlers (kept as fields so add/removeEventListener match) ---
  boundKeyDown: (e: KeyboardEvent) => void;
  boundMouseDown: (e: MouseEvent) => void;
  boundDoubleClick: (e: MouseEvent) => void;
  boundContextMenu: (e: MouseEvent) => void;
  boundCopy: (e: ClipboardEvent) => void;
  boundPaste: (e: ClipboardEvent) => void;
  boundDragOver: (e: DragEvent) => void;
  boundDrop: (e: DragEvent) => void;
  boundDocCopy: () => void;
  boundDocCut: () => void;
  boundCompositionStart: (e: CompositionEvent) => void;
  boundCompositionUpdate: (e: CompositionEvent) => void;
  boundCompositionEnd: (e: CompositionEvent) => void;
  boundSelectionChange: () => void;
  boundFocus: () => void;
  boundBlur: (e: FocusEvent) => void;
  boundScroll: () => void;
  boundMouseUp: (e: MouseEvent) => void;
  boundWindowBlur: () => void;
  boundDocMouseDown: (e: MouseEvent) => void;
  boundMouseMove: (e: MouseEvent) => void;
  boundInputHostInput: (e: Event) => void;
  boundBeforeInput: (e: InputEvent) => void;
  boundContentClick: (e: MouseEvent) => void;
  boundContentMouseDown: (e: MouseEvent) => void;
  boundContentMouseOver: (e: MouseEvent) => void;
  boundContentMouseOut: (e: MouseEvent) => void;

  // --- Service references ---
  dom: DomService;
  ime: ImeService;
  render: RenderService;
  actions: ActionsService;
  clipboard: ClipboardService;
  selection: SelectionService;
  keyboard: KeyboardService;
  pointer: PointerService;

  // --- Shared methods (implemented on SSMLEditor, called by any Service) ---
  modalOpen(): boolean;
  blurHost(): void;
}

// Re-export state types that consumers (base.ts / editor.ts / index.ts) need.
export type {
  EditorState,
  OverlayState,
  RenderState,
  EditorFlags,
  EditingState,
  AnnTarget,
  HintTarget,
} from "./state";
