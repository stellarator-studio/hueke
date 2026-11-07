// docs/core/values.md
import { describe, expect, it } from "vitest";
import {
  balance,
  check,
  compareValues,
  Hueke,
  multiplyValues,
  negateValue,
  parse,
  query,
  sumValues,
} from "../../srcs/index.js";
import type { ItemData, PostingData } from "../../srcs/index.js";
import { balanceOf, codes, ledger, rows, SHARED } from "./ledger.js";

describe("currency exchange", () => {
  const h = ledger(`
2026-10-12 * "Bought USD with NTD"
    Bank:USDAccount      1000 USD @ 32.10 NTD
    Bank:Checking      -32100 NTD
`);
  it("balances by the price and keeps the total", () => {
    expect(codes(h)).toEqual([]);
    expect(balanceOf(h, "Bank:USDAccount", "2026-10-12", "USD")).toBe("1000");
    expect(query(h).accounts("Bank:USDAccount").postings()[0]?.price).toEqual({
      value: "32100",
      commodity: "NTD",
    });
  });
});

describe("prices and costs written with a sign", () => {
  it.each([
    ["@ -32.10 NTD", "price"],
    ["@@ -32100 NTD", "price"],
    ["{-32.10 NTD}", "cost"],
    ["{{-32100 NTD}}", "cost"],
    ["@ (10.70 - 42.80) NTD", "price"],
  ] as const)("warns about %s and uses it without the sign", (written, field) => {
    const h = ledger(`
2026-10-12 * "Bought USD with NTD"
    Bank:USDAccount   1000 USD ${written}
    Bank:Checking   -32100 NTD
`);
    expect(codes(h)).toEqual(["posting.signed-price"]);
    expect(check(h)[0]?.severity).toBe("warning");
    expect(h.transactions).toHaveLength(1);
    expect(query(h).accounts("Bank:USDAccount").postings()[0]?.[field]).toEqual({
      value: "32100",
      commodity: "NTD",
    });
  });
  it("ignores a price on a posting whose amount is omitted", () => {
    // Text cannot write a price without an amount, so the parsed record is edited to omit it.
    const data = parse(
      "main.hueke",
      `${SHARED}\n2026-10-12 * "Bought USD"\n    Bank:USDAccount  100 USD @ 32 NTD\n    Bank:Checking  -1 NTD @ 5 USD\n`,
    );
    const omit = (posting: PostingData): PostingData =>
      Object.fromEntries(Object.entries(posting).filter(([k]) => k !== "amount")) as PostingData;
    const items = data.items.map((i): ItemData =>
      i.kind === "transaction"
        ? { ...i, postings: i.postings.map((p, n) => (n === 1 ? omit(p) : p)) }
        : i,
    );
    const h = new Hueke();
    h.load("main.hueke", { ...data, items });
    h.init("main.hueke");
    expect(codes(h)).toEqual([]);
    const [, checking] = h.transactions[0]?.postings ?? [];
    expect(checking?.amount).toEqual({ value: "-3200", commodity: "NTD" });
    expect(checking).not.toHaveProperty("price");
  });
  it("warns about a pad price with a sign", () => {
    const h = ledger(`
2026-10-01 * "Opening"
    Bank:Checking      12300 NTD
    Equity:Opening    -12300 NTD

2026-10-25 balance Bank:Checking 12345 NTD pad 45 NTD @@ -1.5 USD -> Expenses:ReconcileDiff
`);
    expect(codes(h)).toEqual(["posting.signed-price"]);
    expect(balanceOf(h, "Bank:Checking", "2026-10-25")).toBe("12345");
    expect(balanceOf(h, "Expenses:ReconcileDiff", "2026-10-25", "USD")).toBe("-1.5");
  });
});

