// Normalization step 4: checks that only flag problems and never change what is computed. They run
// on the first check() call (docs/core/ledger.md, "Normalization").

import type { Commodity, Id, Posting, Transaction } from "../../data/model/types.js";
import type { Diagnostic, SourcePath } from "../../data/source/source.js";
import {
  abs,
  add,
  cmp,
  decimal,
  mul,
  rational,
  tenToMinus,
  ZERO,
  type Rational,
} from "../../data/values/decimal.js";
import { diagnostic } from "../../data/source/diagnostics.js";
import { weightOf } from "./shared.js";

export interface ValidationInput {
  readonly source: SourcePath;
  readonly transactions: readonly Transaction[];
  readonly commodities: ReadonlyMap<Id, Commodity>;
  readonly decimals: ReadonlyMap<Posting, number>;
}

export function validate(input: ValidationInput): Diagnostic[] {
  const out: Diagnostic[] = [];
  const { source, transactions, commodities } = input;

  for (const t of transactions) {
    unbalanced(t, commodities, source, out);
    for (const p of t.postings) {
      const c = commodities.get(p.amount.commodity);
      const written = input.decimals.get(p);
      if (c?.precisionWritten && written !== undefined && written > c.precision)
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
  return out;
}

function unbalanced(
  t: Transaction,
  commodities: ReadonlyMap<Id, Commodity>,
  source: SourcePath,
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
    if (cmp(abs(g.total), tolerance) > 0) off.push(`${decimal(g.total)} ${commodity}`);
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
