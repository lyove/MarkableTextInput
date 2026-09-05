/**
 * Global event dispatcher — one set of window/document listeners shared by
 * every live editor instance.
 */
import type { EditorContext } from "./context";

interface EventDef {
  target: Window | Document;
  type: string;
  capture?: boolean;
  passive?: boolean;
  dispatch: (e: Event) => void;
}

interface ActiveBinding {
  def: EventDef;
  listener: EventListener;
}

const registry = new Set<EditorContext>();
let activeBindings: ActiveBinding[] | null = null;

function forEachInstance(fn: (ctx: EditorContext) => void): void {
  for (const ctx of [...registry]) {
    try {
      fn(ctx);
    } catch (error) {
      // Keep one broken instance from preventing the others from receiving
      // the same global event.
      console.error("[SSMLEditor:global-events]", error);
    }
  }
}

function defs(): EventDef[] {
  return [
    {
      target: document,
      type: "selectionchange",
      dispatch: () => forEachInstance((ctx) => ctx.boundSelectionChange()),
    },
    {
      target: window,
      type: "resize",
      passive: true,
      dispatch: () => forEachInstance((ctx) => ctx.boundScroll()),
    },
    {
      target: window,
      type: "scroll",
      capture: true,
      passive: true,
      dispatch: () => forEachInstance((ctx) => ctx.boundScroll()),
    },
    {
      target: window,
      type: "mouseup",
      capture: true,
      dispatch: (e) => forEachInstance((ctx) => ctx.boundMouseUp(e as MouseEvent)),
    },
    {
      target: window,
      type: "mousemove",
      capture: true,
      dispatch: (e) => forEachInstance((ctx) => ctx.boundMouseMove(e as MouseEvent)),
    },
    {
      target: window,
      type: "blur",
      dispatch: () => forEachInstance((ctx) => ctx.boundWindowBlur()),
    },
    {
      target: document,
      type: "mousedown",
      capture: true,
      dispatch: (e) => forEachInstance((ctx) => ctx.boundDocMouseDown(e as MouseEvent)),
    },
    {
      target: document,
      type: "copy",
      capture: true,
      dispatch: () => forEachInstance((ctx) => ctx.boundDocCopy()),
    },
    {
      target: document,
      type: "cut",
      capture: true,
      dispatch: () => forEachInstance((ctx) => ctx.boundDocCut()),
    },
  ];
}

function addOptions(def: EventDef): AddEventListenerOptions | boolean {
  if (def.passive) {
    return { capture: def.capture ?? false, passive: true };
  }
  return def.capture ?? false;
}

function removeOptions(def: EventDef): EventListenerOptions | boolean {
  return def.capture ?? false;
}

export function registerGlobalEventTarget(ctx: EditorContext): void {
  registry.add(ctx);
  if (activeBindings) {
    return;
  }
  activeBindings = defs().map((def) => {
    const listener: EventListener = (e) => def.dispatch(e);
    def.target.addEventListener(def.type, listener, addOptions(def));
    return { def, listener };
  });
}

export function unregisterGlobalEventTarget(ctx: EditorContext): void {
  registry.delete(ctx);
  if (registry.size > 0 || !activeBindings) {
    return;
  }
  for (const { def, listener } of activeBindings) {
    def.target.removeEventListener(def.type, listener, removeOptions(def));
  }
  activeBindings = null;
}
