// docs/core/accounts.md
import { describe, expect, it } from "vitest";
import { codes, ledger } from "./ledger.js";

describe("built-in roots", () => {
  it("built-in English roots", () => {
    const h = ledger(
      `2026-10-12 * "Lunch"\n    Expenses:Food  180 NTD\n    Assets:Cash  -180 NTD\n`,
    );
    expect(codes(h, true)).toEqual([]);
    expect(h.accounts.find((a) => a.id === "Expenses:Food")?.type).toBe("expense");
    expect(h.roots.find((r) => r.name === "Expenses")).toEqual({
      name: "Expenses",
      type: "expense",
      builtin: true,
    });
  });
  it("types and parents of built-in, declared and unknown roots", () => {
    const h = ledger(`account-root Bank asset

2026-10-12 * "Lunch"
    Expenses:Food      180 NTD
    Bank:Checking     -180 NTD
    Spending:Other       0 NTD
`);
    expect(h.accounts.map((a) => [a.id, a.type, a.parent])).toEqual([
      ["Expenses:Food", "expense", "Expenses"],
      ["Bank:Checking", "asset", "Bank"],
      ["Spending:Other", undefined, "Spending"],
    ]);
  });
  it("a declaration changes the type of a built-in root", () => {
    const h = ledger(
      `account-root Assets liability\n\n2026-10-12 * "x"\n    Assets:Cash  1 NTD\n    Equity:Opening  -1 NTD\n`,
    );
    expect(h.roots.find((r) => r.name === "Assets")).toEqual({
      name: "Assets",
      type: "liability",
      builtin: false,
    });
    expect(h.accounts.find((a) => a.id === "Assets:Cash")?.type).toBe("liability");
  });
});

describe("accounts used without a declaration", () => {
  it("are created in the order of their first use in the source", () => {
    const h = ledger(`
2026-10-20 * "Written first, later in time"
    Spending:Late     1 NTD
    Assets:Cash      -1 NTD

2026-10-05 * "Written last, earliest"
    Gifts:Earliest     1 NTD
    Assets:Cash       -1 NTD
`);
    expect(h.accounts.map((a) => a.id)).toEqual(["Spending:Late", "Assets:Cash", "Gifts:Earliest"]);
  });
});
