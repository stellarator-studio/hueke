// docs/core/query.md
import { describe, expect, expectTypeOf, it } from "vitest";
import { balance, query, register } from "../../srcs/index.js";
import type { AccountTreeRow, GroupKey } from "../../srcs/index.js";
import { balanceOf, codes, ledger } from "./ledger.js";

describe("opening balances", () => {
  const h = ledger(`
2026-01-01 * "Opening"
    Bank:Checking      80000 NTD
    Assets:Cash         5000 NTD
    Equity:Opening    -85000 NTD
`);
  it("checks out", () => {
    expect(codes(h)).toEqual([]);
  });
  it("balances", () => {
    expect(balanceOf(h, "Equity:Opening", "2026-01-01")).toBe("-85000");
    expect(balanceOf(h, "Assets:Cash", "2026-01-01")).toBe("5000");
  });
});

describe("a transaction without postings", () => {
  const h = ledger(`2026-10-12 "Confirmed with NAT: 800 owed" @NAT`);
  it("is found on the transaction's own time", () => {
    expect(codes(h)).toEqual([]);
    const found = [...query(h).within("2026-10-12")];
    expect(found.map((t) => [t.description, t.postings.length])).toEqual([
      ["Confirmed with NAT: 800 owed", 0],
    ]);
  });
});

const names = (q: Iterable<{ description?: string }>): string[] =>
  [...q].map((t) => t.description ?? "");

describe("times given to the API", () => {
  const h = ledger(`
2026-10-12 * "Lunch"
    Expenses:Food     180 NTD
    Assets:Cash      -180 NTD
`);
  it.each([
    ["2026-13", "parse.invalid-time"],
    ["2026-02-30", "parse.invalid-time"],
    ["2026-10-12T25:00", "parse.invalid-time"],
    ["2026-10-12[Mars/Base]", "parse.invalid-time"],
    ["2026-W53", "time.nonexistent-week"],
  ])("rejects %s", (text, code) => {
    expect(() => query(h).within(text)).toThrow(code);
    expect(() => query(h).until(text)).toThrow(code);
  });
  it("reads text with the ledger's time zone", () => {
    expect(query(h).until("2026-10-12").postings()).toHaveLength(2);
    expect(query(h).until("2026-10-11").postings()).toHaveLength(0);
  });
});

describe("within", () => {
  const h = ledger(`
2026-10-12T10:00 * "Coffee"
    Expenses:Food     100 NTD
    Assets:Cash      -100 NTD
`);
  it("finds a time of day within its local date", () => {
    expect(names(query(h).within("2026-10-12"))).toEqual(["Coffee"]);
    expect(names(query(h).within("2026-10-11..2026-10-12"))).toEqual(["Coffee"]);
    expect(names(query(h).within("2026-10-13..2026-10-14"))).toEqual([]);
    expect(names(query(h).within("2026-10-11"))).toEqual([]);
  });
  it("rejects a query time with a time of day", () => {
    expect(() => query(h).within("2026-10-12T10:00")).toThrow("query.time-of-day");
    expect(() => query(h).within("2026-10-12T09:00..2026-10-12T11:00")).toThrow(
      "query.time-of-day",
    );
  });
});

describe("ordering and grouping", () => {
  const h = ledger(`
2026-10-12 * "Written first"
    Expenses:b         1 NTD
    Expenses:é         1 NTD
    Assets:Cash       -2 NTD

2026-10-11 * "Earlier"
    Expenses:a         1 NTD
    Assets:Cash       -1 NTD

2026-10-12 * "Written second"
    Expenses:B         1 NTD
    Assets:Cash       -1 NTD
`);
  it("orders transactions at the same time by source position", () => {
    expect(names(query(h))).toEqual(["Earlier", "Written first", "Written second"]);
  });
  it("sorts group keys by code point", () => {
    expect(
      balance(h, query(h).accounts("Expenses"))
        .filter((r) => !r.subtotal)
        .map((r) => r.account),
    ).toEqual(["Expenses:B", "Expenses:a", "Expenses:b", "Expenses:é"]);
  });
});

