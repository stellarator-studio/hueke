// Posting rows, shown by `query` and by the uncleared part of `reconcile`.

import {
  timeOnAxis,
  type Amount,
  type Axis,
  type Commodity,
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
  readonly account: Id;
  readonly amount: Amount;
  readonly description: string;
}

export const commodityMap = (hueke: Hueke): Map<Id, Commodity> =>
  new Map(hueke.commodities.map((c) => [c.id, c]));

export function postingIndex(hueke: Hueke): Map<Id, Posting> {
  return new Map(hueke.transactions.flatMap((t) => t.postings.map((p) => [p.id, p] as const)));
}

export function postingRows(hueke: Hueke, postings: readonly Posting[], axis: Axis): PostingRow[] {
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
        account: p.account,
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
  const commodities = commodityMap(hueke);
  return table(
    rows.map((r) => [r.date, mark(r), r.account, amountText(r.amount, commodities), r.description]),
    [3],
  );
}
