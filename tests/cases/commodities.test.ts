// docs/core/commodities.md
import { describe, expect, it } from "vitest";
import { balance, check, query } from "../../srcs/index.js";
import { balanceOf, codes, ledger, rows, SHARED } from "./ledger.js";

describe("commodities without precision", () => {
  it("an undeclared commodity", () => {
    const h = ledger(`
2026-10-12 * "Points earned by card"
    Assets:Points      12.5 POINT
    Income:Rewards    -12.5 POINT

2026-10-20 * "Paid with points"
    Expenses:Other     3.25 POINT
    Assets:Points     -3.25 POINT
`);
    expect(codes(h, true)).toEqual(["name.inferred-commodity"]);
    expect(h.commodities.find((c) => c.id === "POINT")).toMatchObject({
      item: false,
      precision: 2,
    });
    expect(balanceOf(h, "Assets:Points", "2026-10-20", "POINT")).toBe("9.25");
  });
  it("a declared commodity without precision", () => {
    const h = ledger(`
commodity MILE

2026-10-12 * "Miles earned"
    Assets:Miles       1.5 MILE
    Income:Rewards    -1.5 MILE

2026-10-20 * "Paid with miles"
    Expenses:Other     0.125 MILE
    Assets:Miles      -0.125 MILE
`);
    expect(codes(h, true)).toEqual([]);
    expect(h.commodities.find((c) => c.id === "MILE")).toMatchObject({ item: false, precision: 3 });
    expect(balanceOf(h, "Assets:Miles", "2026-10-20", "MILE")).toBe("1.375");
  });
  it("counts only records that load", () => {
    const h = ledger(`
2026-10-12 * "Points earned by card"
    Assets:Points      12.5 POINT
    Income:Rewards    -12.5 POINT

2026-10-13 * "Not loaded: two omitted amounts"
    Expenses:Other     0.125 POINT
    Assets:Points
    Assets:Cash

2026-10-14 * "Not loaded: a time skipped by daylight saving time"
    Expenses:Other     0.0001 POINT
    Assets:Points     -0.0001 POINT [2026-03-08T02:30[America/New_York]]
`);
    expect(codes(h)).toEqual(["txn.amount-not-inferable", "time.nonexistent-local-time"]);
    expect(h.commodities.find((c) => c.id === "POINT")?.precision).toBe(1);
  });
});

describe("malformed commodity declarations", () => {
  it("drops the declaration on a bad precision", () => {
    const h = ledger(`
commodity MILE
    precision x

2026-10-12 * "Miles earned"
    Assets:Miles       1.5 MILE
    Income:Rewards    -1.5 MILE
`);
    expect(codes(h, true)).toEqual(["parse.syntax", "name.inferred-commodity"]);
    expect(h.commodities.find((c) => c.id === "MILE")).toMatchObject({
      precision: 1,
      precisionWritten: false,
    });
    expect(h.commodities.find((c) => c.id === "MILE")?.span).toBeUndefined();
  });
  it.each(["alias NT$", "alias NT$ before", "alias NT$ prefix extra"])(
    "drops the declaration on %s",
    (line) => {
      const h = ledger(`commodity TWD\n    precision 0\n    ${line}\n`, { prelude: "" });
      expect(codes(h)).toEqual(["parse.syntax", "option.missing-timezone"]);
      expect(h.commodities.find((c) => c.id === "TWD")).toBeUndefined();
    },
  );
});

describe("items", () => {
  const BUY = `
2026-10-12 * "Bought a camera"
    Assets:Equipment         1 camera-01 @@ 30000 NTD
    Bank:Checking       -30000 NTD
`;
  const SELL = `
2026-12-01 * "Sold the camera"
    Bank:Checking            25000 NTD
    Assets:Equipment            -1 camera-01 {30000 NTD}
    Expenses:DisposalLoss     5000 NTD
`;
  it("buys and sells", () => {
    const h = ledger(BUY + SELL);
    expect(codes(h)).toEqual([]);
    expect(balanceOf(h, "Assets:Equipment", "2026-10-12", "camera-01")).toBe("1");
    expect(balanceOf(h, "Assets:Equipment", "2026-12-01", "camera-01")).toBe("0");
    expect(rows(balance(h, query(h).accounts("Assets:Equipment").until("2026-12-01")))).toEqual([
      "Assets:Equipment 0 camera-01",
    ]);
    expect(balanceOf(h, "Bank:Checking", "2026-12-01")).toBe("-5000");
  });
  it("two of the same item", () => {
    const h = ledger(`${BUY}
2026-10-20 * "Bought another camera of the same model"
    Assets:Equipment         1 camera-01 @@ 30000 NTD
    Bank:Checking       -30000 NTD
`);
    expect(codes(h)).toEqual([]);
    expect(balanceOf(h, "Assets:Equipment", "2026-10-20", "camera-01")).toBe("2");
  });
  it("a negative item balance", () => {
    const h = ledger(`${BUY}${SELL}
2026-12-02 * "Sold the camera, recorded again"
    Bank:Checking            25000 NTD
    Assets:Equipment            -1 camera-01 {30000 NTD}
    Expenses:DisposalLoss     5000 NTD
`);
    expect(codes(h)).toEqual(["item.invalid-balance"]);
    const [d] = check(h).filter((x) => x.code === "item.invalid-balance");
    expect(d?.message).toContain("Assets:Equipment");
    expect(d?.message).toContain("2026-12-02");
  });
  it("a fractional item amount", () => {
    const h = ledger(`
2026-10-12 * "Bought half a camera"
    Assets:Equipment       0.5 camera-01 @@ 15000 NTD
    Bank:Checking       -15000 NTD
`);
    expect(codes(h)).toEqual(["item.fractional"]);
    expect(check(h)[0]?.severity).toBe("error");
    expect(balanceOf(h, "Assets:Equipment", "2026-10-12", "camera-01")).toBe("0.5");
  });
});

describe("aliases", () => {
  const ALIASES = `
commodity NTD
    precision 0
    alias NT$ prefix
    alias dollars suffix
`;
  const ALIASED = `
2026-10-12 * "Lunch"
    Expenses:Food     NT$180
    Assets:Cash    -180dollars

2026-10-13 * "Mistake: prefix alias after the number"
    Expenses:Food     180NT$
    Assets:Cash      -180 NTD
`;
  // The shared declarations already declare NTD, so the case's NTD replaces it.
  const prelude = SHARED.replace("commodity NTD\n    precision 0\n", "");
  it("aliases, a wrong side and a conflict", () => {
    const h = ledger(`${ALIASES}commodity TWD\n    alias dollars suffix\n${ALIASED}`, { prelude });
    expect(codes(h)).toEqual(["commodity.alias-conflict", "parse.invalid-number"]);
    expect(check(h).find((d) => d.code === "commodity.alias-conflict")?.message).toContain("TWD");
    expect(h.transactions).toEqual([]);
  });
  it("without the conflict", () => {
    const h = ledger(`${ALIASES}${ALIASED}`, { prelude });
    expect(codes(h)).toEqual(["parse.invalid-number"]);
    expect(balanceOf(h, "Expenses:Food", "2026-10-12")).toBe("180");
    expect(balanceOf(h, "Assets:Cash", "2026-10-12")).toBe("-180");
  });
});
