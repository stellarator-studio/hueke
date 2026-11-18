// Group ledgers (docs/core/group-ledgers.md). Each group ledger a shared account refers to is read
// like a ledger of its own, in its own namespace: declarations, records, anchors and tags. Its
// transactions are then converted, in step 6, into transactions of the owner's ledger: the
// owner's share of the spending, the money the owner paid, and the shared account for the rest.
// A transaction of the owner's ledger tagged `#shared:` replaces the owner's money. A group ledger
// opened on its own is checked the same way, without an owner, and converts nothing.

import type {
  Account,
  Amount,
  Commodity,
  GroupLedger,
  GroupShare,
  Id,
  LedgerSettings,
  Posting,
  Reference,
  SharedAccount,
  Tag,
  Transaction,
} from "../../data/model/types.js";
import { anchorKey } from "../../data/raw/anchor.js";
import type { AnchorRef, DeclarationData, SplitLine } from "../../data/raw/model.js";
import type { Diagnostic, SourcePath, SourceSpan } from "../../data/source/source.js";
import { diagnostic, type Code } from "../../data/source/diagnostics.js";
import {
  abs,
  add,
  cmp,
  decimal,
  div,
  isZero,
  mul,
  neg,
  rational,
  sub,
  ZERO,
  type Rational,
} from "../../data/values/decimal.js";
import { NumberError, parseNumber } from "../../data/values/number.js";
import { inAccount, isPnl } from "../../data/model/account.js";
import { duplicateAnchors, resolveTags } from "./anchors.js";
import {
  collectDeclarations,
  inheritCommodity,
  makeCommodity,
  type Declarations,
  type Where,
} from "./declarations.js";
import type { Referenced } from "./modules.js";
import { buildRecords, type RecordContext } from "./records.js";
import { weightOf, withinHalfUnit } from "./shared.js";

/** What reading a group transaction's postings needs. */
interface Sharing {
  readonly path: SourcePath;
  readonly shares: readonly GroupShare[];
  /** The owner's member; none for a group ledger on its own. */
  readonly self?: Id;
  readonly declared: Declarations;
}

/** A group ledger, read. */
export interface Group extends Sharing {
  /** Its name in this ledger, the shared account's `as`. */
  readonly name: string;
  readonly description?: string;
  /** Always known when a shared account refers to it. */
  readonly self: Id;
  /** The shared account that refers to it, with what it holds. */
  readonly account: Id;
  readonly shared: SharedAccount;
  /** Its transactions, with its own IDs, in source order. */
  readonly transactions: readonly Transaction[];
  /** Its commodities, declared or used, for checking that its transactions balance. */
  readonly commodities: ReadonlyMap<Id, Commodity>;
  /** Whether it converts: it is in the ledger's `groups`. */
  readonly converts: boolean;
}

/**
 * Reads each group ledger in its own namespace. Those whose shared account is incomplete are left
 * out; the others are returned, with `converts` false when one of them cannot convert.
 */
