// docs/core/query.md
import { describe, expect, expectTypeOf, it } from "vitest";
import { balance, periodLabel, query, register } from "../../srcs/index.js";
import type { AccountTreeRow, BreakdownLineRow, GroupKey } from "../../srcs/index.js";
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

describe("tags written as text", () => {
  const h = ledger(`
option pad-account Expenses:ReconcileDiff

2026-10-01 * "Opening"
    Bank:Checking      12300 NTD
    Equity:Opening    -12300 NTD

2026-10-25 balance Bank:Checking 12345 NTD pad
`);
  it("match the tag with its scope", () => {
    expect(codes(h)).toEqual([]);
    expect(query(h).tags("#system:balance").postings()).toHaveLength(2);
    expect(query(h).tags("system:balance").postings()).toHaveLength(2);
    expect(descriptions(query(h).tags("tag:balance"))).toEqual([]);
  });
  it("throw when the scope is left out", () => {
    expect(() => query(h).tags("balance")).toThrow(/^query\.tag-without-scope/);
    expect(() => query(h).tags("#balance")).toThrow(/^query\.tag-without-scope/);
  });
});

describe("filters with text", () => {
  const h = ledger(`
2026-10-12 "Train" #travel
    Expenses:Travel     300 NTD
    Assets:Cash        -300 NTD

2026-10-13 "Hotel" #trip
    Expenses:Travel     900 NTD
    Assets:Cash        -900 NTD
`);
  it("take a tag as a tag", () => {
    expect(codes(h)).toEqual([]);
    expect(descriptions(query(h).tags({ ref: { name: "travel" } }))).toEqual(["Train"]);
    expect(descriptions(query(h).tags({ scope: "tag", ref: { name: "trip" } }))).toEqual(["Hotel"]);
  });
  it("match a tag with a period exactly", () => {
    expect(descriptions(query(h).tags("tag:trip/2026-10"))).toEqual([]);
    expect(descriptions(query(h).tags("tag:trip"))).toEqual(["Hotel"]);
  });
  it("match nothing for an account the ledger does not have", () => {
    expect([...query(h).accounts("Assets:Nowhere")]).toEqual([]);
    expect(descriptions(query(h).accounts("Assets:Nowhere", "Expenses:Travel"))).toEqual([
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
    expect(accounts(query(h).tags("tag:shared"))).toEqual(["Expenses:Food"]);
    expect([...query(h).tags("tag:shared").accounts("Assets")]).toEqual([]);
    expect(accounts(query(h).tags("tag:trip"))).toEqual(["Expenses:Food", "Assets:Cash"]);
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

describe("clauses", () => {
  const h = ledger(`
2026-10-05 * "Coffee"
    Expenses:Food       90 NTD
    Assets:Cash        -90 NTD

2026-10-12 # "Cancelled lunch"
    Expenses:Food      180 NTD
    Assets:Cash       -180 NTD

2026-10-20 ! "Planned dinner"
    Expenses:Food      500 NTD
    Assets:Cash       -500 NTD

2026-11-02 * "Groceries"
    Expenses:Groceries  300 NTD
    Bank:Checking      -300 NTD
`);
  it("adds a time clause called again, and replaces any other clause", () => {
    expect(codes(h)).toEqual([]);
    expect(descriptions(query(h).within("2026-10").within("2026-10-01..2026-10-10"))).toEqual([
      "Coffee",
    ]);
    expect(descriptions(query(h).accounts("Expenses:Groceries").accounts("Expenses:Food"))).toEqual(
      ["Coffee"],
    );
  });
  it("lists planned and cancelled transactions for occurrence with no arguments", () => {
    expect(descriptions(query(h).occurrence())).toEqual(["Cancelled lunch", "Planned dinner"]);
    expect(descriptions(query(h).occurrence("cancelled"))).toEqual(["Cancelled lunch"]);
  });
  it("covers the whole ledger in balance without a query", () => {
    expect(rows(balance(h))).toEqual(rows(balance(h, query(h))));
    expect(rows(balance(h))).toContain("Assets:Cash -90 NTD");
  });
  it("adds up to zero over all accounts on the accounting axis", () => {
    const g = ledger(`
2026-11-30=2026-12 * "Prepaid December rent"
    Expenses:Housing     15000 NTD
    Bank:Checking       -15000 NTD [2026-12-02]
`);
    const roots = balance(g, query(g).axis("accounting").within("2026-12")).filter(
      (r) => r.depth === 1,
    );
    expect(roots.flatMap((r) => r.amounts.map((a) => a.value))).toEqual(["-15000", "15000"]);
  });
});

describe("grouping keys", () => {
  const h = ledger(`
2026-09-30 * "Coffee" ^daily
    Expenses:Food       90 NTD
    Assets:Cash        -90 NTD

2026-10-05 * "Ramen" ^trip
    Expenses:Food     1200 JPY
    Assets:Cash      -1200 JPY

2026-12-28 * "Dinner" ^trip
    Expenses:Food      500 NTD
    Assets:Cash       -500 NTD
`);
  const keys = (key: GroupKey) =>
    query(h)
      .accounts("Expenses")
      .groupBy(key)
      .count()
      .map((g) => [g.key[key], g.value]);

  it("groups by commodity and primary tag", () => {
    expect(codes(h)).toEqual([]);
    expect(keys("commodity")).toEqual([
      ["JPY", 1],
      ["NTD", 2],
    ]);
    expect(keys("primaryTag")).toEqual([
      ["daily", 1],
      ["trip", 2],
    ]);
  });
  it("groups by week, month, quarter and year", () => {
    expect(keys("week")).toEqual([
      ["2026-W40", 1],
      ["2026-W41", 1],
      ["2027-W01", 1],
    ]);
    expect(keys("month")).toEqual([
      ["2026-09", 1],
      ["2026-10", 1],
      ["2026-12", 1],
    ]);
    expect(keys("quarter")).toEqual([
      ["2026-Q3", 1],
      ["2026-Q4", 2],
    ]);
    expect(keys("year")).toEqual([["2026", 3]]);
  });
  it("nests several keys, a key given twice counting once", () => {
    const groups = query(h).accounts("Expenses").groupBy("quarter", "commodity", "quarter").count();
    expect(groups.map((g) => [g.key, g.value])).toEqual([
      [{ quarter: "2026-Q3", commodity: "NTD" }, 1],
      [{ quarter: "2026-Q4", commodity: "JPY" }, 1],
      [{ quarter: "2026-Q4", commodity: "NTD" }, 1],
    ]);
  });
});

describe("grouping and aggregation", () => {
  const h = ledger(`
2026-10-05 * "October salary" @acme
    Bank:Checking     50000 NTD
    Income:Salary    -50000 NTD

2026-10-12 "Lunch with NAT" @NAT #food
    ;; place: Xinyi
    Expenses:Food      600 NTD
    Assets:Cash       -600 NTD

2026-10-20 * "Dinner with NAT and KEN" @NAT @KEN #food #friends
    Expenses:Food     1200 NTD
        ;; place: Daan
    Assets:Cash      -1200 NTD

2026-11-02 * "Tokyo snacks" #food
    Expenses:Food     1000 JPY @@ 220 NTD
    Assets:Cash       -220 NTD
`);
  const e = query(h).accounts("Expenses");
  /** Each group as "key values: amounts", "none" for a missing value. */
  const sums = (grouped: ReturnType<typeof e.groupBy>) =>
    grouped.sum().map(
      (g) =>
        `${Object.values(g.key)
          .map((v) => v ?? "none")
          .join(", ")}: ${g.value.map((a) => `${a.value} ${a.commodity}`).join(", ")}`,
    );

  it("sums one group without a key, or one per account or commodity", () => {
    expect(codes(h)).toEqual([]);
    expect(e.groupBy().sum()).toEqual([
      {
        key: {},
        value: [
          { value: "1000", commodity: "JPY" },
          { value: "1800", commodity: "NTD" },
        ],
      },
    ]);
    expect(sums(e.groupBy("account"))).toEqual(["Expenses:Food: 1000 JPY, 1800 NTD"]);
    expect(sums(e.groupBy("commodity"))).toEqual(["JPY: 1000 JPY", "NTD: 1800 NTD"]);
  });
  it("counts a posting with several entities in each of their groups", () => {
    expect(sums(e.groupBy("entity"))).toEqual(["none: 1000 JPY", "KEN: 1200 NTD", "NAT: 1800 NTD"]);
  });
  it("groups by tag and by metadata, the posting's value first", () => {
    expect(sums(e.groupBy("tag"))).toEqual([
      "tag:food: 1000 JPY, 1800 NTD",
      "tag:friends: 1200 NTD",
    ]);
    expect(sums(e.groupBy("meta:place"))).toEqual([
      "none: 1000 JPY",
      "Daan: 1200 NTD",
      "Xinyi: 600 NTD",
    ]);
  });
  it("groups by period", () => {
    expect(sums(e.groupBy("week"))).toEqual([
      "2026-W42: 600 NTD",
      "2026-W43: 1200 NTD",
      "2026-W45: 1000 JPY",
    ]);
    expect(sums(e.groupBy("month"))).toEqual(["2026-10: 1800 NTD", "2026-11: 1000 JPY"]);
    expect(sums(e.groupBy("quarter"))).toEqual(["2026-Q4: 1000 JPY, 1800 NTD"]);
    expect(sums(e.groupBy("year"))).toEqual(["2026: 1000 JPY, 1800 NTD"]);
  });
  it("nests keys, a multi-valued key given twice counting once", () => {
    expect(sums(e.groupBy("month", "commodity"))).toEqual([
      "2026-10, NTD: 1800 NTD",
      "2026-11, JPY: 1000 JPY",
    ]);
    expect(e.groupBy("entity", "entity").sum()).toEqual(e.groupBy("entity").sum());
  });
  it("counts transactions, not postings", () => {
    const counts = query(h)
      .groupBy("entity")
      .count()
      .map((g) => [g.key.entity, g.value]);
    expect(counts).toEqual([
      [null, 1],
      ["KEN", 1],
      ["NAT", 2],
      ["acme", 1],
    ]);
  });
  it("lists no bucket outside the range", () => {
    expect(sums(e.within("2026-10").groupBy("week"))).toEqual([
      "2026-W42: 600 NTD",
      "2026-W43: 1200 NTD",
    ]);
  });
  it("filters by status and by commodities involved", () => {
    expect(descriptions(query(h).status("none"))).toEqual(["Lunch with NAT"]);
    expect(query(h).status("none").postings()).toHaveLength(2);
    expect(descriptions(query(h).status("cleared"))).toEqual([
      "October salary",
      "Dinner with NAT and KEN",
      "Tokyo snacks",
    ]);
    expect(query(h).status("cleared").postings()).toHaveLength(6);
    expect(descriptions(query(h).involves("JPY"))).toEqual(["Tokyo snacks"]);
    expect(descriptions(query(h).involves("JPY", "NTD"))).toEqual(["Tokyo snacks"]);
    expect(descriptions(query(h).involves("JPY", "USD"))).toEqual([]);
    expect(descriptions(query(h).involves("NTD"))).toHaveLength(4);
  });
});

describe("ordering", () => {
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

describe("the ids clause", () => {
  const h = ledger(`
2026-10-11 * %t_dinner "Dinner"
    Expenses:Food     600 NTD  %p_food
    Assets:Cash      -600 NTD

2026-10-12 * "Taxi"
    Expenses:Transport     300 NTD
    Assets:Cash           -300 NTD
`);
  it("is replaced when called again", () => {
    expect(descriptions(query(h).ids("t_dinner").ids("~1"))).toEqual(["Taxi"]);
  });
  it("totals what it matches", () => {
    expect(rows(balance(h, query(h).ids("p_food", "~1")))).toEqual([
      "Assets:Cash -300 NTD",
      "Expenses:Food 600 NTD",
      "Expenses:Transport 300 NTD",
    ]);
  });
});

describe("tags anchored and plain", () => {
  const h = ledger(`
2026-10-18 %trip "Trip"

2026-10-19 * "Hotel" #trip #claim
    Expenses:Lodging     8000 NTD
    Bank:Checking       -8000 NTD

2026-10-20 * "Strap" #category:camera
    Expenses:Equipment     900 NTD
    Assets:Cash           -900 NTD
`);
  it("match either kind", () => {
    expect(codes(h)).toEqual(["tag.unknown-scope"]);
    expect(descriptions(query(h).tags("tag:trip"))).toEqual(["Hotel"]);
    expect(descriptions(query(h).tags("tag:claim"))).toEqual(["Hotel"]);
  });
  it("never match a tag skipped for a scope error", () => {
    expect([...query(h).tags("category:camera")]).toEqual([]);
  });
  it("group by tag the same, anchored or plain", () => {
    expect(
      query(h)
        .accounts("Expenses")
        .groupBy("tag")
        .count()
        .map((g) => [g.key.tag, g.value]),
    ).toEqual([
      [null, 1],
      ["tag:claim", 1],
      ["tag:trip", 1],
    ]);
  });
});

describe("references on obligations", () => {
  const h = ledger(`
account Assets:Receivable
    obligation receivable

2026-10-11 * "Lunch" @starbucks
    Expenses:Food                   600 NTD
    Assets:Receivable:lunch-1011    400 NTD @NAT
    Assets:Cash                   -1000 NTD

2026-10-15 * "Paid back" @KEN
    Bank:Checking                   250 NTD
    Assets:Receivable:lunch-1011   -250 NTD
`);
  it("take the obligation's entities, whatever the posting or its transaction names", () => {
    expect(codes(h)).toEqual([]);
    expect(
      query(h)
        .entities("NAT")
        .postings()
        .map((p) => `${p.account} ${p.amount.value}`),
    ).toEqual(["Assets:Receivable:lunch-1011 400", "Assets:Receivable:lunch-1011 -250"]);
    expect(
      query(h)
        .entities("KEN")
        .postings()
        .map((p) => p.account),
    ).toEqual(["Bank:Checking"]);
  });
  it("group each obligation's postings under its entities", () => {
    expect(
      query(h)
        .accounts("Assets:Receivable")
        .groupBy("entity")
        .sum()
        .map((g) => [g.key.entity, g.value.map((a) => a.value)]),
    ).toEqual([["NAT", ["150"]]]);
  });
});

describe("settled obligations in balance and register", () => {
  const h = ledger(`
account Assets:Receivable
    obligation receivable

2026-10-11 * "Lunch"
    Assets:Receivable:lunch-1011    400 NTD @NAT
    Assets:Cash                    -400 NTD

2026-10-15 * "Paid back"
    Assets:Cash                     400 NTD
    Assets:Receivable:lunch-1011   -400 NTD
`);
  it("are left out unless all is set; subtotal rows stay", () => {
    expect(allRows(balance(h, query(h).accounts("Assets")))).toEqual([
      "Assets (subtotal) 0 NTD",
      "Assets:Cash 0 NTD",
      "Assets:Receivable (subtotal) 0 NTD",
    ]);
    expect(allRows(balance(h, query(h).accounts("Assets"), { all: true }))).toEqual([
      "Assets (subtotal) 0 NTD",
      "Assets:Cash 0 NTD",
      "Assets:Receivable (subtotal) 0 NTD",
      "Assets:Receivable:lunch-1011 0 NTD",
    ]);
  });
  it("register gives the same rows as balance", () => {
    for (const options of [{}, { all: true }]) {
      const q = query(h).accounts("Assets");
      expect(
        register(h, q, options).map(({ account, depth, subtotal, amounts }) => ({
          account,
          depth,
          subtotal,
          amounts,
        })),
      ).toEqual(balance(h, q, options));
    }
  });
  it("are listed while open", () => {
    expect(rows(balance(h, query(h).accounts("Assets:Receivable").until("2026-10-14")))).toEqual([
      "Assets:Receivable:lunch-1011 400 NTD",
    ]);
  });
});

describe("period labels", () => {
  const h = ledger("");

  it("gives the label of the period a date falls in, as grouping writes it", () => {
    expect(periodLabel(h, "2026-12-29", "week")).toBe("2027-W01");
    expect(periodLabel(h, "2026-11-03", "quarter")).toBe("2026-Q4");
    expect(periodLabel(h, "2026-11-03", "day")).toBe("2026-11-03");
    expect(periodLabel(h, "2026-11-03", "month")).toBe("2026-11");
    expect(periodLabel(h, "2026-11-03", "year")).toBe("2026");
  });

  it("follows week-start", () => {
    const sunday = ledger("option week-start sunday");
    expect(periodLabel(sunday, "2026-01-01", "week")).toBe("2026-W01");
    expect(periodLabel(h, "2026-12-28", "week")).toBe("2027-W01");
    expect(periodLabel(sunday, "2026-12-28", "week")).toBe("2027-W01");
  });

  it("throws on text that is not a day", () => {
    expect(() => periodLabel(h, "2026-11", "month")).toThrow("parse.invalid-time");
    expect(() => periodLabel(h, "2026-02-30", "day")).toThrow("parse.invalid-time");
  });
  it("throws parse.invalid-time on a time of day too", () => {
    expect(() => periodLabel(h, "2026-11-03T10:00", "day")).toThrow("parse.invalid-time");
  });
});

describe("breakdown lines", () => {
  const h = ledger(`
2026-10-12 * "Lunch" @seven
    Expenses:Food       120 NTD
        - Bento  = 95 NTD
        - Egg  = 25 NTD
    Expenses:Drinks      45 NTD
        - Black tea  1 * 45 NTD = 45 NTD
    Assets:Cash        -165 NTD

2026-10-20 * "Afternoon tea" @lawson
    Expenses:Drinks      80 NTD
        - Black tea  2 * 40 NTD = 80 NTD
    Assets:Cash         -80 NTD

2026-11-02 * "Tokyo lunch" @matsuya
    Expenses:Food     1200 JPY @@ 260 NTD
        - Ramen  = 1000 JPY
        - Black tea  = 43 NTD
    Assets:Cash        -260 NTD
`);
  /** Each row as "transaction | account | line name". */
  const where = (rows: readonly BreakdownLineRow[]): string[] =>
    rows.map((r) => `${String(r.transaction.description)} | ${r.posting.account} | ${r.line.name}`);

  it("loads the example ledger without diagnostics", () => {
    expect(codes(h)).toEqual([]);
  });
  it("lists the lines with a name, whichever account their posting is in", () => {
    const found = query(h).breakdown("Black tea").breakdownLines();
    expect(where(found)).toEqual([
      "Lunch | Expenses:Drinks | Black tea",
      "Afternoon tea | Expenses:Drinks | Black tea",
      "Tokyo lunch | Expenses:Food | Black tea",
    ]);
    expect(found.map((r) => r.line)).toEqual([
      {
        name: "Black tea",
        quantity: { value: "1" },
        unitPrice: { value: "45", commodity: "NTD" },
        total: { value: "45", commodity: "NTD" },
      },
      {
        name: "Black tea",
        quantity: { value: "2" },
        unitPrice: { value: "40", commodity: "NTD" },
        total: { value: "80", commodity: "NTD" },
      },
      { name: "Black tea", total: { value: "43", commodity: "NTD" } },
    ]);
  });
  it("carries each row's whole transaction, so its date and its shop", () => {
    const found = query(h).breakdown("Black tea").breakdownLines();
    const transactions = [...query(h)];
    expect(found.map((r) => r.transaction)).toEqual([
      transactions[0],
      transactions[1],
      transactions[2],
    ]);
    expect(found.map((r) => r.transaction.effective.literal)).toEqual([
      "2026-10-12",
      "2026-10-20",
      "2026-11-02",
    ]);
    expect(found.map((r) => r.transaction.refs.map((ref) => ref.entity))).toEqual([
      ["seven"],
      ["lawson"],
      ["matsuya"],
    ]);
    expect(found.map((r) => r.posting.transaction)).toEqual(found.map((r) => r.transaction.id));
  });
  it("combines with other clauses", () => {
    expect(where(query(h).breakdown("Black tea").entities("lawson").breakdownLines())).toEqual([
      "Afternoon tea | Expenses:Drinks | Black tea",
    ]);
    expect(where(query(h).breakdown("Black tea").within("2026-10").breakdownLines())).toEqual([
      "Lunch | Expenses:Drinks | Black tea",
      "Afternoon tea | Expenses:Drinks | Black tea",
    ]);
  });
  it("selects the postings that have a line with the name", () => {
    expect(
      query(h)
        .breakdown("Black tea")
        .postings()
        .map((p) => `${p.account} ${p.amount.value} ${p.amount.commodity}`),
    ).toEqual(["Expenses:Drinks 45 NTD", "Expenses:Drinks 80 NTD", "Expenses:Food 1200 JPY"]);
  });
  it("lists every line of the matched postings without a breakdown clause, as written", () => {
    expect(
      query(h)
        .accounts("Expenses:Food")
        .breakdownLines()
        .map((r) => r.line.name),
    ).toEqual(["Bento", "Egg", "Ramen", "Black tea"]);
  });
  it("gives no rows for postings without lines of their own", () => {
    expect(query(h).accounts("Assets:Cash").breakdownLines()).toEqual([]);
  });
  it("matches names exactly", () => {
    expect(query(h).breakdown("black tea").breakdownLines()).toEqual([]);
    expect(query(h).breakdown("Black tea ").breakdownLines()).toEqual([]);
    expect(query(h).breakdown("black tea").postings()).toEqual([]);
  });
  it("matches any of several names", () => {
    expect(where(query(h).breakdown("Egg", "Ramen").breakdownLines())).toEqual([
      "Lunch | Expenses:Food | Egg",
      "Tokyo lunch | Expenses:Food | Ramen",
    ]);
    expect(
      query(h)
        .breakdown("Egg", "Ramen")
        .postings()
        .map((p) => p.amount.value),
    ).toEqual(["120", "1200"]);
  });
  it("groups the postings' amounts, not the lines' totals", () => {
    expect(query(h).breakdown("Black tea").groupBy("account").sum()).toEqual([
      { key: { account: "Expenses:Drinks" }, value: [{ value: "125", commodity: "NTD" }] },
      { key: { account: "Expenses:Food" }, value: [{ value: "1200", commodity: "JPY" }] },
    ]);
  });
  it("orders rows by posting order on the axis, then as written within a posting", () => {
    const g = ledger(`
2026-10-12 * "Groceries"
    Assets:Prepaid      30 NTD [2026-10-15]
        - Milk  = 20 NTD
        - Bread  = 10 NTD
    Expenses:Other      20 NTD
        - Soap  = 20 NTD
    Assets:Cash        -50 NTD

2026-10-13 * "Snack"
    Expenses:Food       15 NTD
        - Cookie  = 15 NTD
    Assets:Cash        -15 NTD
`);
    expect(codes(g)).toEqual([]);
    const names = (q: ReturnType<typeof query>): string[] =>
      q.breakdownLines().map((r) => r.line.name);
    expect(names(query(g))).toEqual(["Soap", "Cookie", "Milk", "Bread"]);
    expect(names(query(g).axis("accounting"))).toEqual(["Milk", "Bread", "Soap", "Cookie"]);
  });
  it("gives no rows for a transaction without postings", () => {
    const g = ledger(`
2026-10-12 "Confirmed with NAT: 800 owed" @NAT
`);
    expect(query(g).entities("NAT").breakdownLines()).toEqual([]);
    expect(query(g).breakdownLines()).toEqual([]);
  });
  it("gives no rows for generated postings", () => {
    const g = ledger(`
2026-10-01 * "Opening"
    Bank:Checking      12000 NTD
        - Deposit  = 12000 NTD
    Equity:Opening    -12000 NTD

2026-10-25 balance Bank:Checking 12345 NTD pad -> Expenses:ReconcileDiff
`);
    expect(codes(g)).toEqual([]);
    const padding = query(g).tags("system:balance");
    expect(padding.postings()).toHaveLength(2);
    expect(padding.breakdownLines()).toEqual([]);
    expect(
      query(g)
        .breakdownLines()
        .map((r) => r.line.name),
    ).toEqual(["Deposit"]);
  });
});