describe("amounts", () => {
  it("writes zero as 0, never -0", () => {
    const h = ledger(`
2026-10-12 * "Back and forth"
    Assets:Cash        -0 NTD
    Expenses:Food     100 NTD
    Expenses:Food    -100 NTD
`);
    expect(codes(h)).toEqual([]);
    expect(h.transactions[0]?.postings[0]?.amount.value).toBe("0");
    expect(balanceOf(h, "Expenses:Food", "2026-10-12")).toBe("0");
  });
  it("keeps totals per commodity, sorted by code", () => {
    const h = ledger(`
2026-10-12 * "Cash in three currencies"
    Assets:Cash        20 USD
    Assets:Cash      1000 NTD
    Assets:Cash      2000 JPY
    Equity:Opening    -20 USD
    Equity:Opening  -1000 NTD
    Equity:Opening  -2000 JPY
`);
    expect(codes(h)).toEqual([]);
    const [row] = balance(h, query(h).accounts("Assets:Cash")).filter((r) => !r.subtotal);
    expect(row?.amounts.map((a) => a.commodity)).toEqual(["JPY", "NTD", "USD"]);
  });
  it("rejects a plus sign", () => {
    const h = ledger(`2026-10-12 * "X"\n    Expenses:Food  +12 NTD\n    Assets:Cash\n`);
    expect(codes(h)).toEqual(["parse.invalid-number"]);
    expect(h.transactions).toEqual([]);
  });
});

describe("buying shares", () => {
  const h = ledger(`
2026-10-01 * "Bought USD with NTD"
    Bank:USDAccount      1000 USD @ 32.10 NTD
    Bank:Checking      -32100 NTD

2026-10-09 * "Bought AAPL"
    Assets:Brokerage       10 AAPL @ 150 USD
    Expenses:Fees           1 USD
    Bank:USDAccount     -1501 USD

2026-10-12 * "Bought more AAPL"
    Assets:Brokerage         2 AAPL @ 152.3 USD
    Bank:USDAccount     -304.6 USD
`);
  it("balances across commodities", () => {
    expect(codes(h)).toEqual([]);
    expect(balanceOf(h, "Assets:Brokerage", "2026-10-09", "AAPL")).toBe("10");
    expect(balanceOf(h, "Bank:USDAccount", "2026-10-12", "USD")).toBe("-805.6");
  });
});

describe("selling shares", () => {
  it("with a cost, recording the gain by hand", () => {
    const h = ledger(`
2026-10-12 * "Bought AAPL"
    Assets:Brokerage       10 AAPL @ 150 USD
    Expenses:Fees           1 USD
    Bank:USDAccount     -1501 USD

2026-11-20 * "Sold AAPL"
    Assets:Brokerage            -5 AAPL {150 USD} @ 170 USD
    Expenses:Fees                1 USD
    Bank:USDAccount            849 USD
    Income:InvestmentGains    -100 USD
`);
    expect(codes(h)).toEqual([]);
    expect(balanceOf(h, "Assets:Brokerage", "2026-11-20", "AAPL")).toBe("5");
    expect(balanceOf(h, "Bank:USDAccount", "2026-11-20", "USD")).toBe("-652");
    expect(
      rows(
        balance(h, query(h).axis("accounting").within("2026-11").accounts("Income", "Expenses")),
      ),
    ).toEqual(["Expenses:Fees 1 USD", "Income:InvestmentGains -100 USD"]);
    const sale = query(h).accounts("Assets:Brokerage").within("2026-11").postings()[0];
    expect(sale?.cost).toEqual({ value: "750", commodity: "USD" });
    expect(sale?.price).toEqual({ value: "850", commodity: "USD" });
  });
  it("without a cost", () => {
    const h = ledger(`
2026-10-12 * "Bought AAPL"
    Assets:Brokerage       10 AAPL @ 150 USD
    Expenses:Fees           1 USD
    Bank:USDAccount     -1501 USD

2026-10-20 * "Bought more AAPL"
    Assets:Brokerage       10 AAPL @ 160 USD
    Bank:USDAccount     -1600 USD

2026-11-20 * "Sold AAPL"
    Assets:Brokerage     -5 AAPL @ 170 USD
    Expenses:Fees         1 USD
    Bank:USDAccount     849 USD
`);
    expect(codes(h)).toEqual([]);
    expect(balanceOf(h, "Bank:USDAccount", "2026-11-20", "USD")).toBe("-2252");
  });
});

