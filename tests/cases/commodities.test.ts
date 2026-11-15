// docs/core/commodities.md
import { describe, expect, it } from "vitest";
import { balance, check, query } from "../../srcs/index.js";
import { balanceOf, codes, diagnostics, ledger, rows } from "./ledger.js";

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
    expect(codes(h)).toEqual([]);
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
  it("counts Balances and expressions, not prices, costs or filled-in amounts", () => {
    const h = ledger(`
2026-10-12 * "Points bought with miles"
    Assets:Points      (1.5 * 2) POINT @ 1.2345 MILE
    Assets:Miles

2026-10-13 * "A share bought with points"
    Assets:Shares      1 GOLD {0.12345 POINT}
    Assets:Points

2026-10-14 balance Assets:Miles -3.0000 MILE
`);
    expect(codes(h)).toEqual(["balance.mismatch"]);
    // POINT: 1 place from the expression, none from the cost or the filled-in amount.
    expect(h.commodities.find((c) => c.id === "POINT")?.precision).toBe(1);
    // MILE: 4 places from the Balance, none from the price or the filled-in amount.
    expect(h.commodities.find((c) => c.id === "MILE")?.precision).toBe(4);
  });
});

describe("commodity declarations", () => {
  it("keeps the metadata", () => {
    const h = ledger("commodity MILE\n    ;; source: airline\n");
    expect(codes(h)).toEqual([]);
    expect(h.commodities.find((c) => c.id === "MILE")?.meta).toEqual({ source: "airline" });
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
    expect(h.commodities.find((c) => c.id === "MILE")).not.toHaveProperty("span");
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
    expect(h.commodities.find((c) => c.id === "camera-01")).toMatchObject({
      item: true,
      precision: 0,
    });
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
    const [d] = diagnostics(h, "item.invalid-balance");
    expect(d?.message).toContain("Assets:Equipment");
    expect(d?.message).toContain("2026-12-02");
  });
  it("checks item balances in effective-time order, once per account and item", () => {
    const h = ledger(`${SELL}${BUY}
2026-12-02 * "Sold twice more"
    Bank:Checking            50000 NTD
    Assets:Equipment            -1 camera-01 {30000 NTD}
    Assets:Equipment            -1 camera-01 {30000 NTD}
    Expenses:DisposalLoss    10000 NTD

2026-12-03 * "And once more"
    Bank:Checking            25000 NTD
    Assets:Equipment            -1 camera-01 {30000 NTD}
    Expenses:DisposalLoss     5000 NTD
`);
    expect(codes(h)).toEqual(["item.invalid-balance"]);
    expect(diagnostics(h, "item.invalid-balance")[0]?.message).toContain("2026-12-02");
  });
  it("checks whole numbers on postings, not on Balances", () => {
    // Within the tolerance of precision 0, so the Balance passes; its fraction is not reported.
    const h = ledger(`${BUY}\n2026-10-13 balance Assets:Equipment 1.4 camera-01\n`);
    expect(codes(h)).toEqual([]);
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
  it("aliases, a wrong side and a conflict", () => {
    const text = `${ALIASES}commodity TWD\n    alias dollars suffix\n${ALIASED}`;
    const h = ledger(text);
    expect(codes(h)).toEqual([
      "commodity.alias-conflict",
      "parse.invalid-number",
      "txn.unbalanced",
    ]);
    const [conflict] = diagnostics(h, "commodity.alias-conflict");
    expect(conflict?.severity).toBe("warning");
    expect(conflict?.message).toContain("TWD");
    const twd = h.data
      .get("main.hueke")
      ?.items.find((i) => i.kind === "commodity" && i.args[0] === "TWD");
    expect(twd?.span).toBeDefined();
    expect(conflict?.span?.start).toBe(twd?.span?.start);
    // The record loads, with -180dollars read in the commodity dollars.
    expect(h.transactions.map((t) => t.description)).toEqual(["Lunch"]);
    expect(balanceOf(h, "Assets:Cash", "2026-10-12", "dollars")).toBe("-180");
    expect(balanceOf(h, "Expenses:Food", "2026-10-12")).toBe("180");
    const aliases = (id: string) =>
      h.commodities.find((c) => c.id === id)?.aliases.map((a) => a.text);
    expect(aliases("NTD")).toEqual(["NT$", "dollars"]);
    expect(aliases("TWD")).toEqual(["dollars"]);
  });
  it("a conflicting alias's text is a commodity of its own in strict mode", () => {
    const h = ledger(
      `option strict commodity\n${ALIASES}commodity TWD\n    alias dollars suffix\n${ALIASED}`,
    );
    const undeclared = diagnostics(h, "strict.undeclared").map((d) => d.message);
    expect(undeclared).toHaveLength(1);
    expect(undeclared[0]).toContain("dollars");
  });
  it("an alias equal to a declared code is a conflict, and the code is read as the code", () => {
    const h = ledger(
      `commodity TWD\n    alias NTD suffix\n\n2026-10-12 * "Lunch"\n    Expenses:Food  180 NTD\n    Assets:Cash\n`,
    );
    expect(codes(h)).toEqual(["commodity.alias-conflict"]);
    expect(diagnostics(h, "commodity.alias-conflict")[0]?.severity).toBe("warning");
    expect(balanceOf(h, "Expenses:Food", "2026-10-12")).toBe("180");
    expect(balanceOf(h, "Expenses:Food", "2026-10-12", "TWD")).toBe("0");
  });
  it("an alias equal to its own commodity's code is a conflict", () => {
    const h = ledger("commodity TWD\n    alias TWD suffix\n");
    expect(codes(h)).toEqual(["commodity.alias-conflict"]);
  });
  it("an alias equal to a code that is only used is not a conflict", () => {
    const h = ledger(`
commodity TWD
    alias KRW suffix

2026-10-12 * "Lunch"
    Expenses:Food  180 KRW
    Assets:Cash
`);
    expect(codes(h, true)).toEqual([]);
    expect(balanceOf(h, "Expenses:Food", "2026-10-12", "TWD")).toBe("180");
  });
  it("without the conflict", () => {
    const h = ledger(`${ALIASES}${ALIASED}`);
    expect(codes(h)).toEqual(["parse.invalid-number"]);
    expect(balanceOf(h, "Expenses:Food", "2026-10-12")).toBe("180");
    expect(balanceOf(h, "Assets:Cash", "2026-10-12")).toBe("-180");
  });
});

describe("commodity hierarchy", () => {
  const EXAMPLE = `
commodity TWSE
    display-name Taiwan Stock Exchange
    precision 0
    format {amount} shares ({leaf})
commodity TWSE:0050
    display-name Yuanta Taiwan 50
commodity CELSIUS
    format "{amount} degrees Celsius"

2026-11-03 * "Buy"
    Assets:Broker      1000 TWSE:0050 @ 190 NTD
    Bank:Checking   -190000 NTD

2026-11-04 * "Buy"
    Assets:Broker      2000 TWSE:00878 @ 22 NTD
    Bank:Checking    -44000 NTD
`;
  const commodity = (h: ReturnType<typeof ledger>, id: string) =>
    h.commodities.find((c) => c.id === id);

  it("a declared commodity under another takes its precision and format, not its name", () => {
    const h = ledger(EXAMPLE);
    expect(codes(h, true)).toEqual(["name.inferred-commodity"]);
    expect(diagnostics(h, "name.inferred-commodity")[0]?.message).toContain("TWSE:00878");
    const c = commodity(h, "TWSE:0050");
    expect(c).toMatchObject({
      parent: "TWSE",
      item: false,
      precision: 0,
      precisionWritten: true,
      format: "{amount} shares ({leaf})",
      displayName: "Yuanta Taiwan 50",
    });
    expect(c?.span).toBeDefined();
  });
  it("an undeclared commodity under a declared one inherits too", () => {
    const c = commodity(ledger(EXAMPLE), "TWSE:00878");
    expect(c).toMatchObject({
      parent: "TWSE",
      precision: 0,
      precisionWritten: true,
      format: "{amount} shares ({leaf})",
    });
    expect(c).not.toHaveProperty("displayName");
    expect(c).not.toHaveProperty("span");
  });
  it("a commodity of one segment has no parent, and without a format has none", () => {
    const h = ledger(EXAMPLE);
    const ntd = commodity(h, "NTD");
    expect(ntd).toMatchObject({ precision: 0, precisionWritten: true });
    expect(ntd).not.toHaveProperty("parent");
    expect(ntd).not.toHaveProperty("format");
    expect(ntd).not.toHaveProperty("displayName");
    expect(commodity(h, "TWSE")).not.toHaveProperty("parent");
    expect(commodity(h, "TWSE")?.displayName).toBe("Taiwan Stock Exchange");
  });
  it("reads a quoted format without its quotes", () => {
    expect(commodity(ledger(EXAMPLE), "CELSIUS")?.format).toBe("{amount} degrees Celsius");
  });
  it("the parent is the code without its last segment, and need not be declared or used", () => {
    const h = ledger(`
2026-11-03 * "Buy"
    Assets:Broker      5 FUND:A:B @ 10 NTD
    Bank:Checking    -50 NTD
`);
    expect(commodity(h, "FUND:A:B")?.parent).toBe("FUND:A");
    expect(commodity(h, "FUND:A")).toBeUndefined();
    expect(commodity(h, "FUND")).toBeUndefined();
  });
  it("skips a commodity above that is not declared", () => {
    const h = ledger(`
commodity FUND
    precision 2
    format {code}: {amount}
commodity FUND:A:B

2026-11-03 * "Buy"
    Assets:Broker      5 FUND:A:B @ 10 NTD
    Assets:Broker      1 FUND:A @ 10 NTD
    Bank:Checking    -60 NTD
`);
    expect(codes(h)).toEqual([]);
    expect(commodity(h, "FUND:A:B")).toMatchObject({
      parent: "FUND:A",
      precision: 2,
      precisionWritten: true,
      format: "{code}: {amount}",
    });
    expect(commodity(h, "FUND:A")).toMatchObject({ precision: 2, precisionWritten: true });
  });
  it("takes each setting from the nearest declared commodity that has it", () => {
    const h = ledger(`
commodity FUND
    precision 2
    format {amount} units of {code}
commodity FUND:A
    precision 4
commodity FUND:A:B
commodity FUND:A:C
    precision 1
    format {code} {amount}
`);
    expect(codes(h)).toEqual([]);
    expect(commodity(h, "FUND:A")).toMatchObject({
      precision: 4,
      format: "{amount} units of {code}",
    });
    expect(commodity(h, "FUND:A:B")).toMatchObject({
      precision: 4,
      precisionWritten: true,
      format: "{amount} units of {code}",
    });
    expect(commodity(h, "FUND:A:C")).toMatchObject({ precision: 1, format: "{code} {amount}" });
  });
  it("does not pass on display names, aliases or metadata", () => {
    const h = ledger(`
commodity FUND
    display-name Funds
    precision 2
    alias fu suffix
    ;; issuer: bank
commodity FUND:A
`);
    expect(codes(h)).toEqual([]);
    const a = commodity(h, "FUND:A");
    expect(a).toMatchObject({ precision: 2, aliases: [], meta: {} });
    expect(a).not.toHaveProperty("displayName");
  });
  it("an inherited precision makes more decimal places posting.excess-precision", () => {
    const h = ledger(`
commodity TWSE
    precision 0

2026-11-03 * "Buy"
    Assets:Broker      1.5 TWSE:0050 @ 190 NTD
    Bank:Checking     -285 NTD
`);
    expect(codes(h)).toEqual(["posting.excess-precision"]);
    expect(commodity(h, "TWSE:0050")).toMatchObject({ precision: 0, precisionWritten: true });
  });
  it("never passes on an inferred precision", () => {
    const h = ledger(`
commodity MILE

2026-11-03 * "Miles"
    Assets:Miles       1.25 MILE
    Assets:Miles       1 MILE:gold
    Income:Rewards    -1.25 MILE
    Income:Rewards    -1 MILE:gold

2026-11-04 * "Points"
    Assets:Points      1.5 POINT
    Assets:Points      1 POINT:x
    Income:Rewards    -1.5 POINT
    Income:Rewards    -1 POINT:x
`);
    expect(codes(h)).toEqual([]);
    expect(commodity(h, "MILE")).toMatchObject({ precision: 2, precisionWritten: false });
    expect(commodity(h, "MILE:gold")).toMatchObject({ precision: 0, precisionWritten: false });
    expect(commodity(h, "POINT")).toMatchObject({ precision: 1, precisionWritten: false });
    expect(commodity(h, "POINT:x")).toMatchObject({ precision: 0, precisionWritten: false });
  });
  it("a commodity under an item commodity is an item", () => {
    const h = ledger(`
commodity CAM
    item
commodity CAM:a7

2026-11-03 * "Bought half a camera"
    Assets:Equipment       0.5 CAM:a7 @@ 15000 NTD
    Bank:Checking       -15000 NTD

2026-11-04 * "Bought half a lens"
    Assets:Equipment       0.5 CAM:lens:x @@ 5000 NTD
    Bank:Checking        -5000 NTD
`);
    expect(codes(h)).toEqual(["item.fractional", "item.fractional"]);
    for (const id of ["CAM:a7", "CAM:lens:x"])
      expect(commodity(h, id)).toMatchObject({ item: true, precision: 0, precisionWritten: true });
  });
  it("a precision written under an item commodity is commodity.item-precision", () => {
    const h = ledger(`
commodity CAM
    item
commodity CAM:a7
    precision 2
`);
    expect(codes(h)).toEqual(["commodity.item-precision"]);
    const [d] = diagnostics(h, "commodity.item-precision");
    expect(d?.severity).toBe("warning");
    expect(d?.message).toContain("CAM:a7");
    const decl = h.data
      .get("main.hueke")
      ?.items.find((i) => i.kind === "commodity" && i.args[0] === "CAM:a7");
    expect(d?.span?.start).toBe(decl?.span?.start);
    expect(commodity(h, "CAM:a7")).toMatchObject({
      item: true,
      precision: 0,
      precisionWritten: true,
    });
  });
  it("reports commodity.item-precision in the order the declarations are written", () => {
    const h = ledger(`
commodity CAM
    item
commodity CAM:a:b
    precision 2
commodity CAM:a
    precision 1
`);
    expect(codes(h)).toEqual(["commodity.item-precision", "commodity.item-precision"]);
    const messages = diagnostics(h, "commodity.item-precision").map((d) => d.message);
    expect(messages[0]).toContain("CAM:a:b");
    expect(messages[1]).toContain("CAM:a");
    expect(messages[1]).not.toContain("CAM:a:b");
  });
  it("an undeclared commodity under an item commodity cannot go negative", () => {
    const h = ledger(`
commodity CAM
    item

2026-11-03 * "Sold a lens never bought"
    Bank:Checking       5000 NTD
    Assets:Equipment      -1 CAM:lens @@ 5000 NTD
`);
    expect(codes(h)).toEqual(["item.invalid-balance"]);
    const [d] = diagnostics(h, "item.invalid-balance");
    expect(d?.message).toContain("Assets:Equipment");
    expect(d?.message).toContain("2026-11-03");
  });
  // An alias has no digits (docs/dsl/lexical.md, "Identifiers"), so the code here has none.
  it("a code under a declared commodity may be another commodity's alias", () => {
    const h = ledger(`
commodity TWSE
    precision 0
commodity Y
    alias TWSE:etf suffix

2026-11-03 * "Buy"
    Assets:Broker   10 TWSE:etf
    Equity:Opening
`);
    expect(codes(h, true)).toEqual([]);
    expect(balanceOf(h, "Assets:Broker", "2026-11-03", "Y")).toBe("10");
    expect(h.commodities.find((c) => c.id === "TWSE:etf")).toBeUndefined();
  });
  it("declaring that code makes the alias a conflict", () => {
    const h = ledger(`
commodity TWSE
    precision 0
commodity TWSE:etf
commodity Y
    alias TWSE:etf suffix

2026-11-03 * "Buy"
    Assets:Broker   10 TWSE:etf
    Equity:Opening
`);
    expect(codes(h)).toEqual(["commodity.alias-conflict"]);
    expect(diagnostics(h, "commodity.alias-conflict")[0]?.message).toContain("Y");
    expect(balanceOf(h, "Assets:Broker", "2026-11-03", "TWSE:etf")).toBe("10");
    expect(balanceOf(h, "Assets:Broker", "2026-11-03", "Y")).toBe("0");
  });
  it("keeps the commodities under one code apart", () => {
    const h = ledger(`
commodity TWSE
    precision 0

2026-11-03 * "Buy"
    Assets:Broker      1000 TWSE:0050 @ 190 NTD
    Assets:Broker        10 TWSE @ 1 NTD
    Bank:Checking   -190010 NTD
`);
    expect(codes(h)).toEqual([]);
    expect(rows(balance(h, query(h).accounts("Assets:Broker").until("2026-11-03")))).toEqual([
      "Assets:Broker 10 TWSE",
      "Assets:Broker 1000 TWSE:0050",
    ]);
  });
  it("in strict mode, declaring a commodity above is not enough", () => {
    const h = ledger(`
option strict commodity
commodity TWSE
    precision 0

2026-11-03 * "Buy"
    Assets:Broker      1000 TWSE:0050 @ 190 NTD
    Bank:Checking   -190000 NTD
`);
    const undeclared = diagnostics(h, "strict.undeclared").map((d) => d.message);
    expect(undeclared).toHaveLength(1);
    expect(undeclared[0]).toContain("TWSE:0050");
  });
});

describe("formats", () => {
  it.each([
    ["{amount} {amount}", "{amount} is written twice"],
    ["{qty} shares", "{qty} is not a placeholder"],
    ["shares", "there is no {amount}"],
  ])("format %s is parse.syntax: %s, and the declaration is not loaded", (template) => {
    const h = ledger(`commodity TWSE\n    precision 0\n    format ${template}\n`);
    expect(codes(h)).toEqual(["parse.syntax"]);
    expect(h.commodities.find((c) => c.id === "TWSE")).toBeUndefined();
  });
});
