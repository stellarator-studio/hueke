// Anchor keys: one string per Anchor, for indexing definitions and references together.

import type { AnchorRef } from "./model.js";

/**
 * `[<module>:]<name>[/<period>]`, e.g. "lunch", "esun-card/2026-10", "trip:t1"; the same text as
 * written after `%` or a tag's scope. Unambiguous because names cannot contain `/`, `.` or `:`.
 */
export function anchorKey(ref: AnchorRef): string {
  const scoped = ref.module === undefined ? ref.name : `${ref.module}:${ref.name}`;
  return ref.period === undefined ? scoped : `${scoped}/${ref.period}`;
}
