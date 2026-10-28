// docs/core/transactions.md
import { describe, expect, it } from "vitest";
import { check, query, type Hueke } from "../../srcs/index.js";
import { balanceOf, codes, ledger } from "./ledger.js";

describe("a plain expense", () => {
  const h = ledger(`
2026-10-12 * "Lunch"
    Expenses:Food     180 NTD
    Assets:Cash      -180 NTD
`);
  it("balances", () => {
    expect(codes(h)).toEqual([]);
    expect(balanceOf(h, "Assets:Cash", "2026-10-12")).toBe("-180");
    expect(balanceOf(h, "Expenses:Food", "2026-10-12")).toBe("180");
  });
});

describe("breakdown", () => {
  const h = ledger(`
2026-10-12 * "Breakfast" @xx_breakfast
    Expenses:Food     200 NTD
        - Bubble tea  3cups * 40 = 120
        - Toast  = 65 NTD
        - Apples  2 kg
        - Discount  = -10
        - Straws
    Assets:Cash      -200 NTD
`);
  it("keeps the breakdown out of the balance", () => {
    expect(codes(h)).toEqual([]);
    expect(balanceOf(h, "Expenses:Food", "2026-10-12")).toBe("200");
  });
  it("keeps only what is written, without the posting's commodity", () => {
    const [posting] = query(h).accounts("Expenses:Food").postings();
    expect(posting?.breakdown).toEqual([
      {
        name: "Bubble tea",
        quantity: { value: "3", unit: "cups" },
        unitPrice: { value: "40" },
        total: { value: "120" },
      },
      { name: "Toast", total: { value: "65", commodity: "NTD" } },
      { name: "Apples", quantity: { value: "2", unit: "kg" } },
      { name: "Discount", total: { value: "-10" } },
      { name: "Straws" },
    ]);
  });

  const line = (breakdown: string, posting = "Expenses:Food     200 NTD") =>
    ledger(`
2026-10-12 * "Meal"
    ${posting}
        ${breakdown}
    Assets:Cash
`);
  const breakdownOf = (g: Hueke) => query(g).accounts("Expenses:Food").postings()[0]?.breakdown;

  it("reports a unit price in another commodity than the posting's amount", () => {
    const g = line("- Ramen  1 * 1200 JPY");
    expect(codes(g)).toEqual(["breakdown.commodity-mismatch"]);
    expect(check(g)[0]?.severity).toBe("error");
    expect(g.transactions).toHaveLength(1);
    expect(breakdownOf(g)).toEqual([
      { name: "Ramen", quantity: { value: "1" }, unitPrice: { value: "1200", commodity: "JPY" } },
    ]);
  });
  it("compares the posting's amount, not its price", () => {
    const g = line("- Ramen  = 1200 JPY", "Expenses:Food     1200 JPY @@ 260 NTD");
    expect(codes(g)).toEqual([]);
  });
  it("reports a unit price and a total in different commodities", () => {
    const g = line("- Toast  1 * 65 NTD = 65 USD");
    expect(codes(g)).toEqual(["breakdown.commodity-mismatch"]);
    expect(breakdownOf(g)).toEqual([
      {
        name: "Toast",
        quantity: { value: "1" },
        unitPrice: { value: "65", commodity: "NTD" },
        total: { value: "65", commodity: "USD" },
      },
    ]);
  });
  it("leaves an omitted posting amount out of the comparison", () => {
    const g = ledger(`
2026-10-12 * "Meal"
    Expenses:Food
        - Ramen  = 1200 JPY
    Assets:Cash     -200 NTD
`);
    expect(codes(g)).toEqual([]);
  });
  it("drops the figures of an expression and keeps the name", () => {
    const g = line("- Toast  = (130/2)");
    expect(codes(g)).toEqual(["breakdown.invalid-figure"]);
    expect(check(g)[0]?.severity).toBe("warning");
    expect(breakdownOf(g)).toEqual([{ name: "Toast" }]);
  });
  it("drops the figures of parts out of order or a number it cannot read", () => {
    for (const figure of ["= 65 * 2", "1,00", "* 40 3cups"]) {
      const g = line(`- Toast  ${figure}`);
      expect(codes(g)).toEqual(["breakdown.invalid-figure"]);
      expect(breakdownOf(g)).toEqual([{ name: "Toast" }]);
    }
  });
  it("creates no commodity", () => {
    const g = ledger(`
2026-10-12 * "Meal"
    Expenses:Food
        - Points  = 40 POINT
    Assets:Cash     -200 NTD
`);
    expect(codes(g, true)).toEqual([]);
    expect(g.commodities.map((c) => c.id)).not.toContain("POINT");
    expect(breakdownOf(g)).toEqual([
      { name: "Points", total: { value: "40", commodity: "POINT" } },
    ]);
  });
  it("reads a single space as part of the name", () => {
    const g = line("- Toast 65");
    expect(codes(g)).toEqual([]);
    expect(breakdownOf(g)).toEqual([{ name: "Toast 65" }]);
  });
  it("reads an amount alone as a quantity", () => {
    const g = line("- Toast  65");
    expect(codes(g)).toEqual([]);
    expect(breakdownOf(g)).toEqual([{ name: "Toast", quantity: { value: "65" } }]);
  });
  it("checks no decimal places and affects no precision", () => {
    const g = ledger(`
2026-10-12 * "Meal"
    Expenses:Food     200 NTD
        - Toast  1 * 65.125 NTD = 65.125 NTD
        - Snack  = 1.5 EUR
    Assets:Cash
`);
    expect(codes(g, true)).toContain("breakdown.commodity-mismatch");
    expect(codes(g, true)).not.toContain("posting.excess-precision");
    expect(g.commodities.map((c) => c.id)).not.toContain("EUR");
  });
});

