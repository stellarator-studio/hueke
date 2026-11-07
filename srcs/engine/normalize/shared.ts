// Helpers used by more than one normalization step.

import type {
  Account,
  Amount,
  Balance,
  Id,
  Metadata,
  Posting,
  Transaction,
} from "../../data/model/types.js";
import { obligationPlace, within } from "../../data/model/account.js";
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
  /**
   * A transaction dropped for unsupported syntax: it is not loaded, but it still takes its number
   * and defines its anchors (docs/core/ledger.md, "IDs").
   */
  readonly dropped?: true;
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

/** The entities of each obligation, by the obligation's account ID. */
export type ObligationEntities = ReadonlyMap<Id, readonly Id[]>;

/**
 * The entities of each obligation (docs/core/obligations.md, "Entities of an obligation"): the own
 * references of its occurred lending postings; without any, those of its repayment postings.
 */
export function obligationEntities(
  transactions: Iterable<Transaction>,
  accounts: ReadonlyMap<Id, Account>,
): Map<Id, Id[]> {
  const found = new Map<Id, { lending: Set<Id>; repayment: Set<Id> }>();
  for (const t of transactions) {
    if (t.occurrence !== "occurred") continue;
    for (const p of t.postings) {
      const place = obligationPlace(p.account, accounts);
      if (place?.kind !== "obligation") continue;
      let entry = found.get(place.obligation);
      if (!entry) {
        entry = { lending: new Set(), repayment: new Set() };
        found.set(place.obligation, entry);
      }
      const direction = directionOf(p, accounts.get(place.root));
      if (direction === undefined) continue;
      const side = direction === "lending" ? entry.lending : entry.repayment;
      for (const r of p.refs) side.add(r.entity);
    }
  }
  return new Map(
    [...found].map(([id, e]) => [id, [...(e.lending.size > 0 ? e.lending : e.repayment)]]),
  );
}

/**
 * On a receivable, a positive posting lends and a negative one repays; on a payable, the other way
 * round. A zero posting does neither.
 */
export function directionOf(
  p: Posting,
  root: Account | undefined,
): "lending" | "repayment" | undefined {
  const n = rational(p.amount.value).n;
  if (n === 0n) return undefined;
  return (root?.obligation === "payable" ? n < 0n : n > 0n) ? "lending" : "repayment";
}

/**
 * The entities a posting is read with (docs/core/query.md, "Matched postings"): on an obligation,
 * the obligation's; otherwise its own references, else its transaction's.
 */
export function entitiesOf(
  t: Transaction,
  p: { readonly account?: Id; readonly refs: Posting["refs"] },
  accounts: ReadonlyMap<Id, Account>,
  obligations: ObligationEntities,
): readonly Id[] {
  if (p.account !== undefined) {
    const place = obligationPlace(p.account, accounts);
    if (place?.kind === "obligation") return obligations.get(place.obligation) ?? [];
  }
  return (p.refs.length > 0 ? p.refs : t.refs).map((r) => r.entity);
}

/** Which postings a Balance counts: with an entity, only those read with it. */
export type Belongs = (t: Transaction, p: Posting) => boolean;

/** Balance of `account` (with sub-accounts) in one commodity, up to the balance's point. */
export function balanceAt(
  transactions: Iterable<Transaction>,
  account: Id,
  commodity: Id,
  at: Balance["effective"],
  belongs: Belongs = () => true,
): Rational {
  let total = ZERO;
  for (const t of transactions) {
    if (t.occurrence !== "occurred") continue;
    for (const p of t.postings)
      if (
        p.amount.commodity === commodity &&
        within(p.account, account) &&
        matches(p.effective, "until", at) &&
        belongs(t, p)
      )
        total = add(total, rational(p.amount.value));
  }
  return total;
}

/**
 * The postings a Balance asserts (docs/core/balance.md, "Entities in Balance assertions"). On
 * obligations the entity never narrows the assertion.
 */
export function balanceBelongs(
  b: Balance,
  accounts: ReadonlyMap<Id, Account>,
  obligations: ObligationEntities,
): Belongs {
  const entity = b.entity;
  if (entity === undefined || obligationPlace(b.account, accounts)) return () => true;
  return (t, p) => entitiesOf(t, p, accounts, obligations).includes(entity);
}

/** Postings not yet cleared in (after, at] for the diagnostics of a failed assertion. */
export function unclearedBetween(
  transactions: Iterable<Transaction>,
  b: Balance,
  after: Balance | undefined,
  belongs: Belongs = () => true,
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
        !(after && matches(p.effective, "until", after.effective)) &&
        belongs(t, p)
      )
        out.push(p);
  }
  return out;
}
