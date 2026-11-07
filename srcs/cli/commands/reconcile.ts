// `hueke reconcile`: the reconciliation views of one account at `--at`, one per commodity.

import {
  reconcile,
  sumValues,
  type Amount,
  type Hueke,
  type Id,
  type Posting,
} from "../../index.js";
import { UsageError, type CliIO } from "../io.js";
import { amountText, table } from "../output.js";
import type { Command, Options } from "./command.js";
import { mark, postingIndex, postingRows, postingTable } from "./postings.js";

export const reconcileCommand: Command = {
  usage: "reconcile <account> --at <time> --file <path> [--balance] [--strict]",
  options: ["at", "balance"],
  run(hueke: Hueke, args: readonly string[], options: Options, io: CliIO): number {
    const [account, ...extra] = args;
    if (account === undefined || extra.length > 0)
      throw new UsageError("reconcile takes exactly one account");
    if (options.at === undefined) throw new UsageError("reconcile needs --at");
    if (options.format !== "table")
      throw new UsageError(`reconcile has no ${options.format} output`);
    const postings = postingIndex(hueke);
    const pick = (ids: readonly Id[]): Posting[] => ids.flatMap((id) => postings.get(id) ?? []);
    const amount = amountText(hueke);
    const text = reconcile(hueke, { account, at: options.at }).map((v) => {
      const period = postingRows(hueke, pick(v.postings), "effective");
      const uncleared = postingRows(hueke, pick(v.uncleared), "effective");
      const head = `${v.account}  ${v.commodity}  ${v.range.after?.literal ?? "start"} .. ${v.range.until.literal}\n`;
      let running = v.opening.value;
      // With --balance, opening and closing sit in the balance column.
      const wide = options.balance === true;
      const figure = (label: string, a: Amount): string[] =>
        wide ? [label, "", "", amount(a)] : [label, "", amount(a)];
      const posting = (r: (typeof period)[number]): string[] => {
        if (!wide) return [r.date, mark(r), amount(r.amount), r.description];
        running = sumValues([running, r.amount.value]);
        const after = amount({ value: running, commodity: v.commodity });
        return [r.date, mark(r), amount(r.amount), after, r.description];
      };
      const lines = [
        figure("opening", v.opening),
        ...period.map(posting),
        figure("closing", v.closing),
        ...(v.asserted ? [["asserted", "", amount(v.asserted)]] : []),
        ...(v.difference ? [["difference", "", amount(v.difference)]] : []),
      ];
      const rest = uncleared.length === 0 ? "" : `\nuncleared\n${postingTable(hueke, uncleared)}`;
      return `${head}${table(lines, wide ? [2, 3] : [2])}${rest}`;
    });
    io.stdout(text.join("\n"));
    return 0;
  },
};
