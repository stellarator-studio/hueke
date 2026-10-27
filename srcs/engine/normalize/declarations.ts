// Normalization step 2: ledger settings, account roots, commodities and accounts as declared.
// Only the root module's declarations take effect (docs/core/modules.md, "Declarations in
// included modules"). A commodity, account or account root declared twice keeps its first
// declaration (docs/core/ledger.md, "Duplicate declarations").

import type {
  Account,
  AccountRoot,
  AccountType,
  Commodity,
  CommodityAlias,
  Id,
  LedgerSettings,
  Weekday,
} from "../../data/model/types.js";
import type { DeclarationData } from "../../data/raw/model.js";
import type { Diagnostic, SourcePath, SourceSpan } from "../../data/source/source.js";
import { isTimeZone } from "../../data/time/time.js";
import type { AliasTable } from "../../data/values/number.js";
import { diagnostic } from "../../data/source/diagnostics.js";
import type { HuekeOptions } from "../hueke.js";
import { metaFrom, type SourcedItem } from "./shared.js";

/** A declaration with its module. */
interface Sourced {
  readonly d: DeclarationData;
  readonly source: SourcePath;
}

/** Names a place for messages, such as `main.hueke:3`. */
export type Where = (source: SourcePath, span: SourceSpan | undefined) => string;

export interface Declarations {
  readonly settings: LedgerSettings;
  readonly roots: Map<string, AccountRoot>;
  readonly commodities: Map<Id, Commodity>;
  readonly accounts: Map<Id, Account>;
  readonly aliases: AliasTable;
  /** The module of each declared commodity and account, for their diagnostics. */
  readonly sources: Map<Commodity | Account, SourcePath>;
  /** Where `option income-expense` is written, when it took effect. */
  readonly incomeExpenseAt?: { readonly source: SourcePath; readonly span?: SourceSpan };
}

const BUILTIN_ROOTS: readonly [string, AccountType][] = [
  ["Assets", "asset"],
  ["Liabilities", "liability"],
  ["Equity", "equity"],
  ["Income", "income"],
  ["Expenses", "expense"],
];
const WEEKDAYS: readonly Weekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];
const DECLARATIONS = new Set(["option", "account-root", "commodity", "account"]);
const OPTIONS = new Set([
  "timezone",
  "pad-account",
  "decimal-mark",
  "group-mark",
  "week-start",
  "strict",
  "income-expense",
]);

