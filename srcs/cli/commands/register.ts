// `hueke register`: the rows of the API's `register`, each followed by its postings.

import { register, type Hueke } from "../../index.js";
import { UsageError, type CliIO } from "../io.js";
import { table } from "../output.js";
import { treeLines } from "./balance.js";
import {
  axisOption,
  FILTERS,
  filtered,
  OCCURRENCE,
  shownName,
  type Command,
  type Options,
} from "./command.js";
import { postingRows, postingTable } from "./postings.js";

export const registerCommand: Command = {
  usage:
    "register [account...] --file <path> [--at <time>] [--period <time>] [--overlaps <time>]\n" +
    "  [--covers <time>] [--axis <axis>] [--status <status,...>] [--involves <commodity,...>]\n" +
    "  [--id <id,...>] [--who <entity,...>] [--tag <tag,...>] [--primary <anchor>]\n" +
    "  [--breakdown <name,...>] [--planned] [--cancelled] [--all] [--name] [--strict]",
  options: [...FILTERS, ...OCCURRENCE, "all", "name"],
  run(hueke: Hueke, args: readonly string[], options: Options, io: CliIO): number {
    if (options.format !== "table")
      throw new UsageError(`register has no ${options.format} output`);
    const axis = axisOption(options);
    const name = shownName(hueke, options);
    const rows = register(hueke, filtered(hueke, args, options), { all: options.all === true });
    // The account lines of every row share one alignment; the postings follow their row.
    const lines = table(treeLines(hueke, rows, name.account).flat(), [0]).split("\n");
    let at = 0;
    const out = rows.map((r) => {
      const own = lines
        .slice(at, at + r.amounts.length)
        .map((l) => `${l}\n`)
        .join("");
      at += r.amounts.length;
      return r.postings.length === 0
        ? own
        : own + postingTable(hueke, postingRows(hueke, r.postings, axis, name.account));
    });
    io.stdout(out.join(""));
    return 0;
  },
};
