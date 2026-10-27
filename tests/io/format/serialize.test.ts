import { describe, expect, it } from "vitest";
import { serialize } from "../../../srcs/io/format/serialize.js";
import { parse } from "../../../srcs/io/parser/parse.js";
import type { Commodity, LedgerSettings } from "../../../srcs/index.js";

const settings: LedgerSettings = {
  timezone: "UTC",
  weekStart: "monday",
  strict: [],
  decimalMark: ".",
  groupMark: "'",
};
const ntd: Commodity = {
  id: "NTD",
  item: false,
  precision: 0,
  precisionWritten: true,
  aliases: [{ text: "NT$", position: "prefix" }],
  meta: {},
};

describe("serialize", () => {
  it("reads only the ledger's settings and commodities", () => {
    const [record] = parse(
      "x.hueke",
      "2026-10-12\n  Expenses:Food  NT$1234567\n  Assets:Cash\n",
    ).items;
    expect(record && serialize({ settings, commodities: [ntd] }, record)).toBe(
      "2026-10-12\n    Expenses:Food  1'234'567 NTD\n    Assets:Cash\n",
    );
  });
  it("writes tags as read", () => {
    const text =
      '2026-10-18 "Hotel" #statement:card/2026-10 #shared:trip:hotel #shared:trip:t2/n3\n';
    const [record] = parse("x.hueke", text).items;
    expect(record && serialize({ settings, commodities: [ntd] }, record)).toBe(text);
  });
  it("writes multi-line Metadata on continuation lines that read back the same", () => {
    const text =
      '2026-10-12 "Lunch"\n' +
      "    ;; memo: First line\n" +
      "    ;;      indented\n" +
      '    ;;    ""\n' +
      '    ;;    "a ; b"\n' +
      '    ;; summary: ""\n' +
      '    ;;    "  all"\n' +
      "    ;;      indented\n" +
      "    ;; tabs: a\n" +
      "    ;;     b\n" +
      '    ;;    "\tc"\n';
    const [record] = parse("x.hueke", text).items;
    expect(record && serialize({ settings, commodities: [ntd] }, record)).toBe(text);
  });
  it("throws on an alias in conflict", () => {
    const twd: Commodity = { ...ntd, id: "TWD" };
    const [record] = parse("x.hueke", "2026-10-12\n  Expenses:Food  NT$1\n").items;
    expect(() => record && serialize({ settings, commodities: [ntd, twd] }, record)).toThrow(
      "alias NT$ is in conflict",
    );
  });
});
