// docs/core/query.md
import { describe, expect, expectTypeOf, it } from "vitest";
import { balance, query, register } from "../../srcs/index.js";
import type { AccountTreeRow, GroupKey } from "../../srcs/index.js";
import { balanceOf, codes, descriptions, ledger, rows } from "./ledger.js";

/** Every account tree row, subtotals included, as "account [subtotal] value commodity". */
const allRows = (tree: readonly AccountTreeRow[]): string[] =>
  tree.flatMap((r) =>
    r.amounts.map(
      (a) => `${r.account}${r.subtotal ? " (subtotal)" : ""} ${a.value} ${a.commodity}`,
    ),
  );

describe("opening balances and a transaction without postings", () => {
  const h = ledger(`
2026-01-01 * "Opening"
    Bank:Checking      80000 NTD
    Assets:Cash         5000 NTD
    Equity:Opening    -85000 NTD

2026-10-12 "Confirmed with NAT: 800 owed" @NAT
`);
  it("checks out", () => {
    expect(codes(h)).toEqual([]);
  });
  it("balances every account, with subtotals before their own rows", () => {
    expect(allRows(balance(h, query(h).until("2026-01-01")))).toEqual([
      "Assets (subtotal) 5000 NTD",
      "Assets:Cash 5000 NTD",
      "Bank (subtotal) 80000 NTD",
      "Bank:Checking 80000 NTD",
      "Equity (subtotal) -85000 NTD",
      "Equity:Opening -85000 NTD",
    ]);
    expect(balanceOf(h, "Equity:Opening", "2026-01-01")).toBe("-85000");
  });
  it("finds the transaction without postings on its own time", () => {
    const found = [...query(h).axis("txn-effective").within("2026-10-12")];
    expect(found.map((t) => [t.description, t.postings.length])).toEqual([
      ["Confirmed with NAT: 800 owed", 0],
    ]);
  });
  it("matches the empty posting on the transaction's values", () => {
    expect(descriptions(query(h).entities("NAT"))).toEqual(["Confirmed with NAT: 800 owed"]);
    expect(descriptions(query(h).within("2026-10-12"))).toEqual(["Confirmed with NAT: 800 owed"]);
    expect(descriptions(query(h).status("none").within("2026-10"))).toEqual([
      "Confirmed with NAT: 800 owed",
    ]);
  });
  it("never matches the empty posting with an accounts clause", () => {
    expect([...query(h).entities("NAT").accounts("Assets:Cash")]).toEqual([]);
    expect([...query(h).accounts("Assets", "Bank", "Equity").within("2026-10-12")]).toEqual([]);
  });
  it("leaves the empty posting out of postings, groups and balance", () => {
    expect(query(h).entities("NAT").postings()).toEqual([]);
    expect(query(h).entities("NAT").groupBy("entity").count()).toEqual([]);
    expect(balance(h, query(h).entities("NAT"))).toEqual([]);
  });
  it("has no rows before the first record", () => {
    expect(balance(h, query(h).accounts("Assets:Cash").until("2025-12-31"))).toEqual([]);
  });
});

describe("a balance on a date", () => {
  const h = ledger(`
2026-11-01 * "Opening"
    Bank:Checking      50000 NTD
    Equity:Opening    -50000 NTD

2026-11-20 ! "Book to buy"
    Expenses:Other     1000 NTD
    Bank:Checking     -1000 NTD

2026-11-30=2026-12 * "Prepaid December rent"
    Expenses:Housing     15000 NTD
    Bank:Checking       -15000 NTD [2026-12-02]
`);
  it("counts occurred postings by their effective time", () => {
    expect(codes(h)).toEqual([]);
    expect(balanceOf(h, "Bank:Checking", "2026-11-30")).toBe("50000");
    expect(balanceOf(h, "Bank:Checking", "2026-12-02")).toBe("35000");
  });
  it("lists planned ones only when asked", () => {
    const planned = balance(
      h,
      query(h).accounts("Bank:Checking").until("2026-11-30").occurrence("planned"),
    );
    expect(rows(planned)).toEqual(["Bank:Checking -1000 NTD"]);
  });
  it("counts a record on the accounting axis only once its period has ended", () => {
    const expenses = (at: string) =>
      rows(balance(h, query(h).axis("accounting").accounts("Expenses").until(at)));
    expect(expenses("2026-12-30")).toEqual([]);
    expect(expenses("2026-12-31")).toEqual(["Expenses:Housing 15000 NTD"]);
  });
});

