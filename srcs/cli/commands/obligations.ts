// `hueke obligations`: the rows of the API's `obligations`.

import { obligations, type Amount, type Hueke } from "../../index.js";
import { UsageError, type CliIO } from "../io.js";
import { csv, table, valueText } from "../output.js";
import { list, shownName, type Command, type Options } from "./command.js";

export const obligationsCommand: Command = {
  usage:
    "obligations [account...] --file <path> [--at <time>] [--who <entity>] [--all] [--name]\n" +
    "  [--strict] [--format table|csv]",
  options: ["at", "who", "all", "name"],
  run(hueke: Hueke, args: readonly string[], options: Options, io: CliIO): number {
    const who = options.who === undefined ? [] : list(options.who);
    if (who.length > 1) throw new UsageError("obligations takes one entity with --who");
    const [entity] = who;
    const rows = obligations(hueke, {
      ...(args.length > 0 && { accounts: args }),
      ...(entity !== undefined && { entity }),
      ...(options.at !== undefined && { at: options.at }),
      all: options.all === true,
    });
    const name = shownName(hueke, options);
    const csvFormat = options.format === "csv";
    // The commodity has its own column, so values are written without it.
    const value = csvFormat ? (a: Amount): string => a.value : valueText(hueke);
    const lines = rows.map((r) => [
      name.account(r.account),
      r.commodity,
      r.entities.map(name.entity).join(","),
      value(r.original),
      value(r.repaid),
      value(r.remaining),
      csvFormat ? String(r.settled) : r.settled ? "settled" : "open",
      r.lastRepaid?.literal ?? "",
    ]);
    io.stdout(
      csvFormat
        ? csv(
            [
              "account",
              "commodity",
              "entities",
              "original",
              "repaid",
              "remaining",
              "settled",
              "last_repaid",
            ],
            lines,
          )
        : table(lines, [3, 4, 5]),
    );
    return 0;
  },
};
