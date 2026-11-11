// The progress of obligations (docs/core/obligations.md, "Progress"), and which obligations are
// settled at a point, for `balance` and `register` to hide them.

import { obligationPlace } from "../../data/model/account.js";
import type { Account, Id, Posting, TimeValue, Transaction } from "../../data/model/types.js";
import { compareTime, matches } from "../../data/time/time.js";
import { abs, add, rational, sub, ZERO, type Rational } from "../../data/values/decimal.js";
import { initialized, sourceOrder, type Hueke } from "../hueke.js";
import { directionOf, withinHalfUnit } from "../normalize/shared.js";

/** One obligation in one commodity. */
export interface Progress {
  readonly original: Rational;
  readonly repaid: Rational;
  readonly lastRepaid?: TimeValue;
  readonly postings: readonly Posting[]; // in effective order
}

/** A posting to an obligation, with the obligation and its root. */
interface Found {
  readonly p: Posting;
  readonly obligation: Id;
  readonly root: Id;
}

/** The postings to obligations of each ledger, in effective order, kept: a ledger never changes. */
const kept = new WeakMap<Hueke, readonly Found[]>();

/**
 * Every occurred posting to an obligation, in effective order; within a transaction, postings keep
 * their written order.
 */
function obligationPostings(ledger: Hueke, accounts: ReadonlyMap<Id, Account>): readonly Found[] {
  const known = kept.get(ledger);
  if (known) return known;
  const order = sourceOrder(ledger);
  const found: (Found & { readonly t: Transaction })[] = [];
  for (const t of ledger.transactions) {
    if (t.occurrence !== "occurred") continue;
    for (const p of t.postings) {
      const place = obligationPlace(p.account, accounts);
      if (place?.kind !== "obligation") continue;
      found.push({ p, t, obligation: place.obligation, root: place.root });
    }
  }
  // The sort is stable: within a transaction, postings keep their written order.
  found.sort((a, b) => compareTime(a.p.effective, b.p.effective) || order(a.t) - order(b.t));
  // A ledger that has not been initialized yet may still change.
  if (initialized(ledger)) kept.set(ledger, found);
  return found;
}

/**
 * Each obligation's progress per commodity, counting occurred postings on the effective axis up to
 * `at`; without `at`, every posting.
 */
export function progress(ledger: Hueke, at?: TimeValue): Map<Id, Map<Id, Progress>> {
  const accounts = new Map(ledger.accounts.map((a) => [a.id, a]));
  const result = new Map<Id, Map<Id, Progress & { readonly postings: Posting[] }>>();
  for (const { p, obligation, root } of obligationPostings(ledger, accounts)) {
    if (at && !matches(p.effective, "until", at)) continue;
    let byCommodity = result.get(obligation);
    if (!byCommodity) {
      byCommodity = new Map();
      result.set(obligation, byCommodity);
    }
    const commodity = p.amount.commodity;
    const before = byCommodity.get(commodity) ?? { original: ZERO, repaid: ZERO, postings: [] };
    // Lending opens the obligation and repayment reduces it, each by the posting's size.
    const size = abs(rational(p.amount.value));
    const direction = directionOf(p, accounts.get(root));
    const lending = direction === "lending";
    // The list is the one built for this call alone, so it grows in place.
    before.postings.push(p);
    byCommodity.set(commodity, {
      original: lending ? add(before.original, size) : before.original,
      repaid: direction === "repayment" ? add(before.repaid, size) : before.repaid,
      ...(direction === "repayment"
        ? { lastRepaid: p.effective }
        : before.lastRepaid && { lastRepaid: before.lastRepaid }),
      postings: before.postings,
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