export function readGroups(
  referenced: readonly Referenced[],
  root: SourcePath,
  accounts: ReadonlyMap<Id, Account>,
  settings: LedgerSettings,
  where: Where,
  out: Diagnostic[],
): Group[] {
  const groups: Group[] = [];
  for (const ref of referenced) {
    const shared = accounts.get(ref.account)?.shared;
    if (!shared) continue; // shared.missing-source has been reported
    const accountSpan = accounts.get(ref.account)?.span;
    const declared = collectDeclarations(ref.items, ref.path, {}, where, out, settings);
    const shares = sharesOf(ref.declaration, ref.path, declared, out);
    let converts = true;
    if (!shares.some((s) => s.entity === shared.self)) {
      converts = false;
      out.push(
        diagnostic(
          "shared.unknown-module",
          `${ref.account}: @${shared.self} is not a member of ${ref.path}; nothing converts`,
          root,
          accountSpan,
        ),
      );
    }
    if (zeroShares(shares, ref.path, ref.declaration, out)) converts = false;
    const name = shared.as;
    const transactions = groupTransactions(ref, declared, out);
    groups.push({
      path: ref.path,
      name,
      ...(ref.declaration.description !== undefined && {
        description: ref.declaration.description,
      }),
      shares,
      self: shared.self,
      account: ref.account,
      shared,
      declared,
      transactions: transactions.list,
      commodities: transactions.commodities,
      converts,
    });
  }
  // Two group ledgers of one name: neither converts.
  const byName = new Map<string, Group>();
  const conflicted = new Set<Group>();
  for (const g of groups) {
    const first = byName.get(g.name);
    if (!first) {
      byName.set(g.name, g);
      continue;
    }
    conflicted.add(first).add(g);
    out.push(
      diagnostic(
        "module.name-conflict",
        `${g.account}: ${first.account} already names a group ledger ${g.name}; neither converts`,
        root,
        accounts.get(g.account)?.span,
      ),
    );
  }
  return groups.map((g) => (conflicted.has(g) ? { ...g, converts: false } : g));
}

/** The members and their default ratios; a ratio that cannot be read leaves its member out. */
function sharesOf(
  declaration: DeclarationData,
  path: SourcePath,
  declared: Declarations,
  out: Diagnostic[],
): GroupShare[] {
  const shares: GroupShare[] = [];
  for (const line of declaration.lines) {
    if (line.kind !== "property" || line.key !== "share") continue;
    const [entity = "", ratio = ""] = line.value.split(/\s+/);
    try {
      shares.push({ entity: entity.slice(1), ratio: parseNumber(ratio, declared.settings).value });
    } catch (e) {
      if (!(e instanceof NumberError)) throw e;
      out.push(diagnostic("parse.invalid-number", e.message, path, line.span));
    }
  }
  return shares;
}

/** Whether the default ratios add up to zero, which is reported. */
function zeroShares(
  shares: readonly GroupShare[],
  path: SourcePath,
  declaration: DeclarationData,
  out: Diagnostic[],
  converts = true,
): boolean {
  if (!shares.every((s) => isZero(rational(s.ratio)))) return false;
  out.push(
    diagnostic(
      "split.zero-ratio",
      converts
        ? `the shares of ${path} add up to zero; none of its transactions converts`
        : `the shares of ${path} add up to zero`,
      path,
      declaration.span,
    ),
  );
  return true;
}

/**
 * Checks a group ledger opened on its own (docs/core/group-ledgers.md, "A group ledger on its
 * own"): its default ratios, and each transaction's splits and member money. `transactions` are
 * the ledger's, read from the root.
 */
export function checkStandalone(
  declaration: DeclarationData,
  path: SourcePath,
  declared: Declarations,
  transactions: readonly Transaction[],
  out: Diagnostic[],
): void {
  const shares = sharesOf(declaration, path, declared, out);
  zeroShares(shares, path, declaration, out, false);
  const group: Sharing = { path, shares, declared };
  for (const t of transactions)
    readPostings(group, t, (code, message, span = t.span) => {
      out.push(diagnostic(code, message, path, span));
    });
}

