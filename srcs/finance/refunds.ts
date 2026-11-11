// `refunds` (docs/core/anchors.md, "`refunds`"): one row per refunded record, account and
// commodity measured, with how much of the original came back.

import type { Amount, Id } from "../data/model/types.js";
import { abs, decimal, sub, ZERO, type Rational } from "../data/values/decimal.js";
import { initialized, type Hueke } from "../engine/hueke.js";
import {
  lineOfKey,
  measureRefunds,
  refundedBack,
  refundExceeds,
  withinHalfUnit,
} from "../engine/normalize/shared.js";

export interface RefundsOptions {
  /** Only these refunded transactions or postings; every refunded record if absent. */
  readonly ids?: readonly Id[];
}

/** One refunded record, measured on one account in one commodity. */
export interface RefundProgress {
  readonly target: Id;
  readonly account: Id;
  readonly commodity: Id;
  readonly original: Amount;
  readonly refunded: Amount;
  readonly remaining: Amount;
  readonly full: boolean;
  readonly exceeds: boolean;
  readonly refunds: readonly Id[];
}

export function refunds(ledger: Hueke, options: RefundsOptions = {}): RefundProgress[] {
  if (!initialized(ledger)) throw new Error("refunds() before init()");
  const accounts = new Map(ledger.accounts.map((a) => [a.id, a]));
  const precisions = new Map(ledger.commodities.map((c) => [c.id, c.precision]));
  // Records in transaction order, a posting after its transaction and in its own order.
  const position = new Map<Id, readonly [number, number]>();
  ledger.transactions.forEach((t, i) => {
    position.set(t.id, [i, 0]);
    t.postings.forEach((p, j) => position.set(p.id, [i, j + 1]));
  });
  const only = options.ids && options.ids.length > 0 ? new Set(options.ids) : undefined;
  const measures = [...measureRefunds(ledger.transactions, accounts)]
    .filter(([target]) => !only || only.has(target))
    .sort(([a], [b]) => {
      const [ai = 0, aj = 0] = position.get(a) ?? [];
      const [bi = 0, bj = 0] = position.get(b) ?? [];
      return ai - bi || aj - bj;
    });
  return measures.flatMap(([target, m]) =>
    [...m.original].map(([key, signed]): RefundProgress => {
      const { account, commodity } = lineOfKey(key);
      const precision = precisions.get(commodity) ?? 0;
      const net = m.refunded.get(key) ?? ZERO;
      const original = abs(signed);
      const back = refundedBack(signed, net);
      const remaining = sub(original, back);
      const amount = (value: Rational): Amount => ({ value: decimal(value), commodity });
      return {
        target,
        account,
        commodity,
        original: amount(original),
        refunded: amount(back),
        remaining: amount(remaining),
        full: withinHalfUnit(remaining, precision),
        exceeds: refundExceeds(signed, net, precision),
        refunds: m.refunds.map((t) => t.id),
      };
    }),
  );
}
