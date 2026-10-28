// docs/core/values.md
import { describe, expect, it } from "vitest";
import { balanceOf, codes, ledger } from "./ledger.js";

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
  it("works in prices and costs, not in breakdowns", () => {
    const h = ledger(`
2026-10-12 * "Buy"
    Assets:Broker      3 AAPL {(450/3) USD} @ (300 / 2) USD
    Assets:Cash

2026-10-13 * "Pizza"
    Expenses:Food      600 NTD
        - My share  = (600/3)
    Assets:Cash
`);
    expect(codes(h)).toEqual(["breakdown.invalid-figure"]);
    const [buy, pizza] = h.transactions;
    expect(buy?.postings[0]?.cost).toEqual({ value: "450", commodity: "USD" });
    expect(buy?.postings[0]?.price).toEqual({ value: "450", commodity: "USD" });
    expect(pizza?.postings[0]?.breakdown).toEqual([{ name: "My share" }]);
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
});
