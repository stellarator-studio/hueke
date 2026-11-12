// Normalization of records: Raw transactions and balances become derived ones. Times and status
// are inherited, prices and costs become totals, and an omitted amount is filled in. References
// with a role Core does not define are skipped.

import type {
  Account,
  AccountRoot,
  Amount,
  Balance,
  Breakdown,
  Figure,
  Id,
  LedgerSettings,
  Posting,
  Reference,
  Status,
  Tag,
  TimeValue,
  Transaction,
} from "../../data/model/types.js";
import { anchorKey } from "../../data/raw/anchor.js";
import { obligationPlace } from "../../data/model/account.js";
import type {
  AnchorRef,
  BalanceData,
  BreakdownLine,
  PostingData,
  PriceData,
  TagData,
  TransactionData,
} from "../../data/raw/model.js";
import type { Diagnostic, SourcePath, SourceSpan } from "../../data/source/source.js";
import {
  isOneDay,
  isOneDayOrMoment,
  parseTime,
  TimeError,
  type TimeContext,
} from "../../data/time/time.js";
import {
  abs,
  add,
  decimal,
  mul,
  neg,
  rational,
  ZERO,
  type Rational,
} from "../../data/values/decimal.js";
import {
  NumberError,
  parseAmount,
  parseFigureValue,
  parseNumber,
  splitFigure,
  type AliasTable,
  type NumberFormat,
} from "../../data/values/number.js";
import { diagnostic, type Code } from "../../data/source/diagnostics.js";
import { metaFrom, weightOf } from "./shared.js";

export interface RecordContext {
  /** The module of the record being read. */
  readonly source: SourcePath;
  readonly settings: LedgerSettings;
  readonly format: NumberFormat;
  readonly aliases: AliasTable;
  readonly time: TimeContext;
  readonly roots: ReadonlyMap<string, AccountRoot>;
  readonly accounts: ReadonlyMap<Id, Account>;
  /** Whether an anchor defines its record: an anchor defined more than once does not. */
  readonly defines: (anchor: AnchorRef) => boolean;
  readonly out: Diagnostic[];
  /** Digits after the decimal mark of each written posting amount, for precision checks. */
  readonly decimals: Map<Posting, number>;
  /** Largest number of digits written per commodity, for commodities without `precision`. */
  readonly usedDecimals: Map<Id, number>;
}

/** The digits written in one record, counted only once the record loads. */
type Written = [Id, number][];

/** The record is not loaded; the diagnostic has been reported (or none is due). */
class Dropped extends Error {}

const PNL = new Set(["income", "expense"]);

function fail(
  ctx: RecordContext,
  code: Code,
  message: string,
  data: { span?: TransactionData["span"] },
): never {
  ctx.out.push(diagnostic(code, message, ctx.source, data.span));
  throw new Dropped(message);
}

function guard<T>(ctx: RecordContext, data: { span?: TransactionData["span"] }, read: () => T): T {
  try {
    return read();
  } catch (e) {
    if (e instanceof NumberError) fail(ctx, "parse.invalid-number", e.message, data);
    if (e instanceof TimeError) fail(ctx, e.code, e.message, data);
    throw e;
  }
}

const tagOf = (t: TagData): Tag => ({ scope: t.scope ?? "tag", ref: t.ref });

/** Roles Core defines (docs/core/entities.md, "References and roles"). */
const ROLES = new Set(["person"]);

/** The references written, without those whose role is unknown. */
function referencesOf(
  ctx: RecordContext,
  written: readonly string[],
  span: SourceSpan | undefined,
): Reference[] {
  const refs: Reference[] = [];
  for (const text of written) {
    const colon = text.indexOf(":");
    const ref =
      colon < 0
        ? { role: "person", entity: text }
        : { role: text.slice(0, colon), entity: text.slice(colon + 1) };
    if (ROLES.has(ref.role)) refs.push(ref);
    else
      ctx.out.push(
        diagnostic(
          "name.unknown-role",
          `@${text}: Core defines no role "${ref.role}"`,
          ctx.source,
          span,
        ),
      );
  }
  return refs;
}

