// The progress of obligations (docs/core/obligations.md, "Progress"), and which obligations are
// settled at a point, for `balance` and `register` to hide them.

import { obligationPlace } from "../../data/model/account.js";
import type { Id, Posting, TimeValue, Transaction } from "../../data/model/types.js";
import { compareTime, matches } from "../../data/time/time.js";
import { add, neg, rational, sub, ZERO, type Rational } from "../../data/values/decimal.js";
import { sourceOrder, type Hueke } from "../hueke.js";
import { directionOf, withinHalfUnit } from "../normalize/shared.js";

/** One obligation in one commodity. */
export interface Progress {
  readonly original: Rational;
  readonly repaid: Rational;
  readonly lastRepaid?: TimeValue;
  readonly postings: readonly Posting[]; // in effective order
}

/**
 * Each obligation's progress per commodity, counting occurred postings on the effective axis up to
 * `at`; without `at`, every posting.
 */
export function progress(ledger: Hueke, at?: TimeValue): Map<Id, Map<Id, Progress>> {
  const accounts = new Map(ledger.accounts.map((a) => [a.id, a]));
  const order = sourceOrder(ledger);
  const found: { p: Posting; t: Transaction; obligation: Id; root: Id }[] = [];
  for (const t of ledger.transactions) {
    if (t.occurrence !== "occurred") continue;
    for (const p of t.postings) {
      const place = obligationPlace(p.account, accounts);
      if (place?.kind !== "obligation") continue;
      if (at && !matches(p.effective, "until", at)) continue;
      found.push({ p, t, obligation: place.obligation, root: place.root });
    }
  }
  // The sort is stable: within a transaction, postings keep their written order.
  found.sort((a, b) => compareTime(a.p.effective, b.p.effective) || order(a.t) - order(b.t));

  const result = new Map<Id, Map<Id, Progress>>();
  for (const { p, obligation, root } of found) {
    let byCommodity = result.get(obligation);
    if (!byCommodity) {
      byCommodity = new Map();
      result.set(obligation, byCommodity);
    }
    const commodity = p.amount.commodity;
    const before = byCommodity.get(commodity) ?? { original: ZERO, repaid: ZERO, postings: [] };
    const value = rational(p.amount.value);
    // Amounts are made positive in the obligation's direction: lending opens, repayment reduces.
    const positive = accounts.get(root)?.obligation === "payable" ? neg(value) : value;
    const direction = directionOf(p, accounts.get(root));
    const lending = direction === "lending";
    byCommodity.set(commodity, {
      original: lending ? add(before.original, positive) : before.original,
      repaid: lending ? before.repaid : sub(before.repaid, positive),
      ...(direction === "repayment"
        ? { lastRepaid: p.effective }
        : before.lastRepaid && { lastRepaid: before.lastRepaid }),
      postings: [...before.postings, p],
    });
  }
  return result;
}

/** Whether the remainder is zero within the tolerance of Balance assertions. */
export function isSettled(ledger: Hueke, commodity: Id, p: Progress): boolean {
  const precision = ledger.commodities.find((c) => c.id === commodity)?.precision ?? 0;
  return withinHalfUnit(sub(p.original, p.repaid), precision);
}

/** The obligations settled in every commodity they have, at `at`. */
export function settledObligations(ledger: Hueke, at?: TimeValue): Set<Id> {
  const settled = new Set<Id>();
  for (const [obligation, byCommodity] of progress(ledger, at))
    if ([...byCommodity].every(([commodity, p]) => isSettled(ledger, commodity, p)))
      settled.add(obligation);
  return settled;
}
