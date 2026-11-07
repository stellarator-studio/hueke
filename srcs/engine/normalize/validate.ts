// Normalization step 7: checks that only flag problems and never change what is computed. They run
// on the first check() call (docs/core/ledger.md, "Normalization").

import type {
  Account,
  Balance,
  Commodity,
  Id,
  Posting,
  Transaction,
} from "../../data/model/types.js";
import { obligationPlace } from "../../data/model/account.js";
import type { Diagnostic, SourcePath } from "../../data/source/source.js";
import { compareTime } from "../../data/time/time.js";
import {
  abs,
  add,
  cmp,
  decimal,
  isInteger,
  mul,
  neg,
  rational,
  sub,
  tenToMinus,
  ZERO,
  type Rational,
} from "../../data/values/decimal.js";
import { diagnostic } from "../../data/source/diagnostics.js";
import {
  balanceAt,
  balanceBelongs,
  show,
  unclearedBetween,
  weightOf,
  withinHalfUnit,
  type ObligationEntities,
} from "./shared.js";

export interface ValidationInput {
  readonly transactions: readonly Transaction[];
  readonly balances: readonly Balance[];
  readonly commodities: ReadonlyMap<Id, Commodity>;
  readonly accounts: ReadonlyMap<Id, Account>;
  readonly obligations: ObligationEntities;
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
  obligationPostings(input, out);
  refunds(input, out);
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
    // A Balance with an entity follows only those with the same entity.
    const key = `${b.account}\u0000${b.amount.commodity}\u0000${b.entity ?? ""}`;
    const before = previous.get(key);
    previous.set(key, b);
    if (b.mode !== "hard") continue;
    const commodity = b.amount.commodity;
    const belongs = balanceBelongs(b, input.accounts, input.obligations);
    const recorded = balanceAt(transactions, b.account, commodity, b.effective, belongs);
    const asserted = rational(b.amount.value);
    if (withinHalfUnit(sub(recorded, asserted), commodities.get(commodity)?.precision ?? 0))
      continue;
    const uncleared = unclearedBetween(transactions, b, before, belongs)
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

/** Postings outside any obligation, obligations without an entity, mixed commodities. */
function obligationPostings(input: ValidationInput, out: Diagnostic[]): void {
  const { transactions, accounts, obligations } = input;
  const seen = new Map<Id, { commodities: Set<Id>; linked: boolean; unlinked?: Posting }>();
  const sources = new Map<Posting, SourcePath | undefined>();
  // Where a record is written: generated postings are not written anywhere.
  for (const b of input.balances)
    if (obligationPlace(b.account, accounts)?.kind === "nested")
      out.push(
        diagnostic(
          "obligation.nested",
          `${b.account} is inside an obligation; an obligation has no sub-accounts`,
          b.source,
          b.span,
        ),
      );
  for (const t of transactions)
    for (const p of t.postings) {
      const place = obligationPlace(p.account, accounts);
      if (!place) continue;
      if (place.kind === "root" && t.origin)
        out.push(
          diagnostic(
            "obligation.root-posting",
            `${p.account} is an obligation account; post to one of its obligations`,
            t.source,
            p.span,
          ),
        );
      if (place.kind === "nested" && t.origin)
        out.push(
          diagnostic(
            "obligation.nested",
            `${p.account} is inside the obligation ${place.obligation}; use a reference to say who it is with`,
            t.source,
            p.span,
          ),
        );
      if (place.kind !== "obligation" || t.occurrence !== "occurred") continue;
      let entry = seen.get(place.obligation);
      if (!entry) {
        entry = { commodities: new Set(), linked: false };
        seen.set(place.obligation, entry);
        sources.set(p, t.source);
        if ((obligations.get(place.obligation) ?? []).length === 0)
          out.push(
            diagnostic(
              "obligation.missing-entity",
              `no posting of ${place.obligation} names anyone it is with`,
              t.source,
              p.span,
            ),
          );
      }
      if (entry.commodities.size > 0 && !entry.commodities.has(p.amount.commodity))
        if (!entry.unlinked) {
          entry.unlinked = p;
          sources.set(p, t.source);
        }
      entry.commodities.add(p.amount.commodity);
      if (p.price ?? p.cost) entry.linked = true;
    }
  for (const [obligation, e] of seen)
    if (e.unlinked && !e.linked)
      out.push(
        diagnostic(
          "obligation.unlinked-commodity",
          `${obligation} has postings in ${[...e.commodities].join(", ")} and none has a price or a cost`,
          sources.get(e.unlinked),
          e.unlinked.span,
        ),
      );
}

/**
 * Refunds beyond the original amount, per income and expense account and commodity
 * (docs/core/anchors.md, "Refunds"); once per refunded transaction.
 */
function refunds(input: ValidationInput, out: Diagnostic[]): void {
  const { transactions, accounts, commodities } = input;
  const byId = new Map(transactions.map((t) => [t.id, t]));
  const pnl = (account: Id): boolean => {
    const type = accounts.get(account)?.type;
    return type === "income" || type === "expense";
  };
  const net = (t: Transaction): Map<string, Rational> => {
    const totals = new Map<string, Rational>();
    for (const p of t.postings) {
      if (!pnl(p.account)) continue;
      const key = `${p.account}\u0000${p.amount.commodity}`;
      totals.set(key, add(totals.get(key) ?? ZERO, rational(p.amount.value)));
    }
    return totals;
  };
  const state = new Map<
    Id,
    { original: Map<string, Rational>; refunded: Map<string, Rational>; first?: Transaction }
  >();
  const exceeds = (original: Rational, refunded: Rational, key: string): boolean => {
    if (original.n === 0n) return false;
    // Refunds go the other way from the original.
    const back = original.n > 0n ? neg(refunded) : refunded;
    const precision = commodities.get(key.split("\u0000")[1] ?? "")?.precision ?? 0;
    return cmp(sub(back, abs(original)), mul(rational("0.5"), tenToMinus(precision))) > 0;
  };
  for (const t of transactions) {
    if (t.occurrence !== "occurred") continue;
    const targets = new Set(
      t.tags
        .filter((tag) => tag.scope === "refund" && tag.target !== undefined)
        .map((tag) => tag.target as Id),
    );
    for (const target of targets) {
      const original = byId.get(target);
      if (!original) continue;
      let s = state.get(target);
      if (!s) {
        s = { original: net(original), refunded: new Map() };
        state.set(target, s);
      }
      for (const [key, value] of net(t)) {
        if (!s.original.has(key)) continue;
        s.refunded.set(key, add(s.refunded.get(key) ?? ZERO, value));
      }
      const current = s;
      if (
        !current.first &&
        [...current.refunded].some(([key, r]) => exceeds(current.original.get(key) ?? ZERO, r, key))
      )
        current.first = t;
    }
  }
  // In the order of the refunds that exceed.
  const position = new Map(transactions.map((t, i) => [t, i]));
  const exceeded = [...state].flatMap(([target, s]) =>
    s.first ? [{ target, s, first: s.first }] : [],
  );
  exceeded.sort((a, b) => (position.get(a.first) ?? 0) - (position.get(b.first) ?? 0));
  for (const { target, s, first } of exceeded) {
    const parts = [...s.refunded]
      .filter(([key, r]) => exceeds(s.original.get(key) ?? ZERO, r, key))
      .map(([key, r]) => {
        const [account = "", commodity = ""] = key.split("\u0000");
        const original = s.original.get(key) ?? ZERO;
        return `${account} original ${show(abs(original), commodity)}, refunded ${show(abs(r), commodity)}`;
      });
    out.push(
      diagnostic(
        "refund.exceeds",
        `the refunds of ${target} exceed it: ${parts.join("; ")}`,
        first.source,
        first.span,
      ),
    );
  }
}