function amountOf(ctx: RecordContext, text: string, written?: (decimals: number) => void): Amount {
  const a = parseAmount(text, ctx.format, ctx.aliases);
  written?.(a.decimals);
  return { value: a.value, commodity: a.commodity };
}

function noteUse(ctx: RecordContext, written: Written): void {
  for (const [commodity, decimals] of written)
    ctx.usedDecimals.set(commodity, Math.max(ctx.usedDecimals.get(commodity) ?? 0, decimals));
}

/** A price or cost as a total (always positive); a written sign is reported and dropped. */
function totalOf(
  ctx: RecordContext,
  price: PriceData,
  quantity: Amount,
  span: SourceSpan | undefined,
): Amount {
  const p = amountOf(ctx, price.amount);
  if (rational(p.value).n < 0n)
    ctx.out.push(
      diagnostic(
        "posting.signed-price",
        `"${price.amount}" is written with a sign; prices and costs are used without one`,
        ctx.source,
        span,
      ),
    );
  const value =
    price.kind === "total"
      ? abs(rational(p.value))
      : abs(mul(rational(p.value), rational(quantity.value)));
  return { value: decimal(value), commodity: p.commodity };
}

function isPnl(ctx: RecordContext, account: Id): boolean {
  const type = ctx.roots.get(account.split(":")[0] ?? "")?.type;
  return type !== undefined && PNL.has(type);
}

interface Draft {
  readonly data: PostingData;
  readonly id: Id;
  amount?: Amount;
  decimals?: number;
  price?: Amount;
  cost?: Amount;
  effective: TimeValue;
  status: Status;
  breakdown: Breakdown[];
}

export function buildTransaction(
  data: TransactionData,
  id: Id,
  ctx: RecordContext,
): Transaction | undefined {
  try {
    const written: Written = [];
    const t = guard(ctx, data, () => transaction(data, id, ctx, written));
    noteUse(ctx, written);
    return t;
  } catch (e) {
    if (e instanceof Dropped) return undefined;
    throw e;
  }
}

