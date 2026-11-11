// Normalization step 2: ledger settings, account roots, commodities, accounts and entities as
// declared. Only the root module's declarations take effect (docs/core/modules.md, "Declarations
// in included modules"). A commodity, account, account root or entity declared twice keeps its
// first declaration (docs/core/ledger.md, "Duplicate declarations"). Accounts inside an obligation
// account inherit its settings (docs/core/accounts.md, "Obligation and pad settings").

import type {
  Account,
  AccountRoot,
  AccountType,
  Commodity,
  CommodityAlias,
  Entity,
  Id,
  LedgerSettings,
  ObligationKind,
} from "../../data/model/types.js";
import { obligationPlace } from "../../data/model/account.js";
import type { DeclarationData } from "../../data/raw/model.js";
import type { Diagnostic, SourcePath, SourceSpan } from "../../data/source/source.js";
import {
  isSettingName,
  readSetting,
  type SettingName,
  type SettingValues,
} from "../../data/model/settings.js";
import { aliasTableOf, type AliasEntry, type AliasTable } from "../../data/values/number.js";
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
  readonly entities: Map<Id, Entity>;
  readonly aliases: AliasTable;
  /** The module of each declared commodity, account and entity, for their diagnostics. */
  readonly sources: Map<Commodity | Account | Entity, SourcePath>;
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
const DECLARATIONS = new Set(["option", "account-root", "commodity", "account", "entity"]);

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
  const byName = new Map<SettingName, Sourced[]>();
  for (const at of kind("option")) {
    const [name] = at.d.args;
    if (name === undefined || !isSettingName(name)) {
      report("option.unknown", `unknown option "${name ?? ""}"`, at);
      continue;
    }
    const list = byName.get(name);
    if (list) list.push(at);
    else byName.set(name, [at]);
  }
  /** The value written once, read; undefined when not written, written twice or invalid. */
  const read = <N extends SettingName>(
    name: N,
  ): { value: SettingValues[N]; at: Sourced } | undefined => {
    const list = byName.get(name);
    if (!list) return undefined;
    const [first, ...rest] = list;
    if (!first) return undefined;
    // Conflicting writings are all dropped: the result does not depend on their order.
    for (const d of rest) report("option.duplicate", `option ${name} is written more than once`, d);
    if (rest.length > 0) return undefined;
    const text = first.d.args[1] ?? "";
    const valid = readSetting(name, text);
    if (valid) return { value: valid.value, at: first };
    report("option.invalid-value", `"${text}" is not a valid value of option ${name}`, first);
    return undefined;
  };

  let timezone = read("timezone")?.value;
  if (timezone === undefined) {
    if (options.timezone !== undefined) timezone = options.timezone;
    else if (!byName.has("timezone"))
      out.push(diagnostic("option.missing-timezone", "no default time zone: using UTC", root));
  }

  // Undefined when not written, not valid, or written twice.
  let decimalMark = read("decimal-mark")?.value;
  let groupMark = read("group-mark")?.value;
  if (decimalMark !== undefined && decimalMark === groupMark) {
    const at = byName.get("decimal-mark")?.[0];
    if (at) report("option.invalid-number-format", "decimal-mark and group-mark are the same", at);
    decimalMark = ".";
    groupMark = ",";
  }
  // When only one mark takes effect, the other's default gives way to it.
  if (decimalMark === undefined) decimalMark = groupMark === "." ? "," : ".";
  if (groupMark === undefined) groupMark = decimalMark === "," ? "." : ",";

  const weekStart = read("week-start")?.value ?? "monday";

  let strict = read("strict")?.value ?? [];
  if (options.strict) strict = ["account", "commodity", "entity"];

  // `on [<name>]`: income and expense roots are shown under one merged root (docs/core/accounts.md).
  const ie = read("income-expense");
  let incomeExpenseRoot: string | undefined;
  if (ie) {
    if (roots.has(ie.value))
      report("option.invalid-root", `${ie.value} is already an account root`, ie.at);
    else incomeExpenseRoot = ie.value;
  }

  const padAccount = read("pad-account")?.value;
  const settings: LedgerSettings = {
    timezone: timezone ?? "UTC",
    ...(padAccount !== undefined && { padAccount }),
    weekStart,
    strict,
    ...(incomeExpenseRoot !== undefined && { incomeExpenseRoot }),
    decimalMark,
    groupMark,
  };

  const sources = new Map<Commodity | Account | Entity, SourcePath>();
  const property = (d: DeclarationData, key: string): string | undefined => {
    const line = d.lines.find((l) => l.kind === "property" && l.key === key);
    return line?.kind === "property" ? line.value : undefined;
  };

  // ---- Commodities and aliases ----
  // The parser has checked each precision and alias line.
  const commodities = new Map<Id, Commodity>();
  const commodityDeclared = new Map<Id, Sourced>();
  const aliasEntries: (AliasEntry & { at: Sourced })[] = [];
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
        aliasEntries.push({ ...alias, owner: id, at });
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
  // A conflicting alias is not loaded for any declaration; amounts read as if it were not declared.
  const { table: aliasTable, conflicts } = aliasTableOf(aliasEntries, (t) => commodities.has(t));
  for (const [first, ...others] of conflicts)
    for (const o of others.length > 0 ? others : first ? [first] : [])
      report("commodity.alias-conflict", `alias "${o.text}" of ${o.owner} is already used`, o.at);

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
    const primary = property(at.d, "primary");
    const displayName = property(at.d, "display-name");
    const obligation = property(at.d, "obligation") as ObligationKind | undefined;
    const padAccount = property(at.d, "pad-account");
    const account = makeAccount(id, roots, {
      ...(at.d.span && { span: at.d.span }),
      ...(at.d.anchor && { anchor: at.d.anchor.name }),
      ...(displayName !== undefined && { displayName }),
      ...(primary !== undefined && { primaryCommodity: primary }),
      ...(obligation !== undefined && { obligation }),
      ...(padAccount !== undefined && { padAccount }),
      meta: metaFrom(at.d.lines, at.d.trailer),
    });
    accounts.set(id, account);
    sources.set(account, at.source);
  }

  // An `obligation` inside an obligation account takes no effect; outer accounts come first.
  const byDepth = [...accounts.values()]
    .filter((a) => a.obligation !== undefined)
    .sort((a, b) => a.id.split(":").length - b.id.split(":").length);
  const effective = new Map<Id, Account>();
  const nested = new Set<Id>();
  for (const a of byDepth) {
    const place = obligationPlace(a.id, effective);
    if (place === undefined) {
      effective.set(a.id, a);
      continue;
    }
    const at = accountDeclared.get(a.id);
    nested.add(a.id);
    if (at)
      report(
        "obligation.nested",
        `${a.id} is inside the obligation account ${place.root}; its obligation takes no effect`,
        at,
      );
  }
  // An obligation has no sub-accounts: declaring one is reported, once.
  for (const [id, at] of accountDeclared) {
    const place = obligationPlace(id, effective);
    if (place?.kind === "nested" && !nested.has(id))
      report(
        "obligation.nested",
        `${id} is inside the obligation ${place.obligation}; an obligation has no sub-accounts`,
        at,
      );
  }
  for (const [id, a] of accounts) {
    if (effective.has(id)) continue;
    const rest: { -readonly [K in keyof Account]?: Account[K] } = { ...a };
    delete rest.obligation;
    accounts.set(id, inherit(rest as Account, effective));
  }

  // ---- Entities ----
  const entities = new Map<Id, Entity>();
  const entityDeclared = new Map<Id, Sourced>();
  for (const at of kind("entity")) {
    const [id = ""] = at.d.args;
    const first = entityDeclared.get(id);
    if (first) {
      duplicate(`entity ${id}`, first, at);
      continue;
    }
    entityDeclared.set(id, at);
    const displayName = property(at.d, "display-name");
    const entity: Entity = {
      id,
      ...(at.d.span && { span: at.d.span }),
      ...(displayName !== undefined && { displayName }),
      meta: metaFrom(at.d.lines, at.d.trailer),
    };
    entities.set(id, entity);
    sources.set(entity, at.source);
  }

  return {
    settings,
    roots,
    commodities,
    accounts,
    entities,
    aliases: aliasTable,
    sources,
    ...(incomeExpenseRoot !== undefined &&
      ie && {
        incomeExpenseAt: { source: ie.at.source, ...(ie.at.d.span && { span: ie.at.d.span }) },
      }),
  };
}

/**
 * An account inside an obligation account takes its `obligation`, and its `pad-account` unless it
 * declares one. `obligations` holds the obligation accounts.
 */
export function inherit(account: Account, obligations: ReadonlyMap<Id, Account>): Account {
  const place = obligationPlace(account.id, obligations);
  const root = place && obligations.get(place.root);
  if (!root?.obligation) return account;
  const padAccount = account.padAccount ?? root.padAccount;
  return {
    ...account,
    obligation: root.obligation,
    ...(padAccount !== undefined && { padAccount }),
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
