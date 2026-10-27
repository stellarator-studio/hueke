// `hueke balance`: account balances, as rows of the API's `balance`.

import { balance, type AccountTreeRow, type Hueke } from "../../index.js";
import { UsageError, type CliIO } from "../io.js";
import { amountText, csv, table } from "../output.js";
import { FILTERS, filtered, OCCURRENCE, type Command, type Options } from "./command.js";
import { commodityMap } from "./postings.js";

export const balanceCommand: Command = {
  usage:
    "balance [account...] --file <path> [--at <time>] [--period <time>] [--overlaps <time>]\n" +
    "  [--covers <time>] [--axis <axis>] [--status <status,...>] [--involves <commodity,...>]\n" +
    "  [--planned] [--cancelled] [--depth <n>] [--strict] [--format table|csv]",
  options: [...FILTERS, ...OCCURRENCE, "depth"],
  run(hueke: Hueke, args: readonly string[], options: Options, io: CliIO): number {
    const depth = options.depth === undefined ? undefined : Number(options.depth);
    if (depth !== undefined && !(Number.isInteger(depth) && depth >= 1))
      throw new UsageError(`--depth must be a whole number from 1, not "${String(options.depth)}"`);
    const rows = balance(hueke, filtered(hueke, args, options)).filter(
      (r) => depth === undefined || r.depth <= depth,
    );
    if (options.format === "csv") {
      io.stdout(
        csv(
          ["account", "subtotal", "depth", "value", "commodity"],
          rows.flatMap((r) =>
            r.amounts.map((a) => [
              r.account,
              String(r.subtotal),
              String(r.depth),
              a.value,
              a.commodity,
            ]),
          ),
        ),
      );
      return 0;
    }
    io.stdout(table(treeLines(hueke, rows).flat(), [0]));
    return 0;
  },
};

/** Per row: one line per commodity, the first labelled with the indented account. */
export function treeLines(hueke: Hueke, rows: readonly AccountTreeRow[]): string[][][] {
  const commodities = commodityMap(hueke);
  const label = (r: AccountTreeRow): string =>
    `${"  ".repeat(r.depth - 1)}${r.account}${r.subtotal ? " (total)" : ""}`;
  return rows.map((r) =>
    r.amounts.map((a, i) => [amountText(a, commodities), i === 0 ? label(r) : ""]),
  );
}
