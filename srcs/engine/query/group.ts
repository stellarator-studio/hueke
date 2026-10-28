// Grouping and aggregation (docs/core/query.md, "Grouping", "Aggregation").

import { compareText } from "../../data/model/order.js";
import type { Amount, Id, Posting } from "../../data/model/types.js";
import { add, decimal, rational, ZERO, type Rational } from "../../data/values/decimal.js";

export type GroupKey = "account";

export interface Group<T> {
  readonly key: Readonly<Record<string, string>>;
  readonly value: T;
}

export interface Grouped {
  sum(): Group<Amount[]>[];
}

export class GroupedQuery implements Grouped {
  constructor(
    private readonly postings: readonly Posting[],
    private readonly keys: readonly GroupKey[],
  ) {}

  sum(): Group<Amount[]>[] {
    const slots = new Map<string, { key: Record<string, string>; totals: Map<Id, Rational> }>();
    for (const p of this.postings) {
      const key: Record<string, string> = {};
      for (const k of this.keys) key[k] = p.account;
      const id = JSON.stringify(key);
      let slot = slots.get(id);
      if (!slot) {
        slot = { key, totals: new Map() };
        slots.set(id, slot);
      }
      const { commodity, value } = p.amount;
      slot.totals.set(commodity, add(slot.totals.get(commodity) ?? ZERO, rational(value)));
    }
    return [...slots.values()]
      .sort((a, b) => compareKeys(a.key, b.key))
      .map((s) => ({
        key: s.key,
        value: [...s.totals]
          .sort(([a], [b]) => compareText(a, b))
          .map(([commodity, total]) => ({ value: decimal(total), commodity })),
      }));
  }
}

/** Key values in key order, by code point. */
function compareKeys(
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
): number {
  for (const [k, x] of Object.entries(a)) {
    const y = b[k] ?? "";
    if (x !== y) return compareText(x, y);
  }
  return 0;
}
