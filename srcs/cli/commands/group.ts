// `hueke group`: an anchor's record, then the members of the group of a tag or a primary tag
// (docs/core/anchors.md, "Groups").

import { query, type Hueke, type Query } from "../../index.js";
import { UsageError, type CliIO } from "../io.js";
import { csv, table } from "../output.js";
import type { Command, Options } from "./command.js";

/** One line of the output. */
type Line = [role: string, date: string, kind: string, id: string, description: string];

export const groupCommand: Command = {
  usage: "group <#scope:anchor | ^anchor> --file <path> [--strict] [--format table|csv]",
  options: [],
  run(hueke: Hueke, args: readonly string[], options: Options, io: CliIO): number {
    const [written, ...extra] = args;
    if (written === undefined || extra.length > 0)
      throw new UsageError("group takes exactly one tag or primary tag");
    let anchor: string;
    let members: Query;
    if (written.startsWith("^")) {
      anchor = written.slice(1);
      members = query(hueke).primaryTag(anchor);
    } else if (written.startsWith("#")) {
      const colon = written.indexOf(":");
      if (colon < 0)
        throw new UsageError(`${written} has no scope: write #tag:${written.slice(1)}`);
      // A tag of a shared module names its anchor last.
      anchor = written.slice(written.lastIndexOf(":") + 1);
      members = query(hueke).tags(written);
    } else
      throw new UsageError(`${written} is not a tag (#scope:anchor) or a primary tag (^anchor)`);

    const lines: Line[] = [];
    const record = anchorRecord(hueke, anchor);
    if (record) lines.push(record);
    for (const t of members)
      if (!(record?.[2] === "transaction" && record[3] === t.id))
        lines.push(["member", t.effective.literal, "transaction", t.id, t.description ?? ""]);
    io.stdout(
      options.format === "csv"
        ? csv(["role", "date", "kind", "id", "description"], lines)
        : table(lines),
    );
    return 0;
  },
};

/** The record that defines the anchor: occurred first, then planned or cancelled, then accounts. */
function anchorRecord(hueke: Hueke, anchor: string): Line | undefined {
  for (const q of [query(hueke).ids(anchor), query(hueke).ids(anchor).occurrence()]) {
    const [posting] = q.postings();
    if (posting?.id === anchor) {
      const t = hueke.transactions.find((x) => x.id === posting.transaction);
      return ["anchor", posting.effective.literal, "posting", anchor, t?.description ?? ""];
    }
    const [t] = q;
    if (t?.id === anchor)
      return ["anchor", t.effective.literal, "transaction", anchor, t.description ?? ""];
  }
  const account = hueke.accounts.find((a) => a.anchor === anchor);
  return account && ["anchor", "", "account", account.id, ""];
}
