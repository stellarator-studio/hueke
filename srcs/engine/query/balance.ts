// `balance` and `register` (docs/core/query.md): the matched postings on the account tree.

import type { Hueke } from "../hueke.js";
import { accountTree, type AccountTreeRow, type RegisterRow } from "./tree.js";
import { query, type Query } from "./query.js";

export function balance(ledger: Hueke, q: Query = query(ledger)): AccountTreeRow[] {
  return register(ledger, q).map(({ account, depth, subtotal, amounts }) => ({
    account,
    depth,
    subtotal,
    amounts,
  }));
}

export function register(ledger: Hueke, q: Query = query(ledger)): RegisterRow[] {
  return accountTree(q.postings());
}