/** Steps 3 to 5 for one group ledger: its transactions, with their tags resolved. */
function groupTransactions(
  ref: Referenced,
  declared: Declarations,
  out: Diagnostic[],
): { list: Transaction[]; commodities: Map<Id, Commodity> } {
  const where: Where = (source) => source;
  const duplicated = duplicateAnchors(ref.items, declared.accounts, where, out);
  const defines = (a: AnchorRef): boolean => !duplicated.has(anchorKey(a));
  const usedDecimals = new Map<Id, number>();
  const decimals = new Map<Posting, number>();
  const ctx: RecordContext = {
    source: ref.path,
    settings: declared.settings,
    format: declared.settings,
    aliases: declared.aliases,
    time: { timezone: declared.settings.timezone, weekStart: declared.settings.weekStart },
    roots: declared.roots,
    accounts: declared.accounts,
    defines,
    out,
    decimals,
    usedDecimals,
  };
  // A group ledger holds no Balances (docs/core/group-ledgers.md): its items have none.
  const list = buildRecords(ref.items, () => ctx).transactions;
  // Precisions as in the ledger: declared, else inferred from the group ledger's own amounts.
  const commodities = new Map(
    [...declared.commodities].map(([id, c]) => [
      id,
      c.precisionWritten ? c : { ...c, precision: usedDecimals.get(id) ?? 0 },
    ]),
  );
  for (const t of list)
    for (const p of t.postings)
      for (const id of [p.amount.commodity, p.price?.commodity, p.cost?.commodity])
        if (id !== undefined && id !== "" && !commodities.has(id)) {
          // Undeclared: inherited from the commodities above it, else inferred.
          const c = inheritCommodity(makeCommodity(id), declared.commodities);
          commodities.set(
            id,
            c.precisionWritten ? c : { ...c, precision: usedDecimals.get(id) ?? 0 },
          );
        }
  return { list: resolveTags(list, declared.accounts.values(), decimals, out), commodities };
}

/**
 * The IDs that the anchored transactions of converting group ledgers convert to, which `shared`
 * tags may name.
 */
export function anchoredIds(groups: readonly Group[]): Set<Id> {
  const ids = new Set<Id>();
  for (const g of groups)
    if (g.converts)
      for (const t of g.transactions)
        if (t.origin?.anchor && t.id === anchorKey(t.origin.anchor)) ids.add(`${g.name}:${t.id}`);
  return ids;
}

/** The group ledgers that convert, as the ledger lists them. */
export function groupLedgers(groups: readonly Group[]): GroupLedger[] {
  return groups
    .filter((g) => g.converts)
    .map((g) => ({
      path: g.path,
      name: g.name,
      ...(g.description !== undefined && { description: g.description }),
      shares: g.shares,
      account: g.account,
    }));
}

/**
 * Step 6, first: the converted transactions of every converting group ledger, in the order of the
 * group ledgers, then of their transactions. `transactions` are the owner's, with their tags
 * resolved; those with a `shared` tag are actual payments.
 */
export function convertGroups(
  groups: readonly Group[],
  transactions: readonly Transaction[],
  precision: (commodity: Id) => number,
  out: Diagnostic[],
): Transaction[] {
  const payments = new Map<Id, Transaction[]>();
  for (const t of transactions)
    for (const tag of t.tags)
      if (tag.scope === "shared" && tag.target !== undefined) {
        const list = payments.get(tag.target);
        if (list) {
          if (!list.includes(t)) list.push(t);
        } else payments.set(tag.target, [t]);
      }
  const converted: Transaction[] = [];
  for (const g of groups) {
    if (!g.converts) continue;
    for (const t of g.transactions) {
      const c = convert(g, t, payments.get(`${g.name}:${t.id}`) ?? [], precision, out);
      if (c) converted.push(c);
    }
  }
  return converted;
}

const SYSTEM_SHARED: Tag = { scope: "system", ref: { name: "shared" } };

/** A posting of the converted transaction, before its ID. */
interface Line {
  readonly from: Posting;
  readonly account: Id;
  readonly amount: Amount;
  readonly price?: Amount;
  readonly cost?: Amount;
}

/** A report of a diagnostic about one group transaction, at the transaction by default. */
type Report = (code: Code, message: string, span?: SourceSpan) => void;

/**
 * Reads a group transaction's postings: the owner's share of each spending posting, and the money
 * the owner paid. `failed` when a posting names someone who is not a member, or member money names
 * no member, so the transaction does not convert. Without an owner, this only checks.
 */
