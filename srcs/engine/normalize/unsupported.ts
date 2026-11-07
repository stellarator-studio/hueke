// Normalization step 1: syntax the parser reads but Core does not implement yet
// (docs/core/diagnostics.md, "Unsupported syntax"). Each such record is reported as
// syntax.unsupported and dropped, so a ledger never computes as if the line were not there.
// An entry goes when its feature is built.

import type { ItemData, PostingData, TagData } from "../../data/raw/model.js";
import type { Diagnostic, SourcePath } from "../../data/source/source.js";
import { diagnostic } from "../../data/source/diagnostics.js";

const DECLARATIONS = new Set(["schedule", "installment", "rule", "module"]);
const ROOT_TYPES = new Set(["shared"]);
const SCOPES = new Set(["installment", "statement", "fulfills", "rule", "shared"]);
const PROPERTIES = new Set([
  "entity type",
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

/**
 * The items Core supports, and the transactions it does not, marked dropped; reports every
 * unsupported item. Other unsupported items are left out.
 */
export function supported(
  items: readonly ItemData[],
  source: SourcePath,
  out: Diagnostic[],
): { item: ItemData; dropped?: true }[] {
  return items.flatMap((item) => {
    const what = unsupported(item);
    if (what === undefined) return [{ item }];
    out.push(diagnostic("syntax.unsupported", `${what} is not supported yet`, source, item.span));
    return item.kind === "transaction" ? [{ item, dropped: true as const }] : [];
  });
}

function unsupported(item: ItemData): string | undefined {
  if (item.kind === "balance") return undefined;
  if (item.kind === "transaction") {
    for (const line of item.lines)
      if (line.kind === "property" && PROPERTIES.has(`transaction ${line.key}`)) return line.key;
    if (item.anchor?.period !== undefined) return "a period after an anchor";
    for (const p of item.postings) {
      const what = posting(p);
      if (what !== undefined) return what;
    }
    return tags(item.tags);
  }
  if (DECLARATIONS.has(item.kind)) return item.kind;
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
  return tags(p.tags);
}

function tags(list: readonly TagData[]): string | undefined {
  for (const t of list) {
    if (t.scope !== undefined && SCOPES.has(t.scope)) return `the tag scope ${t.scope}`;
    if (t.ref.period !== undefined) return "a period after an anchor";
  }
  return undefined;
}