describe("digit groups and decimal marks", () => {
  it("the defaults", () => {
    const h = ledger(`
commodity HKD
    precision 2
commodity GOLD
    precision 3

2026-10-12 * "Rent in Hong Kong"
    Expenses:Housing    1,500 HKD
    Bank:HKDAccount     -1500 HKD

2026-10-13 * "Bought gold"
    Assets:Gold             1.250 GOLD @@ 3,250,000 KRW
    Bank:KRWAccount    -3,250,000 KRW

2026-10-14 * "Wrong group separators"
    Expenses:Other      15,00 HKD
    Bank:HKDAccount    -15,00 HKD
`);
    expect(codes(h)).toEqual(["parse.invalid-number"]);
    expect(balanceOf(h, "Expenses:Housing", "2026-10-13", "HKD")).toBe("1500");
    expect(balanceOf(h, "Assets:Gold", "2026-10-13", "GOLD")).toBe("1.25");
    expect(balanceOf(h, "Bank:KRWAccount", "2026-10-13", "KRW")).toBe("-3250000");
  });
  it("a comma as the decimal mark", () => {
    const h = ledger(`
option decimal-mark ,
option group-mark .

commodity EUR
    precision 2

2026-10-13 * "Rent in Berlin"
    Expenses:Housing    1.500,25 EUR
    Bank:EURAccount     -1500,25 EUR

2026-10-14 * "Mistake: used the default format"
    Expenses:Other      1,500.25 EUR
    Bank:EURAccount    -1,500.25 EUR
`);
    expect(codes(h)).toEqual(["parse.invalid-number"]);
    expect(balanceOf(h, "Expenses:Housing", "2026-10-13", "EUR")).toBe("1500.25");
  });
  it("the same mark for both", () => {
    const h = ledger(`
option decimal-mark ,
option group-mark ,

2026-10-12 * "Coffee in Zurich"
    Expenses:Food      12.50 CHF
    Assets:CHFCash    -12.50 CHF
`);
    expect(codes(h)).toEqual(["option.invalid-number-format"]);
    expect(balanceOf(h, "Expenses:Food", "2026-10-12", "CHF")).toBe("12.5");
  });
  it("a comma as the decimal mark alone makes the group mark a period", () => {
    const h = ledger(`
option decimal-mark ,

commodity EUR
    precision 2

2026-10-13 * "Rent in Berlin"
    Expenses:Housing    1.500,25 EUR
    Bank:EURAccount    -1.500,25 EUR
`);
    expect(codes(h)).toEqual([]);
    expect(balanceOf(h, "Expenses:Housing", "2026-10-13", "EUR")).toBe("1500.25");
  });
});

describe("arithmetic in amounts", () => {
  const amounts = (h: ReturnType<typeof ledger>): string[] =>
    h.transactions.flatMap((t) => t.postings.map((p) => `${p.amount.value} ${p.amount.commodity}`));

  it("evaluates the four operations and parentheses exactly", () => {
    const h = ledger(`
2026-10-12 * "Dinner for three"
    Expenses:Food      ((100 + 50) * 2) NTD
    Expenses:Drinks    (1000/3) NTD
    Expenses:Other     (-2 * -3 / 4) NTD
    Assets:Cash
`);
    expect(codes(h)).toEqual([]);
    expect(amounts(h)).toEqual(["300 NTD", "1000/3 NTD", "1.5 NTD", "-3809/6 NTD"]);
  });
  it("balances fractions exactly", () => {
    const h = ledger(`
2026-10-12 * "Split three ways"
    Expenses:Food     (1000/3) NTD
    Expenses:Food     (1000/3) NTD
    Expenses:Food     (1000/3) NTD
    Assets:Cash      -1000 NTD
`);
    expect(codes(h)).toEqual([]);
    expect(balanceOf(h, "Expenses:Food", "2026-10-12")).toBe("1000");
  });
  it("takes the most decimal places written as the expression's", () => {
    const h = ledger(`
2026-10-12 * "Rounding"
    Expenses:Food     (10/4) NTD
    Expenses:Other    (0.25 * 2) NTD
    Assets:Cash
`);
    expect(codes(h, true)).toEqual(["posting.excess-precision"]);
  });
  it("rejects an expression it cannot read", () => {
    for (const amount of ["(100 +) NTD", "(1/0) NTD", "(1,00 + 1) NTD", "(+1) NTD"]) {
      const h = ledger(`2026-10-12 * "X"\n    Expenses:Food  ${amount}\n    Assets:Cash\n`);
      expect(codes(h)).toEqual(["parse.invalid-number"]);
      expect(h.transactions).toEqual([]);
    }
  });
  it("works in prices and costs", () => {
    const h = ledger(`
2026-10-12 * "Buy"
    Assets:Broker      3 AAPL {(450/3) USD} @ (300 / 2) USD
    Assets:Cash
`);
    expect(codes(h)).toEqual([]);
    const [buy] = h.transactions;
    expect(buy?.postings[0]?.cost).toEqual({ value: "450", commodity: "USD" });
    expect(buy?.postings[0]?.price).toEqual({ value: "450", commodity: "USD" });
  });
});

