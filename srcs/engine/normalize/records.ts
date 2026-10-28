// Normalization of records: Raw transactions become derived ones. Names are resolved, prices and
// costs become totals, and an omitted amount is filled in (docs/core/transactions.md).

import type {
  Amount,
  Breakdown,
  Figure,
  Id,
  Metadata,
  Posting,
  Reference,
  Tag,
  Transaction,
} from "../../data/model/types.js";
import { anchorKey } from "../../data/raw/anchor.js";
import type {
  BreakdownLine,
  Note,
  PostingData,
  PriceData,
  TagData,
  TransactionData,
} from "../../data/raw/model.js";
import type { Diagnostic, SourcePath } from "../../data/source/source.js";
import { parseTime, TimeError, type TimeContext } from "../../data/time/time.js";
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
} from "../../data/values/number.js";
import { diagnostic, type Code } from "../../data/source/diagnostics.js";
import { weightOf } from "./shared.js";

export interface RecordContext {
  readonly source: SourcePath;
  readonly time: TimeContext;
  readonly out: Diagnostic[];
  /** Digits after the decimal mark of each written posting amount, for precision checks. */
  readonly decimals: Map<Posting, number>;
}

/** The record is not loaded; the diagnostic has been reported. */
class Dropped extends Error {}

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

/** Metadata in written order, the later value winning: whole lines and the ends of child lines. */
export function metaFrom(
  lines: readonly { kind: string; note?: Note; trailer?: Note }[],
  trailer?: Note,
): Metadata {
  const meta: Record<string, string> = {};
  for (const note of [trailer, ...lines.map((l) => (l.kind === "note" ? l.note : l.trailer))])
    if (note?.kind === "meta") meta[note.key] = note.value;
  return meta;
}

const tagOf = (t: TagData): Tag => ({ scope: t.scope ?? "tag", ref: t.ref });

function referenceOf(text: string): Reference {
  const colon = text.indexOf(":");
  return colon < 0
    ? { role: "person", entity: text }
    : { role: text.slice(0, colon), entity: text.slice(colon + 1) };
}

/** A price or cost as a total (always positive). */
function totalOf(price: PriceData, quantity: Amount): Amount {
  const p = parseAmount(price.amount);
  const value =
    price.kind === "total"
      ? abs(rational(p.value))
      : abs(mul(rational(p.value), rational(quantity.value)));
  return { value: decimal(value), commodity: p.commodity };
}

interface Draft {
  readonly data: PostingData;
  readonly id: Id;
  amount?: Amount;
  decimals?: number;
  price?: Amount;
  cost?: Amount;
  breakdown: Breakdown[];
}

export function buildTransaction(
  data: TransactionData,
  id: Id,
  ctx: RecordContext,
): Transaction | undefined {
  try {
    return guard(ctx, data, () => transaction(data, id, ctx));
  } catch (e) {
    if (e instanceof Dropped) return undefined;
    throw e;
  }
}

function transaction(data: TransactionData, id: Id, ctx: RecordContext): Transaction {
  const time = parseTime(data.effective, ctx.time);
  const tags = data.tags.map(tagOf);

  const drafts: Draft[] = data.postings.map((p, i) => {
    const parsed = p.amount === undefined ? undefined : parseAmount(p.amount);
    const amount = parsed && { value: parsed.value, commodity: parsed.commodity };
    const draft: Draft = {
      data: p,
      id: p.anchor ? anchorKey(p.anchor) : `${id}.${String(i + 1)}`,
      breakdown: [],
      ...(amount && { amount }),
      ...(parsed && { decimals: parsed.decimals }),
    };
    if (amount) {
      if (p.cost) draft.cost = totalOf(p.cost, amount);
      if (p.price) draft.price = totalOf(p.price, amount);
    }
    draft.breakdown = breakdownOf(ctx, p, amount);
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
      tags: [...d.data.tags.map(tagOf), ...tags],
      refs: d.data.refs.map(referenceOf),
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
    time,
    ...(data.description !== undefined && { description: data.description }),
    occurrence: data.mark === "!" ? "planned" : data.mark === "#" ? "cancelled" : "occurred",
    ...(data.primaryTag && { primaryTag: data.primaryTag.ref.name }),
    tags,
    refs: data.refs.map(referenceOf),
    meta: metaFrom(data.lines, data.trailer),
    postings,
  };
}

/** Breakdown lines as written; only the written amount's commodity is compared, never taken. */
function breakdownOf(ctx: RecordContext, p: PostingData, amount: Amount | undefined): Breakdown[] {
  const out: Breakdown[] = [];
  for (const line of p.lines) {
    if (line.kind !== "breakdown") continue;
    const b = breakdownLine(ctx, line);
    out.push(b);
    const written = [b.unitPrice?.commodity, b.total?.commodity];
    if (p.amount !== undefined) written.push(amount?.commodity);
    const commodities = new Set(written.filter((c) => c !== undefined));
    if (commodities.size > 1)
      ctx.out.push(
        diagnostic(
          "breakdown.commodity-mismatch",
          `${line.name}: ${[...commodities].join(", ")} are different commodities`,
          ctx.source,
          line.span,
        ),
      );
  }
  return out;
}

/** A figure that cannot be read is only a warning: the line keeps its name. */
function breakdownLine(ctx: RecordContext, line: BreakdownLine): Breakdown {
  if (line.figure === undefined) return { name: line.name };
  const figure = (text: string): Figure => {
    const v = parseFigureValue(text);
    return { value: v.value, ...(v.commodity !== undefined && { commodity: v.commodity }) };
  };
  try {
    const parts = splitFigure(line.figure);
    const q = parts.quantity;
    return {
      name: line.name,
      ...(q && {
        quantity: { value: parseNumber(q.number).value, ...(q.unit && { unit: q.unit }) },
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