describe("data for a calendar view", () => {
  const h = ledger(`
2026-10-12T12:30 * "Lunch"
    Expenses:Food              180 NTD
    Liabilities:CreditCard    -180 NTD [2026-10-14]

2026-10-12 * "Supermarket"
    Expenses:Groceries     600 NTD
    Assets:Cash           -600 NTD

2026-10-10=2026-10-10..2026-10-13 * "Trip lodging"
    Expenses:Lodging     8000 NTD
    Bank:Checking       -8000 NTD

2026-09-28=2026-09-28..2026-10-03 * "Workshop"
    Expenses:Education     3000 NTD
    Bank:Checking         -3000 NTD

2026-10-01=2026-10 * "October building fee"
    Expenses:Housing     2000 NTD
    Bank:Checking       -2000 NTD
`);
  const q = () => query(h).axis("accounting");

  it("returns full time values, each sorted at its end", () => {
    expect(codes(h)).toEqual([]);
    const found = [...q().overlaps("2026-10")];
    expect(
      found.map((t) => [
        t.description,
        t.accounting.precision,
        t.accounting.localDate,
        t.accounting.localEnd,
      ]),
    ).toEqual([
      ["Workshop", "day", "2026-09-28", "2026-10-03"],
      ["Lunch", "time", "2026-10-12", "2026-10-12"],
      ["Supermarket", "day", "2026-10-12", "2026-10-12"],
      ["Trip lodging", "day", "2026-10-10", "2026-10-13"],
      ["October building fee", "month", "2026-10-01", "2026-10-31"],
    ]);
  });
  it("applies the four predicates", () => {
    expect(descriptions(q().within("2026-10"))).toEqual([
      "Lunch",
      "Supermarket",
      "Trip lodging",
      "October building fee",
    ]);
    expect(descriptions(q().overlaps("2026-10-12"))).toEqual([
      "Lunch",
      "Supermarket",
      "Trip lodging",
      "October building fee",
    ]);
    expect(descriptions(q().covers("2026-10-12"))).toEqual([
      "Supermarket",
      "Trip lodging",
      "October building fee",
    ]);
    expect(descriptions(q().covers("2026-10"))).toEqual(["October building fee"]);
    expect(descriptions(q().overlaps("2026-10-14"))).toEqual(["October building fee"]);
  });
  it("counts a record until its period has ended", () => {
    expect(allRows(balance(h, q().accounts("Expenses").until("2026-10-12")))).toEqual([
      "Expenses (subtotal) 3780 NTD",
      "Expenses:Education 3000 NTD",
      "Expenses:Food 180 NTD",
      "Expenses:Groceries 600 NTD",
    ]);
    expect(descriptions(q().until("2026-10-13"))).toEqual([
      "Workshop",
      "Lunch",
      "Supermarket",
      "Trip lodging",
    ]);
  });
  it("counts by day", () => {
    const groups = q().overlaps("2026-10").groupBy("day").count();
    const counts = new Map(groups.map((g) => [g.key.day, g.value] as const));
    expect(groups).toHaveLength(31);
    expect(groups[0]?.key.day).toBe("2026-10-01");
    expect(groups[30]?.key.day).toBe("2026-10-31");
    expect(counts.get("2026-10-01")).toBe(2);
    expect(counts.get("2026-10-04")).toBe(1);
    expect(counts.get("2026-10-10")).toBe(2);
    expect(counts.get("2026-10-12")).toBe(4);
    expect(counts.get("2026-10-13")).toBe(2);
    expect(counts.get("2026-10-14")).toBe(1);
  });

  describe("without an axis", () => {
    it("filters and orders by effective time", () => {
      expect(descriptions(query(h).overlaps("2026-10-14"))).toEqual(["Lunch"]);
      expect(descriptions(query(h).within("2026-10"))).toEqual([
        "October building fee",
        "Trip lodging",
        "Lunch",
        "Supermarket",
      ]);
    });
    it("checks every clause on one posting", () => {
      expect([...query(h).accounts("Liabilities").within("2026-10-12")]).toEqual([]);
      const card = query(h).accounts("Liabilities").within("2026-10-14");
      expect(descriptions(card)).toEqual(["Lunch"]);
      expect(card.postings().map((p) => p.account)).toEqual(["Liabilities:CreditCard"]);
      expect(
        query(h)
          .within("2026-10-12")
          .postings()
          .map((p) => p.account),
      ).toEqual(["Expenses:Food", "Expenses:Groceries", "Assets:Cash"]);
    });
    it("groups by effective time", () => {
      const counts = query(h)
        .within("2026-10")
        .groupBy("day")
        .count()
        .map((g) => [g.key.day, g.value]);
      expect(counts).toEqual([
        ["2026-10-01", 1],
        ["2026-10-10", 1],
        ["2026-10-12", 2],
        ["2026-10-14", 1],
      ]);
    });
    it("balances by effective time", () => {
      expect(rows(balance(h, query(h).accounts("Liabilities").until("2026-10-13")))).toEqual([]);
      expect(rows(balance(h, query(h).accounts("Liabilities").until("2026-10-14")))).toEqual([
        "Liabilities:CreditCard -180 NTD",
      ]);
      expect(rows(balance(h, query(h).accounts("Bank").within("2026-10")))).toEqual([
        "Bank:Checking -10000 NTD",
      ]);
    });
  });
});