describe("the code joined to the number", () => {
  it("reads with or without whitespace", () => {
    const h = ledger(`
2026-10-12 * "Lunch"
    Expenses:Food     180NTD
    Assets:Cash      -180   NTD

2026-10-13 * "Dinner"
    Expenses:Food     (100 + 50)NTD
    Assets:Cash      -150 NTD
`);
    expect(codes(h)).toEqual([]);
    expect(balanceOf(h, "Expenses:Food", "2026-10-13")).toBe("330");
  });
  it("negates an expression written after a minus", () => {
    const h = ledger(
      `2026-10-12 * "X"\n    Expenses:Food  50 USD\n    Assets:Cash  -(12.5 * 4)USD\n`,
    );
    expect(codes(h)).toEqual([]);
    expect(h.transactions[0]?.postings[1]?.amount).toEqual({ value: "-50", commodity: "USD" });
  });
});

describe("value arithmetic", () => {
  const h = ledger(`
2026-10-12 * "Split three ways"
    Expenses:Food      (1000/3) NTD
    Expenses:Food      (1000/3) NTD
    Expenses:Food      (1000/3) NTD
    Bank:Checking      -1000 NTD
`);
  const values = query(h)
    .accounts("Expenses:Food")
    .postings()
    .map((p) => p.amount.value);

  it("sums values exactly, fractions included", () => {
    expect(values).toEqual(["1000/3", "1000/3", "1000/3"]);
    expect(sumValues(values)).toBe("1000");
    expect(sumValues(["-12.5", "2.25"])).toBe("-10.25");
    expect(sumValues([])).toBe("0");
  });

  it("multiplies, negates and compares", () => {
    expect(multiplyValues("3", "1.10")).toBe("3.3");
    expect(multiplyValues("1000/3", "3")).toBe("1000");
    expect(negateValue("-1000/3")).toBe("1000/3");
    expect(negateValue("0")).toBe("0");
    expect(compareValues("2.50", "10")).toBeLessThan(0);
    expect(compareValues("1000/3", "333.33")).toBeGreaterThan(0);
    expect(compareValues("2/4", "0.5")).toBe(0);
    expect(negateValue("12.5")).toBe("-12.5");
  });

  it("reads leading zeros and -0 as their values", () => {
    expect(sumValues(["007", "-0"])).toBe("7");
    expect(negateValue("-0/5")).toBe("0");
    expect(sumValues(["-007.50"])).toBe("-7.5");
  });

  it.each(["1,000", "+5", "1/0", "", "abc", "1e3", ".5"])("throws on %j", (text) => {
    expect(() => sumValues([text])).toThrow("not a value");
    expect(() => multiplyValues(text, "1")).toThrow("not a value");
    expect(() => negateValue(text)).toThrow("not a value");
    expect(() => compareValues("1", text)).toThrow("not a value");
  });
});
