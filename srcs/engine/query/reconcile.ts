// The reconciliation view of an account without a statement cycle (docs/core/balance.md,
// "Reconciliation view"): one view per commodity, from the latest Balance in that commodity
// before `at` to `at`.

import type { Hueke } from "../hueke.js";
import { compareText } from "../../data/model/order.js";
import type { Amount, Id, Posting, TimeValue } from "../../data/model/types.js";
import { matches, timeInput } from "../../data/time/time.js";
import { add, decimal, neg, rational, ZERO } from "../../data/values/decimal.js";
import { query, type TimeInput } from "./query.js";

export interface ReconcileView {
  readonly account: Id;
  readonly commodity: Id;
  readonly range: { readonly after?: TimeValue; readonly until: TimeValue }; // (after, until]
  readonly opening: Amount;
  readonly postings: Id[]; // in effective order
  readonly closing: Amount;
  readonly uncleared: Id[]; // up to `until`, earlier periods included
  readonly asserted?: Amount;
  readonly difference?: Amount;
}

export function reconcile(ledger: Hueke, req: { account: Id; at: TimeInput }): ReconcileView[] {
  const { timezone, weekStart } = ledger.settings;
  const at = timeInput(req.at, { timezone, weekStart });
  // Only Balances on exactly this account count, not those on its sub-accounts nor those with an
  // entity.
  const mine = ledger.balances.filter(
    (b) => b.account === req.account && b.entity === undefined && matches(b.effective, "until", at),
  );
  const postings = query(ledger).axis("effective").accounts(req.account).until(at).postings();
  const commodities = new Set([
    ...postings.map((p) => p.amount.commodity),
    ...mine.map((b) => b.amount.commodity),
  ]);

  return [...commodities].sort(compareText).map((commodity) => {
    const own = postings.filter((p) => p.amount.commodity === commodity);
    const assertions = mine.filter((b) => b.amount.commodity === commodity);
    const after = assertions
      .filter((b) => b.effective.end < at.end && !matches(at, "until", b.effective))
      .sort((a, b) =>
        a.effective.end < b.effective.end ? -1 : a.effective.end > b.effective.end ? 1 : 0,
      )
      .at(-1)?.effective;
    const total = (ps: readonly Posting[]): Amount => ({
      value: decimal(ps.reduce((sum, p) => add(sum, rational(p.amount.value)), ZERO)),
      commodity,
    });
    const before = (p: Posting): boolean =>
      after !== undefined && matches(p.effective, "until", after);
    const closing = total(own);
    const asserted = assertions.find((b) => b.effective.end === at.end)?.amount;
    return {
      account: req.account,
      commodity,
      range: { ...(after && { after }), until: at },
      opening: total(own.filter(before)),
      postings: own.filter((p) => !before(p)).map((p) => p.id),
      closing,
      uncleared: own.filter((p) => p.status === "none").map((p) => p.id),
      ...(asserted && {
        asserted,
        difference: {
          value: decimal(add(rational(closing.value), neg(rational(asserted.value)))),
          commodity,
        },
      }),
    };
  });
}
