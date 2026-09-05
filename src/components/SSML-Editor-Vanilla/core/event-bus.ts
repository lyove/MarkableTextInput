/**
 * EventBus — typed publish/subscribe hub for decoupling inter-module calls.
 */

import type { Cursor, SelectionSpan, SSMLModel } from "../types";

// ---------------------------------------------------------------------------
// Event map — every event name and its payload type
// ---------------------------------------------------------------------------

export interface EditorEvents {
  /** Document snapshot changed (history commit / setValue). */
  "model:change": SSMLModel;
  /** A render pass is needed; `dirty` marks the block tree stale. */
  "render:request": { dirty: boolean };
  /** Virtual caret moved (or was cleared to null). */
  "cursor:change": Cursor | null;
  /** Selection spans changed (or were cleared to null). */
  "selection:change": SelectionSpan[] | null;
  /** All overlays (context menu, popovers, tooltips) should be torn down. */
  "overlay:close": void;
}

// ---------------------------------------------------------------------------
// Generic typed EventBus
// ---------------------------------------------------------------------------

export class EventBus<T extends object> {
  private readonly handlers = new Map<keyof T, Set<(data: T[keyof T]) => void>>();

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<K extends keyof T>(type: K, fn: (data: T[K]) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn as (data: T[keyof T]) => void);
    return () => {
      set?.delete(fn as (data: T[keyof T]) => void);
    };
  }

  /**
   * Emit an event. All matching handlers fire synchronously.
   * When the payload type is `void` the data argument may be omitted.
   */
  emit<K extends keyof T>(type: K, ...args: T[K] extends void ? [] : [data: T[K]]): void {
    const set = this.handlers.get(type);
    if (!set) {
      return;
    }
    const data = args[0] as T[K];
    for (const fn of [...set]) {
      (fn as (data: T[K]) => void)(data);
    }
  }

  /** Remove all handlers (used during teardown). */
  clear(): void {
    this.handlers.clear();
  }
}