describe("query times", () => {
  const h = ledger(`
2026-10-12 * "Supermarket"
    Expenses:Groceries     600 NTD
    Assets:Cash           -600 NTD
`);
  it("have no time of day", () => {
    expect(() => query(h).within("2026-10-12T09:30")).toThrow(/query\.time-of-day/);
    expect(() => query(h).until("2026-10-12T09:30")).toThrow(/query\.time-of-day/);
    expect(() => query(h).overlaps("2026-10-12..2026-10-13T10:00")).toThrow(/query\.time-of-day/);
    expect(() => query(h).covers("2026-10-12")).not.toThrow();
  });
});

describe("tags written as text", () => {
  const h = ledger(`
2026-10-25 "Card payment" #statement:card/2026-10
    Liabilities:Card     900 NTD
    Bank:Checking       -900 NTD

2026-10-26 "Hotel" #shared:trip:hotel/2026-10
    Expenses:Travel     300 NTD
    Assets:Cash        -300 NTD
`);
  const descriptionsOf = (q: ReturnType<typeof query>) => [...q].map((t) => t.description);

  it("match the same tag as the written anchor, with its module and period", () => {
    expect(descriptionsOf(query(h).tags("statement:card/2026-10"))).toEqual(["Card payment"]);
    expect(descriptionsOf(query(h).tags("#shared:trip:hotel/2026-10"))).toEqual(["Hotel"]);
    expect(descriptionsOf(query(h).tags("shared:trip:hotel"))).toEqual([]);
  });
});

describe("filters with text", () => {
  const h = ledger(`
2026-10-12 "Train" #travel
    Expenses:Travel     300 NTD
    Assets:Cash        -300 NTD

2026-10-13 "Hotel" #trip/2026-10
    Expenses:Travel     900 NTD
    Assets:Cash        -900 NTD
`);
  const descriptionsOf = (q: ReturnType<typeof query>) => [...q].map((t) => t.description);

  it("take a tag with or without #", () => {
    expect(descriptionsOf(query(h).tags("#travel"))).toEqual(["Train"]);
    expect(descriptionsOf(query(h).tags("travel"))).toEqual(["Train"]);
  });
  it("match a tag with a period exactly", () => {
    expect(descriptionsOf(query(h).tags("trip"))).toEqual([]);
    expect(descriptionsOf(query(h).tags("#trip/2026-10"))).toEqual(["Hotel"]);
  });
  it("match nothing for an account the ledger does not have", () => {
    expect([...query(h).accounts("Assets:Nowhere")]).toEqual([]);
    expect(descriptionsOf(query(h).accounts("Assets:Nowhere", "Expenses:Travel"))).toEqual([
      "Train",
      "Hotel",
    ]);
  });
  it("group into one group with an empty key when no key is given", () => {
    const groups = query(h).groupBy().count();
    expect(groups).toEqual([{ key: {}, value: 2 }]);
    expect(query(h).groupBy().sum()).toEqual([
      { key: {}, value: [{ value: "0", commodity: "NTD" }] },
    ]);
  });
});

