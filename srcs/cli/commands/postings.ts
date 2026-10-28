// Posting rows, shown by `query`.

import type { Amount, Commodity, Hueke, Id, Posting } from "../../index.js";
import { amountText, table } from "../output.js";

export interface PostingRow {
  readonly date: string; // the transaction's time, as written
  readonly transaction: Id;
  readonly posting: Id;
  readonly account: Id;
  readonly amount: Amount;
  readonly description: string;
}

export const commodityMap = (hueke: Hueke): Map<Id, Commodity> =>
  new Map(hueke.commodities.map((c) => [c.id, c]));

export function postingRows(hueke: Hueke, postings: readonly Posting[]): PostingRow[] {
  const transactions = new Map(hueke.transactions.map((t) => [t.id, t]));
  return postings.flatMap((p) => {
    const t = transactions.get(p.transaction);
    if (!t) return [];
    return [
      {
        date: t.time.literal,
        transaction: t.id,
        posting: p.id,
        account: p.account,
        amount: p.amount,
        description: t.description ?? "",
      },
    ];
  });
}

export function postingTable(hueke: Hueke, rows: readonly PostingRow[]): string {
  const commodities = commodityMap(hueke);
  return table(
    rows.map((r) => [r.date, r.account, amountText(r.amount, commodities), r.description]),
    [2],
  );
}