function transaction(
  data: TransactionData,
  id: Id,
  ctx: RecordContext,
  written: Written,
): Transaction {
  const effective = parseTime(data.effective, ctx.time);
  const accounting =
    data.accounting === undefined ? effective : parseTime(data.accounting, ctx.time);
  const occurrence = data.mark === "!" ? "planned" : data.mark === "#" ? "cancelled" : "occurred";
  const status: Status = data.mark === "*" ? "cleared" : "none";
  const tags = data.tags.map(tagOf);

  const drafts: Draft[] = data.postings.map((p, i) => {
    let decimals: number | undefined;
    const amount =
      p.amount === undefined ? undefined : amountOf(ctx, p.amount, (d) => (decimals = d));
    let own = p.effective === undefined ? undefined : parseTime(p.effective, ctx.time);
    if (own && isPnl(ctx, p.account)) {
      ctx.out.push(
        diagnostic(
          "posting.pnl-effective",
          `${p.account} is an income or expense account and cannot have its own time`,
          ctx.source,
          p.span,
        ),
      );
      own = undefined;
    }
    // A posting's effective time, its own or its transaction's, is one day or one moment.
    if (own && !isOneDayOrMoment(own))
      fail(
        ctx,
        "posting.invalid-effective",
        `${p.account}: [${own.literal}] is not one day or one moment`,
        p,
      );
    if (!own && !isOneDayOrMoment(effective))
      fail(
        ctx,
        "posting.invalid-effective",
        `${p.account} takes the transaction's time ${effective.literal}, which is not one day or one moment; write the period as the accounting time`,
        data,
      );
    const draft: Draft = {
      data: p,
      id: p.anchor && ctx.defines(p.anchor) ? anchorKey(p.anchor) : `${id}.${String(i + 1)}`,
      effective: own ?? effective,
      status: p.cleared ? "cleared" : status,
      breakdown: [],
      ...(amount && { amount }),
      ...(decimals !== undefined && { decimals }),
    };
    if (amount) {
      if (p.cost) draft.cost = totalOf(ctx, p.cost, amount, p.span);
      if (p.price) draft.price = totalOf(ctx, p.price, amount, p.span);
      written.push([amount.commodity, decimals ?? 0]);
    }
    // Without a written amount, a line has no posting commodity to agree with.
    const onPosting =
      p.amount === undefined || amount === undefined
        ? []
        : [amount.commodity, draft.price?.commodity, draft.cost?.commodity];
    draft.breakdown = breakdownOf(ctx, p, onPosting);
    return draft;
  });

  // An omitted amount is the negated sum of the other weights, when they share one commodity.
  const omitted = drafts.filter((d) => !d.amount);
  if (omitted.length > 0) {
    const [missing] = omitted;
    const weights = drafts
      .filter((d) => d.amount)
      .map((d) => weightOf(d as Draft & { amount: Amount }));
    const commodities = new Set(weights.map((w) => w.commodity));
    const [commodity] = commodities;
    if (!missing || omitted.length > 1 || commodities.size !== 1 || commodity === undefined)
      fail(
        ctx,
        "txn.amount-not-inferable",
        omitted.length > 1
          ? "only one posting can omit its amount"
          : "the other postings' weights must all be in one commodity",
        data,
      );
    let total: Rational = ZERO;
    for (const w of weights) total = add(total, rational(w.value));
    missing.amount = { value: decimal(neg(total)), commodity };
  }

  if (occurrence !== "occurred" && drafts.some((d) => d.status === "cleared")) {
    ctx.out.push(
      diagnostic(
        "txn.cleared-not-occurred",
        `a ${occurrence} transaction cannot have cleared postings`,
        ctx.source,
        data.span,
      ),
    );
    for (const d of drafts) d.status = "none";
  }

  const postings = drafts.map((d): Posting => {
    const posting: Posting = {
      id: d.id,
      ...(d.data.span && { span: d.data.span }),
      origin: d.data,
      transaction: id,
      account: d.data.account,
      amount: d.amount ?? { value: "0", commodity: "" },
      ...(d.price && { price: d.price }),
      ...(d.cost && { cost: d.cost }),
      status: d.status,
      effective: d.effective,
      tags: [...d.data.tags.map(tagOf), ...tags],
      refs: referencesOf(ctx, d.data.refs, d.data.span),
      meta: metaFrom(d.data.lines, d.data.trailer),
      breakdown: d.breakdown,
    };
    if (d.decimals !== undefined) ctx.decimals.set(posting, d.decimals);
    return posting;
  });

  return {
    id,
    source: ctx.source,
    ...(data.span && { span: data.span }),
    origin: data,
    effective,
    accounting,
    ...(data.description !== undefined && { description: data.description }),
    occurrence,
    status,
    ...(data.primaryTag && { primaryTag: data.primaryTag.ref.name }),
    tags,
    refs: referencesOf(ctx, data.refs, data.span),
    meta: metaFrom(data.lines, data.trailer),
    postings,
  };
}

/**
 * Breakdown lines as written. A line's commodities are compared with each other and with those
 * written on the posting (its amount's, price's or cost's); none is ever taken from the posting.
 */
