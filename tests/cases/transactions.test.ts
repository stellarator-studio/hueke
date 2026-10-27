// docs/core/transactions.md
import { describe, expect, it } from "vitest";
import { check, query, type Hueke, type Transaction } from "../../srcs/index.js";
import { balanceOf, codes, ledger, modules } from "./ledger.js";

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
  it("drops the figures of parts out of order or a number that does not fit the marks", () => {
    for (const figure of ["= 65 * 2", "1.000,5", "* 40 3cups"]) {
      const g = line(`- Toast  ${figure}`);
      expect(codes(g)).toEqual(["breakdown.invalid-figure"]);
      expect(breakdownOf(g)).toEqual([{ name: "Toast" }]);
    }
  });
  it("creates no commodity and never reports an undeclared one", () => {
    const g = ledger(`
option strict commodity

2026-10-12 * "Meal"
    Expenses:Food
        - Points  = 40 POINT
    Assets:Cash      -200 NTD
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
  it("reads an old amount alone as a quantity", () => {
    const g = line("- Toast  65");
    expect(codes(g)).toEqual([]);
    expect(breakdownOf(g)).toEqual([{ name: "Toast", quantity: { value: "65" } }]);
  });
  it("reads an alias as its commodity's code", () => {
    const g = ledger(`
commodity NTD
    precision 0
    alias NT$ prefix

2026-10-12 * "Meal"
    Expenses:Food     200 NTD
        - Toast  = NT$65
    Assets:Cash
`);
    expect(codes(g)).toEqual([]);
    expect(breakdownOf(g)).toEqual([{ name: "Toast", total: { value: "65", commodity: "NTD" } }]);
  });
  it("checks no decimal places and affects no inferred precision", () => {
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

describe("status marks", () => {
  it("header and posting marks", () => {
    const h = ledger(`
2026-10-12 "Supermarket"
    * Expenses:Groceries     300 NTD
    Assets:Cash             -300 NTD

2026-10-13 * "Bookstore"
    Expenses:Other     200 NTD
    Assets:Cash       -200 NTD
`);
    expect(codes(h)).toEqual([]);
    expect(
      query(h)
        .postings()
        .map((p) => `${p.account} ${p.status}`),
    ).toEqual([
      "Expenses:Groceries cleared",
      "Assets:Cash none",
      "Expenses:Other cleared",
      "Assets:Cash cleared",
    ]);
    expect(balanceOf(h, "Assets:Cash", "2026-10-13")).toBe("-500");
  });

  it("invalid combinations", () => {
    const h = ledger(`
2026-11-15 ! "Tax due"
    * Expenses:Tax     8000 NTD
    Bank:Checking     -8000 NTD

2026-10-14 "Withdrawal"
    ! Assets:Cash      1000 NTD
    Bank:Checking    -1000 NTD

2026-10-15 * ! "Two marks"
    Expenses:Other     100 NTD
    Assets:Cash       -100 NTD
`);
    expect(codes(h).sort()).toEqual([
      "parse.syntax",
      "parse.token-order",
      "txn.cleared-not-occurred",
    ]);
  });

  it("# as cancel or tag", () => {
    const h = ledger(`
2026-10-12 # "Lunch (wrong, cancelled)"
    Expenses:Food     180 NTD
    Assets:Cash      -180 NTD

2026-10-13 #travel
    Expenses:Transport     500 NTD
    Assets:Cash           -500 NTD

2026-10-14 * "Taxi" # travel
    Expenses:Transport     300 NTD
    Assets:Cash           -300 NTD

schedule %gym * "Gym membership"
    from 2026-01-05
    every 1 month
    Expenses:Sports     1500 NTD
    Bank:Checking      -1500 NTD
`);
    expect(codes(h)).toEqual(["parse.token-order", "parse.syntax"]);
    expect(balanceOf(h, "Assets:Cash", "2026-10-13")).toBe("-500");
  });
});

describe("correcting a cleared record", () => {
  const h = ledger(`
2026-10-12 # "Lunch"
    Expenses:Food     180 NTD
    Assets:Cash      -180 NTD

2026-10-12 * "Lunch (corrected to 150)"
    Expenses:Food     150 NTD
    Assets:Cash      -150 NTD
`);
  it("leaves the cancelled one out of balances", () => {
    expect(codes(h)).toEqual([]);
    expect(balanceOf(h, "Assets:Cash", "2026-10-12")).toBe("-150");
    const cancelled = [...query(h).accounts("Expenses:Food").occurrence("cancelled")];
    expect(cancelled.map((t) => [t.description, t.postings[0]?.amount.value])).toEqual([
      ["Lunch", "180"],
    ]);
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

describe("system-generated transactions", () => {
  it("take the module of the Balance that generates them, and have no span", () => {
    const h = modules({
      "main.hueke": "option timezone Asia/Taipei\ninclude 2026/10.hueke\n",
      "2026/10.hueke": `2026-10-01 * "Opening"
    Bank:Checking      1000 NTD
    Equity:Opening    -1000 NTD

2026-10-25 balance Bank:Checking 950 NTD pad -> Expenses:ReconcileDiff
`,
    });
    const generated = h.transactions.find((t) => t.id === "~balance.1");
    expect(generated?.source).toBe("2026/10.hueke");
    expect(h.balances[0]?.source).toBe("2026/10.hueke");
    expect(generated).not.toHaveProperty("span");
    expect(generated).not.toHaveProperty("origin");
    expect([...query(h).tags("system:balance")].map((t) => t.id)).toEqual(["~balance.1"]);
  });
});

describe("order of transactions", () => {
  const names = (ts: Iterable<Transaction>): string[] => [...ts].map((t) => t.description ?? t.id);

  describe("a pad on the same day as source transactions", () => {
    const h = ledger(`
2026-10-01 * "Opening"
    Bank:Checking      1000 NTD
    Equity:Opening    -1000 NTD

2026-10-25 balance Bank:Checking 950 NTD pad -> Expenses:ReconcileDiff

2026-10-25 * "Late transfer"
    Expenses:Other      100 NTD
    Bank:Checking      -100 NTD

2026-10-25 * "Same day, written after"
    Expenses:Other        0 NTD
    Assets:Cash           0 NTD
`);
    it("puts generated transactions after source ones at the same time", () => {
      expect(codes(h)).toEqual([]);
      expect(names(h.transactions)).toEqual([
        "Opening",
        "Late transfer",
        "Same day, written after",
        "~balance.1",
      ]);
    });
    it("orders source transactions at the same time by source position", () => {
      expect(names(query(h).within("2026-10-25"))).toEqual([
        "Late transfer",
        "Same day, written after",
        "~balance.1",
      ]);
    });
  });

  describe("a time of day and a date on the same day", () => {
    const h = ledger(`
2026-10-12 * "Dinner, date only"
    Expenses:Food     300 NTD
    Assets:Cash      -300 NTD

2026-10-12T23:59 * "Late snack"
    Expenses:Food      50 NTD
    Assets:Cash       -50 NTD

2026-10-12T08:00 * "Breakfast"
    Expenses:Food      80 NTD
    Assets:Cash       -80 NTD

2026-10-11 * "The day before"
    Expenses:Food     100 NTD
    Assets:Cash      -100 NTD
`);
    it("sorts each time at its end, so times of day come before the date", () => {
      expect(codes(h)).toEqual([]);
      expect(names(h.transactions)).toEqual([
        "The day before",
        "Breakfast",
        "Late snack",
        "Dinner, date only",
      ]);
    });
    it("uses the same order in query results", () => {
      expect(names(query(h))).toEqual([
        "The day before",
        "Breakfast",
        "Late snack",
        "Dinner, date only",
      ]);
      expect(
        query(h)
          .accounts("Expenses:Food")
          .postings()
          .map((p) => p.amount.value),
      ).toEqual(["100", "80", "50", "300"]);
    });
  });

  describe("intervals and points with the same end", () => {
    // In Asia/Taipei, October ends at 2026-11-01T00:00, the moment the point below is written at.
    const h = ledger(`
2026-11-01T00:00 "Point at the end of October"

2026-10 "Month note"

2026-10-31 * "Last day of October"
    Expenses:Food     100 NTD
    Assets:Cash      -100 NTD

2026-10-25..2026-10-31 "Last week of October"
`);
    it("puts intervals before a point at their end, and the shorter interval first", () => {
      expect(codes(h)).toEqual([]);
      expect(names(h.transactions)).toEqual([
        "Last day of October",
        "Last week of October",
        "Month note",
        "Point at the end of October",
      ]);
    });
    it("uses the same order in query results", () => {
      expect(names(query(h).overlaps("2026-10..2026-11"))).toEqual([
        "Last day of October",
        "Last week of October",
        "Month note",
        "Point at the end of October",
      ]);
    });
  });

  describe("equal intervals", () => {
    const h = ledger(`
2026-10-01..2026-10-31 "Written as an interval"

2026-10 "Written as a month"
`);
    it("fall back to source position", () => {
      expect(names(h.transactions)).toEqual(["Written as an interval", "Written as a month"]);
    });
  });

  describe("the effective time decides, not the accounting time", () => {
    const h = ledger(`
2026-10-31=2026-10 * "October building fee"
    Expenses:Housing     2000 NTD
    Bank:Checking       -2000 NTD

2026-10-20 * "Groceries"
    Expenses:Food     300 NTD
    Bank:Checking    -300 NTD
`);
    it("sorts by the effective day", () => {
      expect(codes(h)).toEqual([]);
      expect(names(h.transactions)).toEqual(["Groceries", "October building fee"]);
    });
  });

  describe("records in different time zones", () => {
    // Tokyo 2026-10-21T00:30 is UTC 2026-10-20T15:30; Taipei 2026-10-20T23:45 is UTC 15:45.
    const h = ledger(`
2026-10-20T23:45 * "Taipei, late evening"
    Expenses:Food     100 NTD
    Assets:Cash      -100 NTD

2026-10-21T00:30[Asia/Tokyo] * "Tokyo, after midnight"
    Expenses:Food    1000 JPY
    Assets:Cash     -1000 JPY
`);
    it("sorts by the actual UTC moment", () => {
      expect(codes(h)).toEqual([]);
      expect(names(h.transactions)).toEqual(["Tokyo, after midnight", "Taipei, late evening"]);
    });
    it("keeps that order after filtering by date", () => {
      expect(names(query(h).within("2026-10-20..2026-10-21"))).toEqual([
        "Tokyo, after midnight",
        "Taipei, late evening",
      ]);
      expect(
        query(h)
          .accounts("Assets:Cash")
          .postings()
          .map((p) => p.amount.commodity),
      ).toEqual(["JPY", "NTD"]);
    });
  });

  describe("postings with their own effective times", () => {
    const h = ledger(`
2026-10-12 * "Transfer"
    Assets:Cash          500 NTD
    Bank:Checking       -500 NTD [2026-10-12T10:00]

2026-10-12T09:00 * "Card payment"
    Expenses:Food        200 NTD
    Bank:Checking       -200 NTD

2026-10-11 * "Deposit"
    Bank:Checking       1000 NTD [2026-10-13]
    Assets:Cash        -1000 NTD
`);
    it("sorts postings by their own time on the axis", () => {
      expect(codes(h)).toEqual([]);
      expect(
        query(h)
          .accounts("Bank:Checking")
          .postings()
          .map((p) => p.amount.value),
      ).toEqual(["-200", "-500", "1000"]);
    });
  });
});
