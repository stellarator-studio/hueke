// Normalization step 1: syntax the parser reads but Core does not implement yet
// (docs/core/diagnostics.md, "Unsupported syntax"). Each such record is reported as
// syntax.unsupported and dropped, so a ledger never computes as if the line were not there.
// An entry goes when its feature is built.

import type { ItemData, PostingData } from "../../data/raw/model.js";
import type { Diagnostic, SourcePath } from "../../data/source/source.js";
import { diagnostic } from "../../data/source/diagnostics.js";

const DECLARATIONS = new Set(["entity", "schedule", "installment", "rule", "cap-group", "module"]);
const ROOT_TYPES = new Set(["shared"]);
const PROPERTIES = new Set([
  "account name",
  "account obligation",
  "account pad-account",
  "account active",
  "account allow",
  "account deny",
  "account statement",
  "account source",
  "account self",
  "account map",
  "transaction share",
  "transaction into",
]);

/** The items Core supports; reports every other one. */
export function supported(
  items: readonly ItemData[],
  source: SourcePath,
  out: Diagnostic[],
): ItemData[] {
  return items.filter((item) => {
    const what = unsupported(item);
    if (what !== undefined)
      out.push(diagnostic("syntax.unsupported", `${what} is not supported yet`, source, item.span));
    return what === undefined;
  });
}

function unsupported(item: ItemData): string | undefined {
  if (item.kind === "balance") return item.entity === undefined ? undefined : "balance @entity";
  if (item.kind === "transaction") {
    for (const line of item.lines)
      if (line.kind === "property" && PROPERTIES.has(`transaction ${line.key}`)) return line.key;
    for (const p of item.postings) {
      const what = posting(p);
      if (what !== undefined) return what;
    }
    return undefined;
  }
  if (DECLARATIONS.has(item.kind)) return item.kind;
  if (item.kind === "account" && item.anchor !== undefined) return "an account's %anchor";
  if (item.kind === "account-root" && ROOT_TYPES.has(item.args[1] ?? ""))
    return `account-root of type ${item.args[1] ?? ""}`;
  for (const line of item.lines)
    if (line.kind === "property" && PROPERTIES.has(`${item.kind} ${line.key}`))
      return `${item.kind} ${line.key}`;
  return undefined;
}

function posting(p: PostingData): string | undefined {
  for (const line of p.lines)
    if (line.kind === "split" || line.kind === "paid-by") return line.kind;
  return undefined;
}