function breakdownOf(
  ctx: RecordContext,
  p: PostingData,
  onPosting: readonly (Id | undefined)[],
): Breakdown[] {
  const allowed = onPosting.filter((c) => c !== undefined);
  const out: Breakdown[] = [];
  for (const line of p.lines) {
    if (line.kind !== "breakdown") continue;
    const b = breakdownLine(ctx, line);
    out.push(b);
    const commodities = [
      ...new Set([b.unitPrice?.commodity, b.total?.commodity].filter((c) => c !== undefined)),
    ];
    const [commodity] = commodities;
    const message =
      commodities.length > 1
        ? `${line.name}: ${commodities.join(", ")} are different commodities`
        : commodity !== undefined && allowed.length > 0 && !allowed.includes(commodity)
          ? `${line.name}: ${commodity} is not written on the posting (${[...new Set(allowed)].join(", ")})`
          : undefined;
    if (message !== undefined)
      ctx.out.push(diagnostic("breakdown.commodity-mismatch", message, ctx.source, line.span));
  }
  return out;
}

/** A figure that cannot be read is only a warning: the line keeps its name. */
function breakdownLine(ctx: RecordContext, line: BreakdownLine): Breakdown {
  if (line.figure === undefined) return { name: line.name };
  const figure = (text: string): Figure => {
    const v = parseFigureValue(text, ctx.format, ctx.aliases);
    return { value: v.value, ...(v.commodity !== undefined && { commodity: v.commodity }) };
  };
  try {
    const parts = splitFigure(line.figure);
    const q = parts.quantity;
    return {
      name: line.name,
      ...(q && {
        quantity: {
          value: parseNumber(q.number, ctx.format).value,
          ...(q.unit && { unit: q.unit }),
        },
      }),
      ...(parts.unitPrice !== undefined && { unitPrice: figure(parts.unitPrice) }),
      ...(parts.total !== undefined && { total: figure(parts.total) }),
    };
  } catch (e) {
    if (!(e instanceof NumberError)) throw e;
    ctx.out.push(
      diagnostic(
        "breakdown.invalid-figure",
        `${line.name}: "${line.figure}" cannot be read; only the name is kept`,
        ctx.source,
        line.span,
      ),
    );
    return { name: line.name };
  }
}

export function buildBalance(data: BalanceData, ctx: RecordContext): Balance | undefined {
  try {
    return guard(ctx, data, () => {
      const effective = parseTime(data.time, ctx.time);
      if (!isOneDay(effective))
        fail(ctx, "balance.invalid-effective", `a Balance is on one day, not ${data.time}`, data);
      const accounting =
        data.accounting === undefined ? undefined : parseTime(data.accounting, ctx.time);
      let decimals = 0;
      const amount = amountOf(ctx, data.amount, (d) => (decimals = d));
      const [ref] = data.entity === undefined ? [] : referencesOf(ctx, [data.entity], data.span);
      // On obligations, only a pad on one obligation names an entity
      // (docs/core/balance.md, "Obligations in Balance assertions").
      const place = obligationPlace(data.account, ctx.accounts);
      if (ref && place && !(data.pad && place.kind === "obligation"))
        fail(
          ctx,
          "balance.obligation-entity",
          `a Balance on ${data.account} asserts whole obligations and takes no entity`,
          data,
        );
      const pad = data.pad?.amount === undefined ? undefined : amountOf(ctx, data.pad.amount);
      const padPrice =
        data.pad?.price && pad ? totalOf(ctx, data.pad.price, pad, data.span) : undefined;
      const balance: Balance = {
        source: ctx.source,
        ...(data.span && { span: data.span }),
        origin: data,
        account: data.account,
        ...(ref && { entity: ref.entity }),
        effective,
        ...(accounting && { accounting }),
        amount,
        mode: data.pad ? "pad" : "hard",
        ...(pad && { pad }),
        ...(padPrice && { padPrice }),
        ...(data.pad?.account !== undefined && { padAccount: data.pad.account }),
        meta: metaFrom(data.lines, data.trailer),
      };
      noteUse(ctx, [[amount.commodity, decimals]]);
      return balance;
    });
  } catch (e) {
    if (e instanceof Dropped) return undefined;
    throw e;
  }
}
