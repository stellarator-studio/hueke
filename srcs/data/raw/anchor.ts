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
]);

/**
 * `[shared:][<module>:]<name>[/<period>]`, e.g. "lunch", "esun-card/2026-10", "shared:trip",
 * "shared:trip:t1" (docs/core/anchors.md, "Concepts"); the same text as written after `%`, or
 * after a tag's scope when that is not `shared`. Unambiguous because names cannot contain `/`,
 * `.` or `:`.
 */
export function anchorKey(ref: AnchorRef): string {
  const named = ref.module === undefined ? ref.name : `${ref.module}:${ref.name}`;
  const scoped = ref.scope === undefined ? named : `${ref.scope}:${named}`;
  return ref.period === undefined ? scoped : `${scoped}/${ref.period}`;
}