export function collectDeclarations(
  items: readonly SourcedItem[],
  root: SourcePath,
  options: HuekeOptions,
  where: Where,
  out: Diagnostic[],
): Declarations {
  const report = (code: Parameters<typeof diagnostic>[0], message: string, at: Sourced): void => {
    out.push(diagnostic(code, message, at.source, at.d.span));
  };
  const declarations: Sourced[] = [];
  for (const { item, source } of items) {
    if (item.kind === "transaction" || item.kind === "balance" || !DECLARATIONS.has(item.kind))
      continue;
    if (source === root) declarations.push({ d: item, source });
    else
      report(
        "module.ignored-declaration",
        `${item.kind} ${item.args[0] ?? ""} is ignored: only the root module's declarations take effect`,
        { d: item, source },
      );
  }
  const kind = (k: DeclarationData["kind"]): Sourced[] =>
    declarations.filter((x) => x.d.kind === k);
  const duplicate = (what: string, first: Sourced, at: Sourced): void => {
    report(
      "declaration.duplicate",
      `${what} is declared again; the first declaration (${where(first.source, first.d.span)}) is used`,
      at,
    );
  };

  // ---- Roots first: the merged root of option income-expense must not name a root ----
  // The parser has checked the shape of each account-root.
  const roots = new Map<string, AccountRoot>(
    BUILTIN_ROOTS.map(([name, type]) => [name, { name, type, builtin: true }]),
  );
  const rootDeclared = new Map<string, Sourced>();
  for (const at of kind("account-root")) {
    const [name = "", type = ""] = at.d.args;
    const first = rootDeclared.get(name);
    if (first) {
      duplicate(`account-root ${name}`, first, at);
      continue;
    }
    rootDeclared.set(name, at);
    roots.set(name, { name, type: type as AccountType, builtin: false });
  }

  // ---- Options ----
  const byName = new Map<string, Sourced[]>();
  for (const at of kind("option")) {
    const [name] = at.d.args;
    if (name === undefined || !OPTIONS.has(name)) {
      report("option.unknown", `unknown option "${name ?? ""}"`, at);
      continue;
    }
    const list = byName.get(name);
    if (list) list.push(at);
    else byName.set(name, [at]);
  }
  const value = (name: string): { value: string; at: Sourced } | undefined => {
    const list = byName.get(name);
    if (!list) return undefined;
    const [first, ...rest] = list;
    if (!first) return undefined;
    // Conflicting writings are all dropped: the result does not depend on their order.
    for (const d of rest) report("option.duplicate", `option ${name} is written more than once`, d);
    if (rest.length > 0) return undefined;
    return { value: first.d.args.slice(1).join(" "), at: first };
  };
  const invalid = (name: string, v: { value: string; at: Sourced }): void => {
    report("option.invalid-value", `"${v.value}" is not a valid value of option ${name}`, v.at);
  };
  /** The written value when `accept` maps it, else the default (reporting an invalid one). */
  const pick = <T>(name: string, accept: ReadonlyMap<string, T>, fallback: T): T => {
    const v = value(name);
    if (v === undefined) return fallback;
    if (accept.has(v.value)) return accept.get(v.value) as T;
    invalid(name, v);
    return fallback;
  };

  const tz = value("timezone");
  let timezone: string | undefined;
  if (tz) {
    if (isTimeZone(tz.value)) timezone = tz.value;
    else invalid("timezone", tz);
  }
  if (timezone === undefined) {
    if (options.timezone !== undefined) timezone = options.timezone;
    else if (!byName.has("timezone"))
      out.push(diagnostic("option.missing-timezone", "no default time zone: using UTC", root));
  }

  // Undefined when not written, not valid, or written twice.
  let decimalMark = pick<LedgerSettings["decimalMark"] | undefined>(
    "decimal-mark",
    new Map([
      [".", "."],
      [",", ","],
    ]),
    undefined,
  );
  let groupMark = pick<LedgerSettings["groupMark"] | undefined>(
    "group-mark",
    new Map<string, LedgerSettings["groupMark"]>([
      [",", ","],
      [".", "."],
      ["'", "'"],
      ["none", null],
    ]),
    undefined,
  );
  if (decimalMark !== undefined && decimalMark === groupMark) {
    const at = byName.get("decimal-mark")?.[0];
    if (at) report("option.invalid-number-format", "decimal-mark and group-mark are the same", at);
    decimalMark = ".";
    groupMark = ",";
  }
  // When only one mark takes effect, the other's default gives way to it.
  if (decimalMark === undefined) decimalMark = groupMark === "." ? "," : ".";
  if (groupMark === undefined) groupMark = decimalMark === "," ? "." : ",";

  const weekStart = pick<Weekday>("week-start", new Map(WEEKDAYS.map((w) => [w, w])), "monday");

  const st = value("strict");
  let strict: LedgerSettings["strict"] = [];
  if (st) {
    const kinds = st.value.split(",").map((s) => s.trim());
    if (kinds.every((k) => k === "account" || k === "commodity" || k === "entity")) strict = kinds;
    else invalid("strict", st);
  }
  if (options.strict) strict = ["account", "commodity", "entity"];

  // `on [<name>]`: income and expense roots are shown under one merged root (docs/core/accounts.md).
  const ie = value("income-expense");
  let incomeExpenseRoot: string | undefined;
  if (ie) {
    const [on, name = "IncomeExpenses", ...rest] = ie.value.split(/\s+/);
    if (on !== "on" || rest.length > 0 || !/^\p{L}[^\s:;",]*$/u.test(name))
      invalid("income-expense", ie);
    else if (roots.has(name))
      report("option.invalid-root", `${name} is already an account root`, ie.at);
    else incomeExpenseRoot = name;
  }

  const pa = value("pad-account");
  const settings: LedgerSettings = {
    timezone: timezone ?? "UTC",
    ...(pa && { padAccount: pa.value }),
    weekStart,
    strict,
    ...(incomeExpenseRoot !== undefined && { incomeExpenseRoot }),
    decimalMark,
    groupMark,
  };

  const sources = new Map<Commodity | Account, SourcePath>();

  // ---- Commodities and aliases ----
  // The parser has checked each precision and alias line.
  const commodities = new Map<Id, Commodity>();
  const commodityDeclared = new Map<Id, Sourced>();
  const aliasOwners = new Map<
    string,
    { position: "prefix" | "suffix"; owner: Id; at: Sourced }[]
  >();
  for (const at of kind("commodity")) {
    const [id = ""] = at.d.args;
    const first = commodityDeclared.get(id);
    if (first) {
      duplicate(`commodity ${id}`, first, at);
      continue;
    }
    commodityDeclared.set(id, at);
    let item = false;
    let precision: number | undefined;
    const aliases: CommodityAlias[] = [];
    for (const line of at.d.lines) {
      if (line.kind !== "property") continue;
      if (line.key === "item") item = true;
      else if (line.key === "precision") precision = Number(line.value);
      else if (line.key === "alias") {
        const [text = "", position] = line.value.split(/\s+/);
        const alias: CommodityAlias = { text, position: position as "prefix" | "suffix" };
        aliases.push(alias);
        const list = aliasOwners.get(alias.text) ?? [];
        list.push({ position: alias.position, owner: id, at });
        aliasOwners.set(alias.text, list);
      }
    }
    const commodity: Commodity = {
      id,
      ...(at.d.span && { span: at.d.span }),
      item,
      precision: item ? 0 : (precision ?? 0),
      precisionWritten: item || precision !== undefined,
      aliases,
      meta: metaFrom(at.d.lines, at.d.trailer),
    };
    commodities.set(id, commodity);
    sources.set(commodity, at.source);
  }
  const prefix = new Map<string, Id>();
  const suffix = new Map<string, Id>();
  const conflicted = new Set<string>();
  for (const [text, owners] of aliasOwners) {
    const [first, ...others] = owners;
    if (!first) continue;
    if (others.length > 0 || commodities.has(text)) {
      conflicted.add(text);
      for (const o of others.length > 0 ? others : [first])
        report("commodity.alias-conflict", `alias "${text}" of ${o.owner} is already used`, o.at);
      continue;
    }
    (first.position === "prefix" ? prefix : suffix).set(text, first.owner);
  }

  // ---- Accounts ----
  const accounts = new Map<Id, Account>();
  const accountDeclared = new Map<Id, Sourced>();
  for (const at of kind("account")) {
    const [id = ""] = at.d.args;
    const first = accountDeclared.get(id);
    if (first) {
      duplicate(`account ${id}`, first, at);
      continue;
    }
    accountDeclared.set(id, at);
    const primary = at.d.lines.find((l) => l.kind === "property" && l.key === "primary");
    const account = makeAccount(id, roots, {
      ...(at.d.span && { span: at.d.span }),
      ...(primary?.kind === "property" && { primaryCommodity: primary.value }),
      meta: metaFrom(at.d.lines, at.d.trailer),
    });
    accounts.set(id, account);
    sources.set(account, at.source);
  }

  return {
    settings,
    roots,
    commodities,
    accounts,
    aliases: { prefix, suffix, conflicted },
    sources,
    ...(incomeExpenseRoot !== undefined &&
      ie && {
        incomeExpenseAt: { source: ie.at.source, ...(ie.at.d.span && { span: ie.at.d.span }) },
      }),
  };
}

export function makeAccount(
  id: Id,
  roots: ReadonlyMap<string, AccountRoot>,
  extra: Partial<Account> = {},
): Account {
  const colon = id.lastIndexOf(":");
  const type = roots.get(id.split(":")[0] ?? "")?.type;
  return {
    id,
    ...(type && { type }),
    ...(colon > 0 && { parent: id.slice(0, colon) }),
    meta: {},
    ...extra,
  };
}
