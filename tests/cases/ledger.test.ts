// docs/core/ledger.md
import { describe, expect, it } from "vitest";
import { check } from "../../srcs/index.js";
import { balanceOf, codes, ledger } from "./ledger.js";

const LUNCH = `2026-10-12 * "Lunch"\n    Expenses:Food  180 NTD\n    Assets:Cash\n`;

describe("unsupported syntax", () => {
  it.each([
    ["an accounting time", '2026-10-12=2026-11 "x"\n    Expenses:Food  1 NTD\n    Assets:Cash\n'],
    [
      "a posting time",
      '2026-10-12 "x"\n    Expenses:Food  1 NTD\n    Assets:Cash  -1 NTD [2026-10-14]\n',
    ],
    ["balance", "2026-10-12 balance Assets:Cash -180 NTD\n"],
    [
      "split",
      '2026-10-12 "x"\n    Expenses:Food  2 NTD\n        split @NAT @AMY\n    Assets:Cash\n',
    ],
    [
      "paid-by",
      '2026-10-12 "x"\n    Expenses:Food  2 NTD\n        paid-by @NAT\n    Assets:Cash\n',
    ],
    ["a ledger option", "option week-start sunday\n"],
    ["a shared root", "account-root Trip shared\n"],
    ["an item commodity", "commodity camera-01\n    item\n"],
    ["a commodity alias", "commodity TWD\n    alias NT$ prefix\n"],
    ["account", "account Assets:Cash\n"],
    ["entity", "entity NAT\n    type person\n"],
    ["include", "include other.hueke\n"],
  ])("%s is reported and not loaded", (_, text) => {
    const h = ledger(`${text}\n${LUNCH}`);
    expect(codes(h)).toEqual(["syntax.unsupported"]);
    expect(h.transactions).toHaveLength(1);
    expect(balanceOf(h, "Assets:Cash", "2026-10-31")).toBe("-180");
  });
  it("names what is not supported", () => {
    const h = ledger("2026-10-12 balance Assets:Cash 0 NTD\n");
    expect(check(h)[0]?.message).toBe("balance is not supported yet");
  });
});

describe("the loaded ledger", () => {
  it("lists its modules after the root", () => {
    const h = ledger(LUNCH);
    expect(h.root).toBe("main.hueke");
    expect(h.modules).toEqual(["main.hueke"]);
  });
});
