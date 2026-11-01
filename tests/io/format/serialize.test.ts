import { describe, expect, it } from "vitest";
import { Hueke, parse, serialize } from "../../../srcs/index.js";
import type { ItemData } from "../../../srcs/index.js";

const DECLARATIONS = `option timezone UTC
option group-mark '
commodity NTD
    precision 0
    alias NT$ prefix
`;

/** A ledger of the declarations, and the records of `text` parsed on their own. */
function load(text: string, declarations = DECLARATIONS): [Hueke, ItemData[]] {
  const h = new Hueke();
  h.load("main.hueke", parse("main.hueke", declarations));
  h.init("main.hueke");
  return [h, [...parse("x.hueke", text).items]];
}

describe("serialize", () => {
  it("reads only the ledger's settings and commodities", () => {
    const [h, [record]] = load("2026-10-12\n  Expenses:Food  NT$1234567\n  Assets:Cash\n");
    const { settings, commodities } = h;
    expect(record && serialize({ settings, commodities }, record)).toBe(
      "2026-10-12\n    Expenses:Food  1'234'567 NTD\n    Assets:Cash\n",
    );
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
    const [h, [record]] = load(text);
    expect(record && serialize(h, record)).toBe(text);
  });
  it("reads amounts as if an alias in conflict were never declared", () => {
    const [h, [prefixed, code]] = load(
      "2026-10-12\n  Expenses:Food  NT$1\n2026-10-12\n  Expenses:Food  1 NTD\n",
      `${DECLARATIONS}commodity TWD\n    alias NT$ prefix\n    alias NTD suffix\n`,
    );
    expect(prefixed).toBeDefined();
    expect(() => prefixed && serialize(h, prefixed)).toThrow('"NT$1"');
    expect(code && serialize(h, code)).toBe("2026-10-12\n    Expenses:Food  1 NTD\n");
  });
});
