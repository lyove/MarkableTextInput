/**
 * Snapshot history stack (undo / redo).
 * Framework-agnostic — no React dependency.
 */
const HISTORY_LIMIT = 100;

export interface HistoryApi<T> {
  commit: (next: T, merge?: boolean, mergeKey?: string) => void;
  undo: () => void;
  redo: () => void;
  breakMerge: () => void;
}

export class History<T> implements HistoryApi<T> {
  private past: T[] = [];
  private future: T[] = [];
  private onChange: (v: T) => void;
  private value: T;
  private lastWasMerge = false;
  private lastMergeKey: string | null = null;

  constructor(value: T, onChange: (v: T) => void) {
    this.value = value;
    this.onChange = onChange;
  }

  /**
   * Keep the tracked current value in sync with external updates.
   */
  setValue(value: T): void {
    this.value = value;
    this.past = [];
    this.future = [];
    this.lastWasMerge = false;
    this.lastMergeKey = null;
  }

  /**
   * Commit the next document snapshot
   */
  commit(next: T, merge = false, mergeKey?: string): void {
    const canMerge =
      merge && this.lastWasMerge && (mergeKey === undefined || this.lastMergeKey === mergeKey);
    if (!canMerge) {
      this.past.push(this.value);
      if (this.past.length > HISTORY_LIMIT) {
        this.past.shift();
      }
    }
    this.lastWasMerge = merge;
    this.lastMergeKey = merge ? mergeKey ?? null : null;
    this.future = [];
    this.value = next;
    this.onChange(next);
  }

  undo(): void {
    const prev = this.past.pop();
    if (prev === undefined) {
      return;
    }
    this.lastWasMerge = false;
    this.lastMergeKey = null;
    this.future.push(this.value);
    this.value = prev;
    this.onChange(prev);
  }

  redo(): void {
    const next = this.future.pop();
    if (next === undefined) {
      return;
    }
    this.lastWasMerge = false;
    this.lastMergeKey = null;
    this.past.push(this.value);
    this.value = next;
    this.onChange(next);
  }

  breakMerge(): void {
    this.lastWasMerge = false;
    this.lastMergeKey = null;
  }
}