function readPostings(
  g: Sharing,
  t: Transaction,
  report: Report,
): { shares: Line[]; money: Line[]; failed: boolean } {
  const members = new Set(g.shares.map((s) => s.entity));
  const shares: Line[] = [];
  const money: Line[] = [];
  let failed = false;
  for (const p of t.postings) {
    if (isPnl(g.declared.roots, p.account)) {
      const fraction = shareOf(g, t, p, members, report);
      if (fraction === undefined) failed = true;
      else if (!isZero(fraction)) shares.push(scaled(p, fraction));
      continue;
    }
    const entities = (p.refs.length > 0 ? p.refs : t.refs).map((r) => r.entity);
    const [entity] = entities;
    if (entity === undefined || entities.length > 1) {
      report(
        "shared.missing-member",
        `${t.id}: ${p.account} must name exactly one member who paid or received the money`,
        p.span,
      );
      failed = true;
    } else if (!members.has(entity)) {
      report("shared.unknown-member", `${t.id}: @${entity} is not a member of the group`, p.span);
      failed = true;
    } else if (entity === g.self)
      money.push({
        from: p,
        account: p.account,
        amount: p.amount,
        ...(p.price && { price: p.price }),
        ...(p.cost && { cost: p.cost }),
      });
  }
  return { shares, money, failed };
}

