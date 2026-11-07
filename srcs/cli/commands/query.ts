// `hueke query`: the matching postings, in query order.

import type { Hueke } from "../../index.js";
import type { CliIO } from "../io.js";
import { csv } from "../output.js";
import {
  axisOf,
  FILTERS,
  filtered,
  OCCURRENCE,
  shownName,
  type Command,
  type Options,
} from "./command.js";
import { postingRows, postingTable } from "./postings.js";

export const queryCommand: Command = {
  usage:
    "query [account...] --file <path> [--at <time>] [--period <time>] [--overlaps <time>]\n" +
    "  [--covers <time>] [--axis <axis>] [--status <status,...>] [--involves <commodity,...>]\n" +
    "  [--id <id,...>] [--who <entity,...>] [--tag <tag,...>] [--primary <anchor>]\n" +
    "  [--breakdown <name,...>] [--planned] [--cancelled] [--name] [--strict] [--format table|csv]",
  options: [...FILTERS, ...OCCURRENCE, "name"],
  run(hueke: Hueke, args: readonly string[], options: Options, io: CliIO): number {
    const axis = options.axis === undefined ? "effective" : axisOf(options.axis);
    const rows = postingRows(
      hueke,
      filtered(hueke, args, options).postings(),
      axis,
      shownName(hueke, options).account,
    );
    if (options.format === "csv")
      io.stdout(
        csv(
          [
            "date",
            "transaction",
            "posting",
            "occurrence",
            "status",
            "account",
            "value",
            "commodity",
            "description",
          ],
          rows.map((r) => [
            r.date,
            r.transaction,
            r.posting,
            r.occurrence,
            r.status,
            r.account,
            r.amount.value,
            r.amount.commodity,
            r.description,
          ]),
        ),
      );
    else io.stdout(postingTable(hueke, rows));
    return 0;
  },
};
