// Normalization step 2: ledger settings, account roots and commodities as declared
// (docs/core/settings.md; docs/core/accounts.md; docs/core/commodities.md).

import type {
  Account,
  AccountRoot,
  AccountType,
  Commodity,
  Id,
  LedgerSettings,
} from "../../data/model/types.js";
import type { DeclarationData, ItemData } from "../../data/raw/model.js";
import type { Diagnostic, SourcePath } from "../../data/source/source.js";
import { isTimeZone } from "../../data/time/time.js";
import { diagnostic } from "../../data/source/diagnostics.js";
import type { HuekeOptions } from "../hueke.js";

export interface Declarations {
  readonly settings: LedgerSettings;
  readonly roots: Map<string, AccountRoot>;
  readonly commodities: Map<Id, Commodity>;
}

const BUILTIN_ROOTS: readonly [string, AccountType][] = [
  ["Assets", "asset"],
  ["Liabilities", "liability"],
  ["Equity", "equity"],
  ["Income", "income"],
  ["Expenses", "expense"],
];
const OPTIONS = new Set(["timezone"]);

export function collectDeclarations(
  items: readonly ItemData[],
  source: SourcePath,
  options: HuekeOptions,
  out: Diagnostic[],
): Declarations {
  const declarations = items.filter(
    (i): i is DeclarationData => i.kind !== "transaction" && i.kind !== "balance",
  );
  const report = (
    code: Parameters<typeof diagnostic>[0],
    message: string,
    d: DeclarationData,
  ): void => {
    out.push(diagnostic(code, message, source, d.span));
  };

  // ---- Account roots ----
  const roots = new Map<string, AccountRoot>(
    BUILTIN_ROOTS.map(([name, type]) => [name, { name, type, builtin: true }]),
  );
  // The parser has checked the shape of each account-root.
  for (const d of declarations.filter((x) => x.kind === "account-root")) {
    const [name = "", type = ""] = d.args;
    roots.set(name, { name, type: type as AccountType, builtin: false });
  }

  // ---- Options ----
  const byName = new Map<string, DeclarationData[]>();
  for (const d of declarations.filter((x) => x.kind === "option")) {
    const [name] = d.args;
    if (name === undefined || !OPTIONS.has(name)) {
      report("option.unknown", `unknown option "${name ?? ""}"`, d);
      continue;
    }
    const list = byName.get(name);
    if (list) list.push(d);
    else byName.set(name, [d]);
  }
  const value = (name: string): { value: string; at: DeclarationData } | undefined => {
    const list = byName.get(name);
    if (!list) return undefined;
    const [first, ...rest] = list;
    if (!first) return undefined;
    // Conflicting writings are all dropped: the result does not depend on their order.
    for (const d of rest) report("option.duplicate", `option ${name} is written more than once`, d);
    if (rest.length > 0) return undefined;
    return { value: first.args.slice(1).join(" "), at: first };
  };

  const tz = value("timezone");
  let timezone: string | undefined;
  if (tz) {
    if (isTimeZone(tz.value)) timezone = tz.value;
    else
      report(
        "option.invalid-value",
        `"${tz.value}" is not a valid value of option timezone`,
        tz.at,
      );
  }
  if (timezone === undefined) {
    if (options.timezone !== undefined) timezone = options.timezone;
    else if (!byName.has("timezone"))
      out.push(diagnostic("option.missing-timezone", "no default time zone: using UTC", source));
  }
  const settings: LedgerSettings = { timezone: timezone ?? "UTC" };

  // ---- Commodities ----
  const commodities = new Map<Id, Commodity>();
  for (const d of declarations.filter((x) => x.kind === "commodity")) {
    const [id] = d.args;
    if (id === undefined || commodities.has(id)) continue;
    // The parser has checked each precision line.
    let precision: number | undefined;
    for (const line of d.lines)
      if (line.kind === "property" && line.key === "precision") precision = Number(line.value);
    commodities.set(id, {
      id,
      ...(d.span && { span: d.span }),
      precision: precision ?? 0,
      precisionWritten: precision !== undefined,
    });
  }

  return { settings, roots, commodities };
}

export function makeAccount(id: Id, roots: ReadonlyMap<string, AccountRoot>): Account {
  const colon = id.lastIndexOf(":");
  const type = roots.get(id.split(":")[0] ?? "")?.type;
  return { id, ...(type && { type }), ...(colon > 0 && { parent: id.slice(0, colon) }) };
}
