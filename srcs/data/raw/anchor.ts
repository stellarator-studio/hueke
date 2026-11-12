// Anchor keys: one string per Anchor, for indexing definitions and references together.

import type { AnchorRef } from "./model.js";

/**
 * Tag scopes the parser reads but Core does not implement yet (docs/core/diagnostics.md,
 * "Unsupported syntax"): a tag with one of them is unsupported syntax.
 */
export const UNSUPPORTED_SCOPES: ReadonlySet<string> = new Set([
  "installment",
  "statement",
  "fulfills",
  "rule",
  "shared",
]);

/**
 * `[<module>:]<name>[/<period>]`, e.g. "lunch", "esun-card/2026-10", "trip:t1"; the same text as
 * written after `%` or a tag's scope. Unambiguous because names cannot contain `/`, `.` or `:`.
 */
export function anchorKey(ref: AnchorRef): string {
  const scoped = ref.module === undefined ? ref.name : `${ref.module}:${ref.name}`;
  return ref.period === undefined ? scoped : `${scoped}/${ref.period}`;
}
