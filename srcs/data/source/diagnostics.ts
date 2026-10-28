// Diagnostic codes and their fixed severities (docs/core/diagnostics.md). A code never changes
// its severity; codes of later features are added with them.

import type { Diagnostic, SourcePath, SourceSpan } from "./source.js";

const SEVERITY = {
  "option.unknown": "error",
  "option.duplicate": "error",
  "option.invalid-value": "error",
  "option.missing-timezone": "warning",
  "time.nonexistent-local-time": "error",
  "time.ambiguous-local-time": "error",
  "time.nonexistent-week": "error",
  "time.offset-mismatch": "error",
  "parse.syntax": "error",
  "parse.orphan-line": "error",
  "parse.unexpected-property": "error",
  "parse.duplicate-property": "error",
  "parse.token-order": "error",
  "parse.unterminated-string": "error",
  "parse.invalid-time": "error",
  "parse.invalid-number": "error",
  "parse.metadata-after-breakdown": "warning",
  "txn.unbalanced": "error",
  "txn.amount-not-inferable": "error",
  "posting.excess-precision": "warning",
  "breakdown.invalid-figure": "warning",
  "breakdown.commodity-mismatch": "error",
  "module.missing": "error",
  "syntax.unsupported": "error",
} as const satisfies Record<string, Diagnostic["severity"]>;

export type Code = keyof typeof SEVERITY;

export function diagnostic(
  code: Code,
  message: string,
  source?: SourcePath,
  span?: SourceSpan,
): Diagnostic {
  return {
    code,
    severity: SEVERITY[code],
    message,
    ...(source !== undefined && { source }),
    ...(span && { span }),
  };
}