const allRows = (tree: readonly AccountTreeRow[]): string[] =>
  tree.flatMap((r) =>
    r.amounts.map(
      (a) => `${r.account}${r.subtotal ? " (subtotal)" : ""} ${a.value} ${a.commodity}`,
    ),
  );

describe("the account tree", () => {
  const h = ledger(`
2026-10-01 * "Opening"
    Bank               100 NTD
    Bank:Checking     1000 NTD
    Bank:Savings        50 USD
    Equity:Opening   -1100 NTD
    Equity:Opening     -50 USD

2026-10-12 * "Supermarket"
    Expenses:Groceries     600 NTD
    Bank:Checking         -600 NTD
`);
  it("gives an account with postings of its own and of sub-accounts two rows", () => {
    expect(codes(h)).toEqual([]);
    expect(
      balance(h, query(h).accounts("Bank")).map((r) => [r.account, r.depth, r.subtotal]),
    ).toEqual([
      ["Bank", 1, true],
      ["Bank", 1, false],
      ["Bank:Checking", 2, false],
      ["Bank:Savings", 2, false],
    ]);
    expect(allRows(balance(h, query(h).accounts("Bank")))).toEqual([
      "Bank (subtotal) 500 NTD",
      "Bank (subtotal) 50 USD",
      "Bank 100 NTD",
      "Bank:Checking 400 NTD",
      "Bank:Savings 50 USD",
    ]);
  });
  it("gives a parent no subtotal when no sub-account has postings", () => {
    expect(allRows(balance(h, query(h).accounts("Bank:Checking")))).toEqual([
      "Bank (subtotal) 400 NTD",
      "Bank:Checking 400 NTD",
    ]);
  });
  it("sorts segment by segment, keeping a sub-account right after its parent", () => {
    const g = ledger(`
2026-10-12 * "Moves"
    Assets          1 NTD
    Assets:Cash     2 NTD
    Assets-X        3 NTD
    Equity:Opening
`);
    expect(
      balance(g, query(g).accounts("Assets", "Assets-X")).map((r) =>
        r.subtotal ? `${r.account} (subtotal)` : r.account,
      ),
    ).toEqual(["Assets (subtotal)", "Assets", "Assets:Cash", "Assets-X"]);
  });
  it("is not a grouping key", () => {
    expectTypeOf<"accountTree">().not.toExtend<GroupKey>();
    expect(
      query(h)
        .groupBy("account")
        .sum()
        .map((g) => g.key.account),
    ).toEqual(["Bank", "Bank:Checking", "Bank:Savings", "Equity:Opening", "Expenses:Groceries"]);
  });
});

describe("register", () => {
  const h = ledger(`
2026-10-01 * "Opening"
    Bank:Checking     1000 NTD
    Equity:Opening   -1000 NTD

2026-10-12 * "Supermarket"
    Expenses:Groceries     600 NTD
    Bank:Checking         -600 NTD

2026-10-13 * "Lunch"
    Expenses:Food     180 NTD
    Bank:Checking    -180 NTD
`);
  it("gives the rows of balance, each listing the postings it counts", () => {
    expect(codes(h)).toEqual([]);
    const q = query(h).within("2026-10-12..2026-10-13");
    const tree = register(h, q);
    expect(
      tree.map(({ account, depth, subtotal, amounts }) => ({ account, depth, subtotal, amounts })),
    ).toEqual(balance(h, q));
    expect(tree.map((r) => [r.account, r.subtotal, r.postings.map((p) => p.amount.value)])).toEqual(
      [
        ["Bank", true, []],
        ["Bank:Checking", false, ["-600", "-180"]],
        ["Expenses", true, []],
        ["Expenses:Food", false, ["180"]],
        ["Expenses:Groceries", false, ["600"]],
      ],
    );
  });
  it("covers the whole ledger without a query", () => {
    expect(
      register(h)
        .filter((r) => r.account === "Bank:Checking")
        .map((r) => r.postings.length),
    ).toEqual([3]);
  });
});
