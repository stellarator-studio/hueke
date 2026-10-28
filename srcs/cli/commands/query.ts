// `hueke query`: the matching postings, in query order.

import type { Hueke } from "../../index.js";
import type { CliIO } from "../io.js";
import { csv } from "../output.js";
import { FILTERS, filtered, type Command, type Options } from "./command.js";
import { postingRows, postingTable } from "./postings.js";

export const queryCommand: Command = {
  usage: "query [account...] --file <path> [--at <time>] [--period <time>] [--format table|csv]",
  options: FILTERS,
  run(hueke: Hueke, args: readonly string[], options: Options, io: CliIO): number {
    const rows = postingRows(hueke, filtered(hueke, args, options).postings());
    if (options.format === "csv")
      io.stdout(
        csv(
          ["date", "transaction", "posting", "account", "value", "commodity", "description"],
          rows.map((r) => [
            r.date,
            r.transaction,
            r.posting,
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
