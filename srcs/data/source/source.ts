// Source positions, text patches and diagnostics shared by the parser, the Raw model and the
// engine.

/** Logical path of a source file; given by the adapter and used as the ModuleData key. */
export type SourcePath = string;

/**
 * A range in one source. Which source is decided by the ModuleData that holds it.
 * Offsets count UTF-16 code units, like JS string indices.
 */
export interface SourceSpan {
  readonly start: number;
  readonly end: number; // exclusive
}

/**
 * Replaces [start, end) of a module's text as parsed with `text` (docs/core/ledger.md, "Text
 * patches"). An insertion has start equal to end and an empty `expect`.
 */
export interface TextPatch {
  readonly source: SourcePath;
  readonly start: number;
  readonly end: number;
  readonly text: string;
  /** The text being replaced; the platform refuses the patch when the file no longer matches. */
  readonly expect: string;
}

export interface Diagnostic {
  readonly code: string; // e.g. "txn.unbalanced"
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly source?: SourcePath; // where `span` is
  readonly span?: SourceSpan;
}

/** Line and column of an offset, both 1-based; the column counts UTF-16 code units. */
export function position(
  data: { readonly lineStarts: readonly number[] },
  offset: number,
): { line: number; column: number } {
  const starts = data.lineStarts;
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((starts[mid] ?? 0) <= offset) low = mid;
    else high = mid - 1;
  }
  return { line: low + 1, column: offset - (starts[low] ?? 0) + 1 };
}
