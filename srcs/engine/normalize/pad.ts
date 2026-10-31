// Normalization step 6: `pad` balances, point by point (docs/core/balance.md, "Point-by-point expansion").

import type {
  Amount,
  Balance,
  Id,
  LedgerSettings,
  Posting,
  Transaction,
} from "../../data/model/types.js";
import type { Diagnostic } from "../../data/source/source.js";
import { within } from "../../data/model/account.js";
import {
  add,
  decimal,
  isZero,
  neg,
  rational,
  sub,
  type Rational,
} from "../../data/values/decimal.js";
import { diagnostic, type Code } from "../../data/source/diagnostics.js";
import { balanceAt, show, withinHalfUnit } from "./shared.js";

/** A posting a pad would generate: on which account, in which commodity. */
interface Effect {
  readonly account: Id;
  readonly commodity: Id;
}

/**
 * Expands `pad` balances, given in source order. Returns the generated transactions, each with
 * the Balance it pads. `precision` gives each commodity's precision, declared or inferred.
 */
export function expandPads(
  balances: readonly Balance[],
  transactions: Transaction[],
  settings: LedgerSettings,
  precision: (commodity: Id) => number,
  out: Diagnostic[],
): { balance: Balance; transaction: Transaction }[] {
  // Array.prototype.sort is stable, so source order decides ties.
  const pads = balances
    .filter((b) => b.mode === "pad")
    .sort((a, b) =>
      a.effective.end < b.effective.end ? -1 : a.effective.end > b.effective.end ? 1 : 0,
    );
  const padAccountOf = (b: Balance): Id | undefined => b.padAccount ?? settings.padAccount;
  const report = (code: Code, message: string, b: Balance): void => {
    out.push(diagnostic(code, message, b.source, b.span));
  };

  // A pad fills only the asserted commodity, from a counter-account.
  const effects = new Map<Balance, Effect[]>();
  for (const b of pads) {
    const padAccount = padAccountOf(b);
    if (b.pad && b.pad.commodity !== b.amount.commodity)
      report(
        "balance.pad-commodity",
        `the pad of ${b.account} asserts ${b.amount.commodity} but pads ${b.pad.commodity}`,
        b,
      );
    else if (padAccount === undefined)
      report("balance.missing-pad-account", `pad of ${b.account} has no account to pad from`, b);
    else
      effects.set(b, [
        { account: b.account, commodity: b.amount.commodity },
        { account: padAccount, commodity: b.padPrice?.commodity ?? b.amount.commodity },
      ]);
  }

  // Pads at the same point must not affect each other, nor pad from inside their own account.
  const affects = (a: Balance, b: Balance): boolean =>
    (effects.get(a) ?? []).some(
      (e) => e.commodity === b.amount.commodity && within(e.account, b.account),
    );
  const conflicted = new Set<Balance>();
  for (const a of effects.keys()) {
    const [, counter] = effects.get(a) ?? [];
    if (counter && counter.commodity === a.amount.commodity && within(counter.account, a.account)) {
      conflicted.add(a);
      report(
        "balance.pad-conflict",
        `the pad of ${a.account} pads from ${counter.account}, inside ${a.account} itself`,
        a,
      );
    }
    const other = [...effects.keys()].find(
      (b) => a !== b && a.effective.end === b.effective.end && (affects(a, b) || affects(b, a)),
    );
    if (!other) continue;
    conflicted.add(a);
    report(
      "balance.pad-conflict",
      `the pad of ${a.account} and the pad of ${other.account} at the same point affect each other`,
      a,
    );
  }

  const generated: Transaction[] = [];
  const result: { balance: Balance; transaction: Transaction }[] = [];
  const all = (): Iterable<Transaction> => [...transactions, ...generated];
  for (const b of pads) {
    const padAccount = padAccountOf(b);
    if (!effects.has(b) || conflicted.has(b) || padAccount === undefined) continue;
    const commodity = b.amount.commodity;
    const current = balanceAt(all(), b.account, commodity, b.effective);
    const asserted = rational(b.amount.value);
    let diff: Rational;
    if (b.pad) {
      diff = rational(b.pad.value);
      const off = sub(add(current, diff), asserted);
      if (!withinHalfUnit(off, precision(commodity))) {
        report(
          "balance.mismatch",
          `${b.account}: asserted ${show(asserted, commodity)}, recorded ${show(current, commodity)} plus pad ${show(diff, commodity)}, off by ${show(off, commodity)}`,
          b,
        );
        continue;
      }
    } else diff = sub(asserted, current);
    if (isZero(diff) || (!b.pad && withinHalfUnit(diff, precision(commodity)))) continue;
    const transaction = padTransaction(
      b,
      padAccount,
      { value: decimal(diff), commodity },
      generated.length + 1,
    );
    generated.push(transaction);
    result.push({ balance: b, transaction });
  }
  return result;
}

function padTransaction(b: Balance, padAccount: Id, diff: Amount, n: number): Transaction {
  const id = `~balance.${String(n)}`;
  const tags = [{ scope: "system", ref: { name: "balance" } }];
  const counter: Amount = b.padPrice
    ? { value: decimal(neg(rational(b.padPrice.value))), commodity: b.padPrice.commodity }
    : { value: decimal(neg(rational(diff.value))), commodity: diff.commodity };
  const posting = (k: number, account: Id, amount: Amount, price?: Amount): Posting => ({
    id: `${id}.${String(k)}`,
    transaction: id,
    account,
    amount,
    ...(price && { price }),
    status: "none",
    effective: b.effective,
    tags,
    refs: [],
    meta: {},
    breakdown: [],
  });
  return {
    id,
    ...(b.source !== undefined && { source: b.source }),
    effective: b.effective,
    accounting: b.accounting ?? b.effective,
    occurrence: "occurred",
    status: "none",
    tags,
    refs: [],
    meta: {},
    postings: [posting(1, b.account, diff, b.padPrice), posting(2, padAccount, counter)],
  };
}