describe("a posting's values", () => {
  const h = ledger(`
2026-10-12 "Dinner" @BOB ^dinner #trip
    * Expenses:Food     300 NTD @AMY #shared
    Assets:Cash        -300 NTD
`);
  const accounts = (q: ReturnType<typeof query>) => q.postings().map((p) => p.account);

  it("takes references from the posting, else from its transaction", () => {
    expect(codes(h)).toEqual([]);
    expect(accounts(query(h).entities("AMY"))).toEqual(["Expenses:Food"]);
    expect(accounts(query(h).entities("BOB"))).toEqual(["Assets:Cash"]);
    expect([...query(h).entities("BOB").accounts("Expenses")]).toEqual([]);
    expect(
      query(h)
        .groupBy("entity")
        .sum()
        .map((g) => [g.key.entity, g.value.map((a) => a.value)]),
    ).toEqual([
      ["AMY", ["300"]],
      ["BOB", ["-300"]],
    ]);
  });
  it("takes tags from the posting plus its transaction", () => {
    expect(accounts(query(h).tags("shared"))).toEqual(["Expenses:Food"]);
    expect([...query(h).tags("shared").accounts("Assets")]).toEqual([]);
    expect(accounts(query(h).tags("trip"))).toEqual(["Expenses:Food", "Assets:Cash"]);
  });
  it("takes the status from the posting", () => {
    expect(accounts(query(h).status("cleared"))).toEqual(["Expenses:Food"]);
    expect(accounts(query(h).status("none"))).toEqual(["Assets:Cash"]);
    expect([...query(h).status("cleared").accounts("Assets")]).toEqual([]);
  });
  it("matches every posting with transaction-level clauses only", () => {
    expect(accounts(query(h).primaryTag("dinner"))).toEqual(["Expenses:Food", "Assets:Cash"]);
    expect(accounts(query(h).involves("NTD"))).toEqual(["Expenses:Food", "Assets:Cash"]);
  });
});

describe("metadata of a posting", () => {
  const h = ledger(`
2026-10-12 "Dinner"
    ;; receipt: R-0
    Expenses:Food     300 NTD
        ;; receipt: R-1
    Expenses:Drinks   100 NTD
    Assets:Cash      -400 NTD
`);
  it("is the posting's value, else its transaction's", () => {
    expect(codes(h)).toEqual([]);
    const groups = query(h)
      .groupBy("meta:receipt")
      .sum()
      .map((g) => [g.key["meta:receipt"], g.value.map((a) => a.value)]);
    expect(groups).toEqual([
      ["R-0", ["-300"]],
      ["R-1", ["300"]],
    ]);
  });
});

describe("finding NTD–JPY exchanges", () => {
  const h = ledger(
    `
2026-10-01 * "Bought JPY with NTD"
    Assets:Cash      10000 JPY @@ 2200 NTD
    Bank:Checking    -2200 NTD

2026-10-21 * "Withdrew JPY from the NTD account at a Tokyo ATM"
    Assets:Cash      20000 JPY @@ 4500 NTD
    Bank:Checking    -4500 NTD

2026-10-22 * "Ramen"
    Expenses:Food     1200 JPY
    Assets:Cash      -1200 JPY

2026-10-23 * "Card payment in Tokyo"
    Expenses:Food             1200 JPY @@ 260 NTD
    Liabilities:CreditCard    -260 NTD [2026-10-25]

2026-10-25 * "Deposited JPY into the foreign currency account"
    Bank:JPYAccount     5000 JPY
    Assets:Cash        -5000 JPY

2026-10-30 * "Sold JPY for NTD"
    Bank:Checking     1000 NTD @@ 4600 JPY
    Assets:Cash      -4600 JPY
`,
  );
  const exchanges = () => query(h).involves("NTD", "JPY").accounts("Assets", "Bank");

  it("matches transactions with both commodities and an asset posting", () => {
    expect(codes(h)).toEqual([]);
    expect([...exchanges()].map((t) => t.effective.localDate)).toEqual([
      "2026-10-01",
      "2026-10-21",
      "2026-10-30",
    ]);
    expect(exchanges().postings()).toHaveLength(6);
    expect([...query(h).involves("NTD", "JPY")]).toHaveLength(4);
  });
  it("sums what was exchanged", () => {
    expect(rows(balance(h, exchanges().within("2026-10")))).toEqual([
      "Assets:Cash 25400 JPY",
      "Bank:Checking -5700 NTD",
    ]);
    expect(balanceOf(h, "Assets:Cash", "2026-10-31", "JPY")).toBe("19200");
  });
});

