// Grouping and aggregation (docs/core/query.md, "Grouping", "Aggregation").

import { timeOnAxis } from "../../data/model/axis.js";
import { compareText } from "../../data/model/order.js";
import type {
  Amount,
  Axis,
  Id,
  Posting,
  TimeValue,
  Transaction,
  Weekday,
} from "../../data/model/types.js";
import { anchorKey } from "../../data/raw/anchor.js";
import { eachDate, weekLabel } from "../../data/time/time.js";
import { add, decimal, rational, ZERO, type Rational } from "../../data/values/decimal.js";
import type { TimeClause } from "./query.js";

export type GroupKey =
  | "account"
  | "entity"
  | "commodity"
  | "tag"
  | "primaryTag"
  | "day"
  | "week"
  | "month"
  | "quarter"
  | "year"
  | `meta:${string}`;

export interface Group<T> {
  readonly key: Readonly<Record<string, string | null>>; // null is the "none" group
  readonly value: T;
}

export interface Grouped {
  sum(): Group<Amount[]>[];
  count(): Group<number>[];
}

/** A matched transaction with its matched postings. */
export interface Hit {
  readonly transaction: Transaction;
  readonly postings: Posting[];
}

type Bucket = "day" | "week" | "month" | "quarter" | "year";

export class GroupedQuery implements Grouped {
  constructor(
    private readonly weekStart: Weekday,
    private readonly axis: Axis,
    private readonly times: readonly TimeClause[],
    private readonly hits: readonly Hit[],
    private readonly keys: readonly GroupKey[],
    /** The entities a posting is read with (docs/core/query.md, "Matched postings"). */
    private readonly entities: (t: Transaction, p: Posting) => readonly Id[],
  ) {}

  sum(): Group<Amount[]>[] {
    return this.collect<Map<Id, Rational>, Amount[]>(
      () => new Map(),
      (acc, p) =>
        acc.set(
          p.amount.commodity,
          add(acc.get(p.amount.commodity) ?? ZERO, rational(p.amount.value)),
        ),
      (acc) =>
        [...acc]
          .sort(([a], [b]) => compareText(a, b))
          .map(([commodity, total]) => ({ value: decimal(total), commodity })),
    );
  }

  count(): Group<number>[] {
    return this.collect<Set<Id>, number>(
      () => new Set(),
      (acc, p) => acc.add(p.transaction),
      (acc) => acc.size,
    );
  }

  private collect<A, V>(
    init: () => A,
    step: (acc: A, p: Posting) => void,
    done: (acc: A) => V,
  ): Group<V>[] {
    const slots = new Map<string, { key: Record<string, string | null>; acc: A }>();
    for (const { transaction, postings } of this.hits)
      for (const p of postings)
        for (const key of this.combinations(transaction, p)) {
          const id = JSON.stringify(key);
          let slot = slots.get(id);
          if (!slot) {
            slot = { key, acc: init() };
            slots.set(id, slot);
          }
          step(slot.acc, p);
        }
    return [...slots.values()]
      .sort((a, b) => compareKeys(this.keys, a.key, b.key))
      .map((s) => ({ key: s.key, value: done(s.acc) }));
  }

  private combinations(t: Transaction, p: Posting): Record<string, string | null>[] {
    let combos: Record<string, string | null>[] = [{}];
    for (const k of this.keys)
      combos = combos.flatMap((c) => this.values(k, t, p).map((v) => ({ ...c, [k]: v })));
    return combos;
  }

  private values(k: GroupKey, t: Transaction, p: Posting): (string | null)[] {
    switch (k) {
      case "account":
        return [p.account];
      case "commodity":
        return [p.amount.commodity];
      case "primaryTag":
        return [t.primaryTag ?? null];
      case "entity": {
        const refs = this.entities(t, p);
        return refs.length > 0 ? [...refs] : [null];
      }
      case "tag":
        return p.tags.length > 0
          ? p.tags.map((tag) => `${tag.scope}:${anchorKey(tag.ref)}`)
          : [null];
      case "day":
      case "week":
      case "month":
      case "quarter":
      case "year":
        return this.buckets(k, timeOnAxis(t, p, this.axis));
      default: {
        const key = k.slice("meta:".length);
        return [p.meta[key] ?? t.meta[key] ?? null];
      }
    }
  }

  /** Every bucket the record overlaps, limited to the query's time range. */
  private buckets(k: Bucket, time: TimeValue): string[] {
    let first = time.localDate;
    let last = time.localEnd;
    for (const c of this.times) {
      if (c.predicate !== "until" && c.time.localDate > first) first = c.time.localDate;
      if (c.time.localEnd < last) last = c.time.localEnd;
    }
    const labels = new Set<string>();
    for (const date of eachDate(first, last)) labels.add(bucketOf(k, date, this.weekStart));
    return [...labels];
  }
}

function bucketOf(k: Bucket, date: string, weekStart: Weekday): string {
  switch (k) {
    case "day":
      return date;
    case "week":
      return weekLabel(date, weekStart);
    case "month":
      return date.slice(0, 7);
    case "quarter":
      return `${date.slice(0, 4)}-Q${String(Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1)}`;
    case "year":
      return date.slice(0, 4);
  }
}

/** Key values in key order, by code point; the "none" group first. */
function compareKeys(
  keys: readonly GroupKey[],
  a: Readonly<Record<string, string | null>>,
  b: Readonly<Record<string, string | null>>,
): number {
  for (const k of keys) {
    const x = a[k] ?? null;
    const y = b[k] ?? null;
    if (x === y) continue;
    if (x === null) return -1;
    if (y === null) return 1;
    return compareText(x, y);
  }
  return 0;
}
