// `balance` and `register` (docs/core/query.md): the matched postings on the account tree, as a
// period report on the effective axis unless the query sets one. Rows of settled obligations are
// left out unless `all` is set (docs/core/obligations.md, "Hiding settled obligations").

import type { Hueke } from "../hueke.js";
import { settledObligations } from "./obligations.js";
import { accountTree, type AccountTreeRow, type RegisterRow } from "./tree.js";
import { periodReport, query, rangeEnd, type Query } from "./query.js";

export interface BalanceOptions {
  /** Also list settled obligations. */
  readonly all?: boolean;
}

export function balance(
  ledger: Hueke,
  q: Query = query(ledger),
  options: BalanceOptions = {},
): AccountTreeRow[] {
  return register(ledger, q, options).map(({ account, depth, subtotal, amounts }) => ({
    account,
    depth,
    subtotal,
    amounts,
  }));
}

export function register(
  ledger: Hueke,
  q: Query = query(ledger),
  options: BalanceOptions = {},
): RegisterRow[] {
  const rows = accountTree(ledger, periodReport(q, "effective").postings());
  if (options.all === true) return rows;
  const settled = settledObligations(ledger, rangeEnd(q));
  // A row is shown under the merged root's name when income-expense is on, so its postings say
  // which accounts it holds.
  return rows.filter(
    (r) =>
      r.subtotal || r.postings.length === 0 || !r.postings.every((p) => settled.has(p.account)),
  );
}
