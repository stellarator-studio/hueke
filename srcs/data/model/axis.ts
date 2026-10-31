// Which time a posting has on each axis (docs/core/time.md, "Time axes").

import type { Axis, Posting, TimeValue, Transaction } from "./types.js";

/**
 * The time of `posting` on `axis`: its transaction's accounting time, its own effective time, or
 * its transaction's effective time.
 */
export function timeOnAxis(transaction: Transaction, posting: Posting, axis: Axis): TimeValue {
  if (axis === "accounting") return transaction.accounting;
  if (axis === "effective") return posting.effective;
  return transaction.effective;
}

/** The time of a transaction on `axis`: its accounting time, else its effective time. */
export const transactionTime = (transaction: Transaction, axis: Axis): TimeValue =>
  axis === "accounting" ? transaction.accounting : transaction.effective;
