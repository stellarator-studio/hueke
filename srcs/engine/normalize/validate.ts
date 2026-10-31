// Normalization step 7: checks that only flag problems and never change what is computed. They run
// on the first check() call (docs/core/ledger.md, "Normalization").

import type { Balance, Commodity, Id, Posting, Transaction } from "../../data/model/types.js";
import type { Diagnostic, SourcePath } from "../../data/source/source.js";
import { compareTime } from "../../data/time/time.js";
import {
  abs,
  add,
  cmp,
  decimal,
  isInteger,
  mul,
  rational,
  sub,
  tenToMinus,
  ZERO,
  type Rational,
} from "../../data/values/decimal.js";
import { diagnostic } from "../../data/source/diagnostics.js";
import { balanceAt, show, unclearedBetween, weightOf, withinHalfUnit } from "./shared.js";

export interface ValidationInput {
  readonly transactions: readonly Transaction[];
  readonly balances: readonly Balance[];
  readonly commodities: ReadonlyMap<Id, Commodity>;
  readonly decimals: ReadonlyMap<Posting, number>;
}

export function validate(input: ValidationInput): Diagnostic[] {
  const out: Diagnostic[] = [];
  const { transactions, commodities } = input;

  for (const t of transactions) {
    if (!t.origin) continue; // generated records balance by construction
    const source = t.source;
    unbalanced(t, commodities, source, out);
    for (const p of t.postings) {
      const c = commodities.get(p.amount.commodity);
      if (!c) continue;
      if (c.item && !isInteger(rational(p.amount.value)))
        out.push(
          diagnostic(
            "item.fractional",
            `${p.amount.value} ${c.id} is not a whole number of items`,
            source,
            p.span,
          ),
        );
      const written = input.decimals.get(p);
      if (!c.item && c.precisionWritten && written !== undefined && written > c.precision)
        out.push(
          diagnostic(
            "posting.excess-precision",
            `${p.amount.value} ${c.id} has more than ${String(c.precision)} decimal places`,
            source,
            p.span,
          ),
        );
    }
  }

  itemBalances(transactions, commodities, out);
  hardBalances(input, out);
  return out;
}

function unbalanced(
  t: Transaction,
  commodities: ReadonlyMap<Id, Commodity>,
  source: SourcePath | undefined,
  out: Diagnostic[],
): void {
  if (t.postings.length === 0) return;
  const groups = new Map<Id, { total: Rational; converted: number }>();
  for (const p of t.postings) {
    const w = weightOf(p);
    const g = groups.get(w.commodity) ?? { total: ZERO, converted: 0 };
    g.total = add(g.total, rational(w.value));
    if (p.cost ?? p.price) g.converted++;
    groups.set(w.commodity, g);
  }
  const off: string[] = [];
  for (const [commodity, g] of groups) {
    const precision = commodities.get(commodity)?.precision ?? 0;
    // |sum| ≤ 0.5 × 10^-precision × k, where k counts weights converted by a price or cost
    const tolerance = mul(
      mul(rational("0.5"), tenToMinus(precision)),
      rational(String(Math.max(1, g.converted))),
    );
    if (cmp(abs(g.total), tolerance) > 0) off.push(show(g.total, commodity));
  }
  if (off.length > 0)
    out.push(
      diagnostic(
        "txn.unbalanced",
        `the postings do not balance: ${off.join(", ")}`,
        source,
        t.span,
      ),
    );
}

function itemBalances(
  transactions: readonly Transaction[],
  commodities: ReadonlyMap<Id, Commodity>,
  out: Diagnostic[],
): void {
  const sources = new Map<Posting, SourcePath | undefined>();
  for (const t of transactions) for (const p of t.postings) sources.set(p, t.source);
  const postings = transactions
    .filter((t) => t.occurrence === "occurred")
    .flatMap((t) => t.postings)
    .filter((p) => commodities.get(p.amount.commodity)?.item === true)
    .sort((a, b) => compareTime(a.effective, b.effective));
  const running = new Map<string, Rational>();
  const reported = new Set<string>();
  for (const p of postings) {
    const key = `${p.account}\u0000${p.amount.commodity}`;
    const total = add(running.get(key) ?? ZERO, rational(p.amount.value));
    running.set(key, total);
    if (total.n < 0n && !reported.has(key)) {
      reported.add(key);
      out.push(
        diagnostic(
          "item.invalid-balance",
          `${p.amount.commodity} in ${p.account} falls to ${decimal(total)} on ${p.effective.localDate}`,
          sources.get(p),
          p.span,
        ),
      );
    }
  }
}

function hardBalances(input: ValidationInput, out: Diagnostic[]): void {
  const { balances, transactions, commodities } = input;
  const ordered = [...balances].sort((a, b) =>
    a.effective.end < b.effective.end ? -1 : a.effective.end > b.effective.end ? 1 : 0,
  );
  const previous = new Map<string, Balance>();
  for (const b of ordered) {
    const key = `${b.account}\u0000${b.amount.commodity}`;
    const before = previous.get(key);
    previous.set(key, b);
    if (b.mode !== "hard") continue;
    const commodity = b.amount.commodity;
    const recorded = balanceAt(transactions, b.account, commodity, b.effective);
    const asserted = rational(b.amount.value);
    if (withinHalfUnit(sub(recorded, asserted), commodities.get(commodity)?.precision ?? 0))
      continue;
    const uncleared = unclearedBetween(transactions, b, before)
      .map((p) => `${p.effective.localDate} ${p.amount.value}`)
      .join(", ");
    out.push(
      diagnostic(
        "balance.mismatch",
        `${b.account}: asserted ${show(asserted, commodity)}, recorded ${show(recorded, commodity)}, off by ${show(sub(recorded, asserted), commodity)}` +
          (uncleared ? `; not cleared: ${uncleared}` : ""),
        b.source,
        b.span,
      ),
    );
  }
}