describe("an omitted amount", () => {
  it("fills it in", () => {
    const h = ledger(`
2026-10-12 * "Lunch"
    Expenses:Food    180 NTD
    Assets:Cash
`);
    expect(codes(h)).toEqual([]);
    expect(balanceOf(h, "Assets:Cash", "2026-10-12")).toBe("-180");
  });
  it("cannot omit two", () => {
    const h = ledger(`
2026-10-12 * "Lunch"
    Expenses:Food    180 NTD
    Assets:Cash
    Bank:Checking
`);
    expect(codes(h)).toEqual(["txn.amount-not-inferable"]);
  });
  it("uses the price's total", () => {
    const h = ledger(`
2026-10-12 * "Bought USD"
    Bank:USDAccount    100 USD @ 32 NTD
    Bank:Checking
`);
    expect(codes(h)).toEqual([]);
    expect(balanceOf(h, "Bank:Checking", "2026-10-12")).toBe("-3200");
  });
  it("cannot choose between two commodities", () => {
    const h = ledger(`
2026-10-12 * "Deposited two foreign currencies from cash"
    Bank:USDAccount     100 USD
    Bank:JPYAccount    3000 JPY
    Assets:Cash
`);
    expect(codes(h)).toEqual(["txn.amount-not-inferable"]);
  });
});

describe("unbalanced", () => {
  it("one commodity", () => {
    const h = ledger(`
2026-10-12 * "Lunch"
    Expenses:Food     180 NTD
    Assets:Cash      -150 NTD
`);
    expect(codes(h)).toEqual(["txn.unbalanced"]);
    expect(checkMessages(h).join()).toContain("30 NTD");
  });
  it("two commodities without a price", () => {
    const h = ledger(`
2026-10-12 * "Bought JPY (rate left out)"
    Assets:Cash      1000 JPY
    Bank:Checking    -220 NTD
`);
    expect(codes(h)).toEqual(["txn.unbalanced"]);
    const [message] = checkMessages(h);
    expect(message).toContain("1000 JPY");
    expect(message).toContain("-220 NTD");
  });
});

describe("tolerance", () => {
  const unbalanced = (text: string): string[] => codes(ledger(text));
  it("within tolerance", () => {
    expect(
      unbalanced(
        `2026-10-12 * "Bought USD"\n    Bank:USDAccount  3 USD @ 32.123 NTD\n    Bank:Checking  -96 NTD\n`,
      ),
    ).toEqual([]);
  });
  it("beyond tolerance", () => {
    expect(
      unbalanced(
        `2026-10-12 * "Bought USD"\n    Bank:USDAccount  3 USD @ 32.123 NTD\n    Bank:Checking  -97 NTD\n`,
      ),
    ).toEqual(["txn.unbalanced"]);
  });
  it("precision 0", () => {
    expect(
      unbalanced(`2026-10-21 * "Ramen"\n    Expenses:Food  1000 JPY\n    Assets:Cash  -1001 JPY\n`),
    ).toEqual(["txn.unbalanced"]);
  });
  it("two converted postings", () => {
    expect(
      unbalanced(
        `2026-10-12 * "x"\n    Expenses:Groceries  1 USD @ 32.4 NTD\n    Expenses:Other  1 USD @ 32.4 NTD\n    Bank:Checking  -64 NTD\n`,
      ),
    ).toEqual([]);
  });
  it("one converted posting", () => {
    expect(
      unbalanced(
        `2026-10-12 * "x"\n    Expenses:Groceries  2 USD @ 32.4 NTD\n    Bank:Checking  -64 NTD\n`,
      ),
    ).toEqual(["txn.unbalanced"]);
  });
  it("excess precision is a warning", () => {
    const h = ledger(
      `2026-10-12 * "Lunch"\n    Expenses:Food  180.5 NTD\n    Assets:Cash  -180.5 NTD\n`,
    );
    expect(codes(h)).toEqual(["posting.excess-precision", "posting.excess-precision"]);
    expect(balanceOf(h, "Assets:Cash", "2026-10-12")).toBe("-180.5");
  });
});

function checkMessages(h: Hueke): string[] {
  return check(h)
    .filter((d) => d.severity === "error")
    .map((d) => d.message);
}

describe("occurrence", () => {
  const h = ledger(`
2026-10-12 # "Lunch"
    Expenses:Food     180 NTD
    Assets:Cash      -180 NTD

2026-10-12 * "Lunch (corrected to 150)"
    Expenses:Food     150 NTD
    Assets:Cash      -150 NTD

2026-10-20 ! "Book to buy"
    Expenses:Other    1000 NTD
    Assets:Cash      -1000 NTD
`);
  it("counts only occurred transactions", () => {
    expect(codes(h)).toEqual([]);
    expect(h.transactions.map((t) => t.occurrence)).toEqual(["cancelled", "occurred", "planned"]);
    expect(balanceOf(h, "Assets:Cash", "2026-10-31")).toBe("-150");
    expect([...query(h)].map((t) => t.description)).toEqual(["Lunch (corrected to 150)"]);
  });
});