describe("ordering", () => {
  it("lists a generated posting after source postings at the same time", () => {
    const h = ledger(`
2026-10-01 * "Opening"
    Bank:Checking      1000 NTD
    Equity:Opening    -1000 NTD

2026-10-25 * "Late transfer"
    Expenses:Other      100 NTD
    Bank:Checking      -100 NTD

2026-10-25 balance Bank:Checking 950 NTD pad -> Expenses:ReconcileDiff
`);
    expect(codes(h)).toEqual([]);
    expect(
      query(h)
        .accounts("Bank:Checking")
        .postings()
        .map((p) => p.amount.value),
    ).toEqual(["1000", "-100", "50"]);
  });
  it("puts an interval before a point at its end", () => {
    const h = ledger(`
2026-10-13T00:00 "Midnight"
    Expenses:Other      1 NTD
    Assets:Cash        -1 NTD

2026-10-12 "Day"
    Expenses:Other      1 NTD
    Assets:Cash        -1 NTD
`);
    expect(descriptions(query(h).within("2026-10"))).toEqual(["Day", "Midnight"]);
  });
  it("puts the shorter interval first when two end together", () => {
    const h = ledger(`
2026-10-01=2026-10 "Month"
    Expenses:Other      1 NTD
    Assets:Cash        -1 NTD

2026-10-31 "Last day"
    Expenses:Other      1 NTD
    Assets:Cash        -1 NTD
`);
    expect(descriptions(query(h).axis("accounting").within("2026-10"))).toEqual([
      "Last day",
      "Month",
    ]);
  });
  it("keeps source order for equal times", () => {
    const h = ledger(`
2026-10-12 "Second written first"
    Expenses:Other      1 NTD
    Assets:Cash        -1 NTD

2026-10-12 "Written second"
    Expenses:Other      1 NTD
    Assets:Cash        -1 NTD
`);
    expect(descriptions(query(h))).toEqual(["Second written first", "Written second"]);
  });
  it("orders postings by their own effective time", () => {
    const h = ledger(`
2026-10-12 "Early purchase, late posting"
    Expenses:Other              1 NTD
    Liabilities:CreditCard     -1 NTD [2026-10-15]

2026-10-13 "Later purchase"
    Expenses:Other              2 NTD
    Liabilities:CreditCard     -2 NTD
`);
    const card = query(h).accounts("Liabilities");
    expect(descriptions(card)).toEqual(["Early purchase, late posting", "Later purchase"]);
    expect(card.postings().map((p) => p.amount.value)).toEqual(["-2", "-1"]);
    expect(
      card
        .axis("accounting")
        .postings()
        .map((p) => p.amount.value),
    ).toEqual(["-1", "-2"]);
  });
});

describe("grouping order", () => {
  const h = ledger(`
2026-10-12 * "Lunch"
    Expenses:b         1 NTD #b
    Expenses:é         1 NTD #é
    Expenses:B         1 NTD #B
    Expenses:a         1 NTD
    Assets:Cash       -4 NTD
`);
  it("compares code points, not locale rules", () => {
    const accounts = query(h)
      .accounts("Expenses")
      .groupBy("account")
      .count()
      .map((g) => g.key.account);
    expect(accounts).toEqual(["Expenses:B", "Expenses:a", "Expenses:b", "Expenses:é"]);
  });
  it("puts the none group first", () => {
    const tags = query(h)
      .accounts("Expenses")
      .groupBy("tag")
      .count()
      .map((g) => g.key.tag);
    expect(tags).toEqual([null, "tag:B", "tag:b", "tag:é"]);
  });
});

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
    expect(allRows(balance(h, query(h).accounts("Expenses")))).toEqual([
      "Expenses (subtotal) 600 NTD",
      "Expenses:Groceries 600 NTD",
    ]);
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
  it("reads within as balance does", () => {
    const h2 = ledger(`
2026-10-10=2026-10-10..2026-10-13 * "Trip lodging"
    Expenses:Lodging     8000 NTD
    Bank:Checking       -8000 NTD
`);
    const q = query(h2).axis("accounting").within("2026-10-12");
    expect([...q]).toEqual([]);
    expect(rows(register(h2, q))).toEqual(["Bank:Checking -8000 NTD", "Expenses:Lodging 8000 NTD"]);
    expect(rows(balance(h2, q))).toEqual(["Bank:Checking -8000 NTD", "Expenses:Lodging 8000 NTD"]);
  });
});
