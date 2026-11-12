// The account tree (docs/core/query.md, "Account tree"): matched postings by account, with
// subtotals for parent accounts. With `income-expense` on, income and expense accounts are shown
// under the merged root (docs/core/accounts.md, "Combined income and expense").

import type { Hueke } from "../hueke.js";
import { within } from "../../data/model/account.js";
import { compareText } from "../../data/model/order.js";
import type { Amount, Id, Posting } from "../../data/model/types.js";
import { add, decimal, rational, ZERO, type Rational } from "../../data/values/decimal.js";

export interface AccountTreeRow {
  readonly account: Id; // as shown: under the merged root for income and expense accounts
  readonly depth: number; // 1 for a root
  readonly subtotal: boolean;
  readonly amounts: Amount[];
}

export interface RegisterRow extends AccountTreeRow {
  readonly postings: Posting[]; // empty on a subtotal row
}

/** The name each account is shown under; unchanged unless `income-expense` is on. */
export function shownAccount(hueke: Hueke): (account: Id) => Id {
  const merged = hueke.settings.incomeExpenseRoot;
  if (merged === undefined) return (account) => account;
  const types = new Map(hueke.roots.map((r) => [r.name, r.type]));
  return (account) => {
    const colon = account.indexOf(":");
    const root = colon < 0 ? account : account.slice(0, colon);
    const type = types.get(root);
    return type === "income" || type === "expense"
      ? merged + (colon < 0 ? "" : account.slice(colon))
      : account;
  };
}

/** Rows in account order, a subtotal before the account's own row; postings keep their order. */
export function accountTree(hueke: Hueke, postings: readonly Posting[]): RegisterRow[] {
  const show = shownAccount(hueke);
  const own = new Map<Id, Posting[]>();
  for (const p of postings) {
    const account = show(p.account);
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
export function compareAccounts(a: Id, b: Id): number {
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

/** Adds an amount to running totals by commodity. */
export function addTo(totals: Map<Id, Rational>, amount: Amount): Map<Id, Rational> {
  return totals.set(
    amount.commodity,
    add(totals.get(amount.commodity) ?? ZERO, rational(amount.value)),
  );
}

/** Running totals as amounts, one per commodity, sorted by commodity. */
export function amountsOf(totals: ReadonlyMap<Id, Rational>): Amount[] {
  return [...totals]
    .sort(([a], [b]) => compareText(a, b))
    .map(([commodity, total]) => ({ value: decimal(total), commodity }));
}

/** One total per commodity, sorted by commodity. */
function sum(postings: readonly Posting[]): Amount[] {
  const totals = new Map<Id, Rational>();
  for (const p of postings) addTo(totals, p.amount);
  return amountsOf(totals);
}
