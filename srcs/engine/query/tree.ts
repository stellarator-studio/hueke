// The account tree (docs/core/query.md, "Account tree"): matched postings by account, with
// subtotals for parent accounts.

import { within } from "../../data/model/account.js";
import { compareText } from "../../data/model/order.js";
import type { Amount, Id, Posting } from "../../data/model/types.js";
import { add, decimal, rational, ZERO, type Rational } from "../../data/values/decimal.js";

export interface AccountTreeRow {
  readonly account: Id;
  readonly depth: number; // 1 for a root
  readonly subtotal: boolean;
  readonly amounts: Amount[];
}

export interface RegisterRow extends AccountTreeRow {
  readonly postings: Posting[]; // empty on a subtotal row
}

/** Rows in account order, a subtotal before the account's own row; postings keep their order. */
export function accountTree(postings: readonly Posting[]): RegisterRow[] {
  const own = new Map<Id, Posting[]>();
  for (const p of postings) {
    const account = p.account;
    const list = own.get(account);
    if (list) list.push(p);
    else own.set(account, [p]);
  }
  // A parent gets a subtotal only when some sub-account has postings of its own.
  const parents = new Set<Id>();
  for (const account of own.keys()) for (const a of ancestors(account)) parents.add(a);
  const rows: RegisterRow[] = [];
  for (const account of new Set([...own.keys(), ...parents])) {
    const depth = account.split(":").length;
    if (parents.has(account)) {
      const under = [...own].filter(([a]) => within(a, account));
      rows.push({
        account,
        depth,
        subtotal: true,
        amounts: sum(under.flatMap(([, ps]) => ps)),
        postings: [],
      });
    }
    const mine = own.get(account);
    if (mine) rows.push({ account, depth, subtotal: false, amounts: sum(mine), postings: mine });
  }
  return rows.sort(
    (a, b) => compareAccounts(a.account, b.account) || Number(b.subtotal) - Number(a.subtotal),
  );
}

/** Segment by segment, so that `Assets:Cash` stays next to `Assets` before `Assets-X`. */
function compareAccounts(a: Id, b: Id): number {
  const x = a.split(":");
  const y = b.split(":");
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const c = compareText(x[i] ?? "", y[i] ?? "");
    if (c !== 0) return c;
  }
  return x.length - y.length;
}

function ancestors(account: Id): Id[] {
  const parts = account.split(":");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join(":"));
}

/** One total per commodity, sorted by commodity. */
function sum(postings: readonly Posting[]): Amount[] {
  const totals = new Map<Id, Rational>();
  for (const p of postings)
    totals.set(
      p.amount.commodity,
      add(totals.get(p.amount.commodity) ?? ZERO, rational(p.amount.value)),
    );
  return [...totals]
    .sort(([a], [b]) => compareText(a, b))
    .map(([commodity, total]) => ({ value: decimal(total), commodity }));
}