/** One group transaction converted for the owner, or undefined when nothing converts. */
function convert(
  g: Group,
  t: Transaction,
  replacing: readonly Transaction[],
  precision: (commodity: Id) => number,
  out: Diagnostic[],
): Transaction | undefined {
  const report: Report = (code, message, span = t.span) => {
    out.push(diagnostic(code, message, g.path, span));
  };
  const { shares, money, failed } = readPostings(g, t, report);
  // Actual payments are checked whether or not anything converts; their amounts only when the
  // owner's money is known.
  const id = `${g.name}:${t.id}`;
  const [replaced, ...more] = replacing;
  if (!failed) for (const payment of replacing) checkPayment(g, money, payment, id, precision, out);
  if (replaced)
    for (const extra of more)
      out.push(
        diagnostic(
          "shared.multiple-replacement",
          `${replaced.id} is already the actual payment for ${id}`,
          extra.source,
          extra.span,
        ),
      );
  const lines = (replaced ? shares : [...shares, ...money]).sort(
    (a, b) => t.postings.indexOf(a.from) - t.postings.indexOf(b.from),
  );
  if (failed || lines.length === 0) return undefined;

  // Every account that converts must be mapped; replaced money does not convert.
  const targets = lines.map((line) => ({ line, account: mapAccount(g, line.account) }));
  const mappedLines = targets.filter(
    (x): x is { line: Line; account: Id } => x.account !== undefined,
  );
  if (mappedLines.length < targets.length) {
    const unmapped = new Set(targets.filter((x) => !x.account).map((x) => x.line.account));
    report(
      "shared.unmapped-account",
      `${t.id}: ${g.account} maps no account for ${[...unmapped].join(", ")}; it does not convert`,
    );
    return undefined;
  }

  const tags = [...t.tags.map(plain), SYSTEM_SHARED];
  const posting = (
    k: number,
    fields: Omit<Posting, "id" | "transaction" | "status" | "breakdown"> &
      Partial<Pick<Posting, "breakdown">>,
  ): Posting => ({
    id: `${id}.${String(k)}`,
    transaction: id,
    status: "none",
    breakdown: [],
    ...fields,
  });
  const postings: Posting[] = mappedLines.map(({ line: l, account }, i) =>
    posting(i + 1, {
      account,
      amount: mapAmount(g, l.amount),
      ...(l.price && { price: mapAmount(g, l.price) }),
      ...(l.cost && { cost: mapAmount(g, l.cost) }),
      effective: l.from.effective,
      tags: [...l.from.tags.filter((tag) => !t.tags.includes(tag)).map(plain), ...tags],
      refs: mapRefs(g, l.from.refs),
      meta: l.from.meta,
      breakdown: l.from.breakdown,
    }),
  );
  // The shared account balances the rest, per commodity.
  const rest = new Map<Id, Rational>();
  for (const p of postings) {
    const w = weightOf(p);
    rest.set(w.commodity, sub(rest.get(w.commodity) ?? ZERO, rational(w.value)));
  }
  for (const [commodity, value] of [...rest].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    if (!isZero(value))
      postings.push(
        posting(postings.length + 1, {
          account: g.account,
          amount: { value: decimal(value), commodity },
          effective: t.effective,
          tags,
          refs: [],
          meta: {},
        }),
      );
  if (postings.length === 0) return undefined;

  return {
    id,
    source: g.path,
    ...(t.span && { span: t.span }),
    effective: t.effective,
    accounting: t.accounting,
    ...(t.description !== undefined && { description: t.description }),
    occurrence: t.occurrence,
    status: "none",
    ...(t.primaryTag !== undefined && { primaryTag: t.primaryTag }),
    tags,
    refs: mapRefs(g, t.refs),
    meta: t.meta,
    ...(replaced && { payment: replaced.id }),
    postings,
  };
}

/** A tag of the group ledger in the owner's ledger: it names nothing there. */
const plain = (tag: Tag): Tag => ({ scope: tag.scope, ref: tag.ref });

/**
 * The owner's share of a spending posting, as a fraction of it: by its own split when it has one
 * that can be used, otherwise by the group ledger's default ratios. Undefined when the posting
 * names someone who is not a member, so the transaction does not convert.
 */
function shareOf(
  g: Sharing,
  t: Transaction,
  p: Posting,
  members: ReadonlySet<Id>,
  report: Report,
): Rational | undefined {
  const byDefault = (): Rational => {
    if (g.self === undefined) return ZERO;
    let total = ZERO;
    let own = ZERO;
    for (const s of g.shares) {
      const r = rational(s.ratio);
      total = add(total, r);
      if (s.entity === g.self) own = add(own, r);
    }
    return div(own, total);
  };
  const line = p.origin?.lines.find((l) => l.kind === "split" || l.kind === "paid-by");
  if (!line) return byDefault();
  if (
    line.kind === "paid-by" ||
    line.table !== undefined ||
    line.paidBy !== undefined ||
    line.into !== undefined ||
    line.members.some((m) => m.who === "self")
  ) {
    report(
      "shared.invalid-split",
      `${t.id}: a split in a group ledger lists only members; the posting is shared by the default ratios`,
      line.span,
    );
    return byDefault();
  }
  const outsider = line.members.find((m) => !members.has(m.who));
  if (outsider) {
    report(
      "shared.unknown-member",
      `${t.id}: @${outsider.who} is not a member of the group`,
      line.span,
    );
    return undefined;
  }
  return splitShare(g, t, p, line, report) ?? byDefault();
}

/**
 * The owner's share under a split of members only (docs/core/generators.md, "Splits"); undefined
 * when the split has an error, which is reported.
 */
function splitShare(
  g: Sharing,
  t: Transaction,
  p: Posting,
  line: SplitLine,
  report: Report,
): Rational | undefined {
  // Member amounts are in the settlement commodity: the price's when there is one.
  const total = abs(rational((p.price ?? p.amount).value));
  let amounts = ZERO;
  let ratios = ZERO;
  let ownAmount: Rational | undefined;
  let ownRatio = ZERO;
  try {
    for (const m of line.members) {
      const weight =
        m.weight === undefined
          ? undefined
          : rational(parseNumber(m.weight, g.declared.settings).value);
      const isAmount = weight !== undefined && !m.times;
      if (isAmount) {
        amounts = add(amounts, weight);
        if (m.who === g.self) ownAmount = weight;
      } else {
        ratios = add(ratios, weight ?? rational("1"));
        if (m.who === g.self) ownRatio = weight ?? rational("1");
      }
    }
  } catch (e) {
    if (!(e instanceof NumberError)) throw e;
    report("parse.invalid-number", e.message, line.span);
    return undefined;
  }
  const remaining = sub(total, amounts);
  if (cmp(remaining, ZERO) < 0) {
    report(
      "split.exceeds",
      `${t.id}: the member amounts add up to more than ${p.account}`,
      line.span,
    );
    return undefined;
  }
  if (!isZero(remaining) && isZero(ratios)) {
    report("split.zero-ratio", `${t.id}: the ratios add up to zero`, line.span);
    return undefined;
  }
  if (isZero(total)) return isZero(ratios) ? ZERO : div(ownRatio, ratios);
  const own = ownAmount ?? (isZero(ratios) ? ZERO : mul(remaining, div(ownRatio, ratios)));
  return div(own, total);
}

/** A posting scaled to the owner's share: its amount, price and cost. */
function scaled(p: Posting, fraction: Rational): Line {
  const times = (a: Amount): Amount => ({
    value: decimal(mul(rational(a.value), fraction)),
    commodity: a.commodity,
  });
  return {
    from: p,
    account: p.account,
    amount: times(p.amount),
    ...(p.price && { price: times(p.price) }),
    ...(p.cost && { cost: times(p.cost) }),
  };
}

/**
 * The account of the owner's ledger a group account maps to: by the longest matching entry, with
 * the rest of the group account's name carried over.
 */
function mapAccount(g: Group, account: Id): Id | undefined {
  let best: readonly [Id, Id] | undefined;
  for (const entry of g.shared.accountMap)
    if (inAccount(account, entry[0]) && (!best || entry[0].length > best[0].length)) best = entry;
  return best && best[1] + account.slice(best[0].length);
}

function mapAmount(g: Group, a: Amount): Amount {
  return { value: a.value, commodity: g.shared.commodityMap[a.commodity] ?? a.commodity };
}

function mapRefs(g: Group, refs: readonly Reference[]): Reference[] {
  return refs.map((r) => ({ role: r.role, entity: g.shared.entityMap[r.entity] ?? r.entity }));
}

/**
 * An actual payment's postings on the shared account must equal the negated weights of the money
 * the owner paid in the group transaction, per commodity after the mapping: what the shared
 * account would have balanced. Each commodity may differ by the tolerance of balancing, with k the
 * weights that came from a price or cost.
 */
function checkPayment(
  g: Group,
  money: readonly Line[],
  payment: Transaction,
  id: Id,
  precision: (commodity: Id) => number,
  out: Diagnostic[],
): void {
  const owner = new Map<Id, Rational>();
  const priced = new Map<Id, number>();
  for (const l of money) {
    const a = mapAmount(g, weightOf(l));
    owner.set(a.commodity, add(owner.get(a.commodity) ?? ZERO, rational(a.value)));
    if (l.price || l.cost) priced.set(a.commodity, (priced.get(a.commodity) ?? 0) + 1);
  }
  const paid = new Map<Id, Rational>();
  for (const p of payment.postings)
    if (inAccount(p.account, g.account))
      paid.set(
        p.amount.commodity,
        add(paid.get(p.amount.commodity) ?? ZERO, rational(p.amount.value)),
      );
  const commodities = [...new Set([...owner.keys(), ...paid.keys()])];
  const off = commodities.filter(
    (c) =>
      !withinHalfUnit(
        add(owner.get(c) ?? ZERO, paid.get(c) ?? ZERO),
        precision(c),
        Math.max(1, priced.get(c) ?? 0),
      ),
  );
  if (off.length === 0) return;
  const show = (m: Map<Id, Rational>, sign = 1): string =>
    commodities
      .map((c) => {
        const v = m.get(c) ?? ZERO;
        return `${decimal(sign < 0 ? neg(v) : v)} ${c}`;
      })
      .join(", ");
  out.push(
    diagnostic(
      "shared.payment-mismatch",
      `${payment.id} pays ${show(paid)} on ${g.account}; it should pay ${show(owner, -1)}, the owner's money in ${id}`,
      payment.source,
      payment.span,
    ),
  );
}
