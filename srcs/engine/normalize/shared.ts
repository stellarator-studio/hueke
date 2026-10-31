// Helpers used by more than one normalization step.

import type {
  Amount,
  Balance,
  Id,
  Metadata,
  Posting,
  Transaction,
} from "../../data/model/types.js";
import { within } from "../../data/model/account.js";
import type { ItemData, Note } from "../../data/raw/model.js";
import type { SourcePath } from "../../data/source/source.js";
import { matches } from "../../data/time/time.js";
import {
  abs,
  add,
  cmp,
  decimal,
  mul,
  neg,
  rational,
  tenToMinus,
  ZERO,
  type Rational,
} from "../../data/values/decimal.js";

/** A Raw record of the ledger with its module, in module order (docs/core/ledger.md). */
export interface SourcedItem {
  readonly item: ItemData;
  readonly source: SourcePath;
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

/** Weight for balancing: cost, else price, else the amount itself; signed like the amount. */
export function weightOf(p: { amount: Amount; price?: Amount; cost?: Amount }): Amount {
  const basis = p.cost ?? p.price;
  if (!basis) return p.amount;
  const value = rational(basis.value);
  return {
    value: decimal(rational(p.amount.value).n < 0n ? neg(value) : value),
    commodity: basis.commodity,
  };
}

export const show = (r: Rational, commodity: Id): string => `${decimal(r)} ${commodity}`;

/** A Balance's tolerance: within half a unit of the commodity's precision (docs/core/balance.md). */
export const withinHalfUnit = (difference: Rational, precision: number): boolean =>
  cmp(abs(difference), mul(rational("0.5"), tenToMinus(precision))) <= 0;

/** Balance of `account` (with sub-accounts) in one commodity, up to the balance's point. */
export function balanceAt(
  transactions: Iterable<Transaction>,
  account: Id,
  commodity: Id,
  at: Balance["effective"],
): Rational {
  let total = ZERO;
  for (const t of transactions) {
    if (t.occurrence !== "occurred") continue;
    for (const p of t.postings)
      if (
        p.amount.commodity === commodity &&
        within(p.account, account) &&
        matches(p.effective, "until", at)
      )
        total = add(total, rational(p.amount.value));
  }
  return total;
}

/** Postings not yet cleared in (after, at] for the diagnostics of a failed assertion. */
export function unclearedBetween(
  transactions: Iterable<Transaction>,
  b: Balance,
  after: Balance | undefined,
): Posting[] {
  const out: Posting[] = [];
  for (const t of transactions) {
    if (t.occurrence !== "occurred") continue;
    for (const p of t.postings)
      if (
        p.status === "none" &&
        p.amount.commodity === b.amount.commodity &&
        within(p.account, b.account) &&
        matches(p.effective, "until", b.effective) &&
        !(after && matches(p.effective, "until", after.effective))
      )
        out.push(p);
  }
  return out;
}
