// Posting rows, shown by `query` and by the uncleared part of `reconcile`.

import {
  timeOnAxis,
  type Amount,
  type Axis,
  type Hueke,
  type Id,
  type Posting,
  type Status,
  type Transaction,
} from "../../index.js";
import { amountText, table } from "../output.js";

export interface PostingRow {
  readonly date: string; // the posting's time on the axis, as written
  readonly transaction: Id;
  readonly posting: Id;
  readonly occurrence: Transaction["occurrence"];
  readonly status: Status;
  readonly account: string; // the ID, or the display name with --name
  readonly amount: Amount;
  readonly description: string;
}

export function postingIndex(hueke: Hueke): Map<Id, Posting> {
  return new Map(hueke.transactions.flatMap((t) => t.postings.map((p) => [p.id, p] as const)));
}

export function postingRows(
  hueke: Hueke,
  postings: readonly Posting[],
  axis: Axis,
  shown: (account: Id) => string = (account) => account,
): PostingRow[] {
  const transactions = new Map(hueke.transactions.map((t) => [t.id, t]));
  return postings.flatMap((p) => {
    const t = transactions.get(p.transaction);
    if (!t) return [];
    return [
      {
        date: timeOnAxis(t, p, axis).literal,
        transaction: t.id,
        posting: p.id,
        occurrence: t.occurrence,
        status: p.status,
        account: shown(p.account),
        amount: p.amount,
        description: t.description ?? "",
      },
    ];
  });
}

/** `!` planned, `#` cancelled, `*` cleared. */
export function mark(r: PostingRow): string {
  if (r.occurrence === "planned") return "!";
  if (r.occurrence === "cancelled") return "#";
  return r.status === "cleared" ? "*" : "";
}

export function postingTable(hueke: Hueke, rows: readonly PostingRow[]): string {
  const amount = amountText(hueke);
  return table(
    rows.map((r) => [r.date, mark(r), r.account, amount(r.amount), r.description]),
    [3],
  );
}
