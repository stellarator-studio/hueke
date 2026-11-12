// docs/core/balance.md
import { describe, expect, it } from "vitest";
import { check, query, reconcile } from "../../srcs/index.js";
import { balanceOf, codes, diagnostics, ledger } from "./ledger.js";

const message = (h: ReturnType<typeof ledger>, code: string): string =>
  diagnostics(h, code)
    .map((d) => d.message)
    .join("\n");

const generated = (h: ReturnType<typeof ledger>) => [...query(h).tags("system:balance")];

describe("clearing a credit card line by line", () => {
  const CARD = `
2026-10-03 "Bookstore"
    Expenses:Other             500 NTD
    Liabilities:CreditCard    -500 NTD

2026-10-12 * "Supermarket"
    Expenses:Groceries         2700 NTD
    Liabilities:CreditCard    -2700 NTD

2026-10-25 balance Liabilities:CreditCard -3200 NTD
`;
  it("passes and shows what is not cleared", () => {
    const h = ledger(CARD);
    expect(codes(h)).toEqual([]);
    const views = reconcile(h, { account: "Liabilities:CreditCard", at: "2026-10-25" });
    expect(views).toHaveLength(1);
    const [view] = views;
    const postings = query(h).postings();
    const describe = (id: string): string => {
      const p = postings.find((x) => x.id === id);
      return `${String(p?.amount.value)} ${String(p?.status)}`;
    };
    expect(view?.account).toBe("Liabilities:CreditCard");
    expect(view?.commodity).toBe("NTD");
    expect(view?.range).not.toHaveProperty("after");
    expect(view?.opening).toEqual({ value: "0", commodity: "NTD" });
    expect(view?.postings.map(describe)).toEqual(["-500 none", "-2700 cleared"]);
    expect(view?.closing).toEqual({ value: "-3200", commodity: "NTD" });
    expect(view?.asserted).toEqual({ value: "-3200", commodity: "NTD" });
    expect(view?.difference).toEqual({ value: "0", commodity: "NTD" });
    expect(view?.uncleared.map(describe)).toEqual(["-500 none"]);
    expect(balanceOf(h, "Liabilities:CreditCard", "2026-10-25")).toBe("-3200");
  });
  it("leaves planned postings out of the view", () => {
    const h = ledger(`${CARD}
2026-10-20 ! "Planned bookstore visit"
    Expenses:Other             300 NTD
    Liabilities:CreditCard    -300 NTD
`);
    expect(codes(h)).toEqual([]);
    const [view] = reconcile(h, { account: "Liabilities:CreditCard", at: "2026-10-25" });
    expect(query(h).occurrence("planned").accounts("Liabilities").postings()).toHaveLength(1);
    const postings = h.transactions.flatMap((t) => t.postings);
    const amount = (id: string) => postings.find((p) => p.id === id)?.amount.value;
    expect(view?.postings.map(amount)).toEqual(["-500", "-2700"]);
    expect(view?.uncleared.map(amount)).toEqual(["-500"]);
    expect(view?.closing).toEqual({ value: "-3200", commodity: "NTD" });
  });
  it("a missing record fails the assertion, off by recorded minus asserted", () => {
    const h = ledger(CARD.replace(/2026-10-12 \* "Supermarket"\n.*\n.*\n/, ""));
    expect(codes(h)).toEqual(["balance.mismatch"]);
    const text = message(h, "balance.mismatch");
    expect(text).toContain("asserted -3200 NTD");
    expect(text).toContain("recorded -500 NTD");
    expect(text).toContain("off by 2700 NTD");
    expect(text).toContain("2026-10-03 -500");
  });
  it("the view's difference is closing minus asserted", () => {
    const h = ledger(CARD.replace(/2026-10-12 \* "Supermarket"\n.*\n.*\n/, ""));
    const [view] = reconcile(h, { account: "Liabilities:CreditCard", at: "2026-10-25" });
    expect(view?.closing).toEqual({ value: "-500", commodity: "NTD" });
    expect(view?.asserted).toEqual({ value: "-3200", commodity: "NTD" });
    expect(view?.difference).toEqual({ value: "2700", commodity: "NTD" });
  });
});

describe("padding a bank account", () => {
  const OPENING = `
2026-10-01 * "Opening"
    Bank:Checking      12300 NTD
    Equity:Opening    -12300 NTD
`;
  const padded = (h: ReturnType<typeof ledger>): void => {
    expect(codes(h)).toEqual([]);
    const [padding, ...rest] = generated(h);
    expect(rest).toEqual([]);
    expect(padding?.effective.literal).toBe("2026-10-25");
    expect(padding?.effective.localDate).toBe("2026-10-25");
    expect(padding?.postings.map((p) => `${p.account} ${p.amount.value} ${p.status}`)).toEqual([
      "Bank:Checking 45 none",
      "Expenses:ReconcileDiff -45 none",
    ]);
    expect(balanceOf(h, "Bank:Checking", "2026-10-25")).toBe("12345");
  };

  it("generates the padding on the Balance's day", () => {
    const h = ledger(
      `${OPENING}\n2026-10-25 balance Bank:Checking 12345 NTD pad -> Expenses:ReconcileDiff\n`,
    );
    padded(h);
    const [padding] = generated(h);
    // Without an accounting time, the generated transaction's is the Balance's effective time.
    expect(padding?.accounting).toEqual(padding?.effective);
  });
  it("without pad it is a hard assertion, off by recorded minus asserted", () => {
    const h = ledger(`${OPENING}\n2026-10-25 balance Bank:Checking 12345 NTD\n`);
    expect(codes(h)).toEqual(["balance.mismatch"]);
    expect(message(h, "balance.mismatch")).toContain("off by -45 NTD");
    expect(generated(h)).toEqual([]);
    const [view] = reconcile(h, { account: "Bank:Checking", at: "2026-10-25" });
    expect(view?.difference).toEqual({ value: "-45", commodity: "NTD" });
  });
  it("uses option pad-account", () => {
    padded(
      ledger(
        `option pad-account Expenses:ReconcileDiff\n${OPENING}\n2026-10-25 balance Bank:Checking 12345 NTD pad\n`,
      ),
    );
  });
  it("prefers the Balance's counter-account to the account's and the ledger's", () => {
    padded(
      ledger(`option pad-account Expenses:Other
account Bank:Checking
    pad-account Expenses:BankDiff
${OPENING}
2026-10-25 balance Bank:Checking 12345 NTD pad -> Expenses:ReconcileDiff
`),
    );
  });
  it("accepts a written padding within the tolerance", () => {
    const h = ledger(
      `${OPENING}\n2026-10-25 balance Bank:USDAccount 0.004 USD pad 0.001 USD -> Expenses:ReconcileDiff\n`,
    );
    expect(codes(h)).toEqual([]);
    expect(generated(h)[0]?.postings[0]?.amount).toEqual({ value: "0.001", commodity: "USD" });
  });
  it("counts a posting on its own effective time", () => {
    const h = ledger(`${OPENING}
2026-10-24 * "Transfer"
    Expenses:Other     45 NTD
    Bank:Checking     -45 NTD [2026-10-26]

2026-10-25 balance Bank:Checking 12300 NTD
2026-10-26 balance Bank:Checking 12255 NTD
`);
    expect(codes(h)).toEqual([]);
  });
  it("generates nothing for a written padding of zero", () => {
    const h = ledger(
      `${OPENING}\n2026-10-25 balance Bank:Checking 12300 NTD pad 0 NTD -> Expenses:ReconcileDiff\n`,
    );
    expect(codes(h)).toEqual([]);
    expect(generated(h)).toEqual([]);
    expect(balanceOf(h, "Bank:Checking", "2026-10-25")).toBe("12300");
  });
  it("no account to pad from", () => {
    const h = ledger(`${OPENING}\n2026-10-25 balance Bank:Checking 12345 NTD pad\n`);
    expect(codes(h)).toEqual(["balance.missing-pad-account"]);
    expect(generated(h)).toEqual([]);
  });
  it("a written padding that reaches the amount", () => {
    padded(
      ledger(
        `${OPENING}\n2026-10-25 balance Bank:Checking 12345 NTD pad 45 NTD -> Expenses:ReconcileDiff\n`,
      ),
    );
  });
  it("a written padding that misses: off by recorded plus padding minus amount", () => {
    const h = ledger(
      `${OPENING}\n2026-10-25 balance Bank:Checking 12345 NTD pad 40 NTD -> Expenses:ReconcileDiff\n`,
    );
    expect(codes(h)).toEqual(["balance.mismatch"]);
    expect(message(h, "balance.mismatch")).toContain("off by -5 NTD");
    expect(generated(h)).toEqual([]);
    expect(balanceOf(h, "Bank:Checking", "2026-10-25")).toBe("12300");
  });
  it("an accounting time goes to the generated transaction only", () => {
    const h = ledger(
      `${OPENING}\n2026-10-31=2026-10 balance Bank:Checking 12345 NTD pad -> Expenses:ReconcileDiff\n`,
    );
    expect(codes(h)).toEqual([]);
    const [balance] = h.balances;
    expect(balance?.effective.literal).toBe("2026-10-31");
    expect(balance?.accounting?.literal).toBe("2026-10");
    const [padding, ...rest] = generated(h);
    expect(rest).toEqual([]);
    expect(padding?.effective.literal).toBe("2026-10-31");
    expect(padding?.effective.precision).toBe("day");
    expect(padding?.accounting.literal).toBe("2026-10");
    expect(padding?.accounting.precision).toBe("month");
    expect(padding?.postings.map((p) => `${p.account} ${p.amount.value} ${p.status}`)).toEqual([
      "Bank:Checking 45 none",
      "Expenses:ReconcileDiff -45 none",
    ]);
    expect(balanceOf(h, "Bank:Checking", "2026-10-31")).toBe("12345");
  });
  it("an accounting time does not change a hard assertion", () => {
    const h = ledger(`${OPENING}\n2026-10-31=2026-10 balance Bank:Checking 12300 NTD\n`);
    expect(codes(h)).toEqual([]);
    const failing = ledger(`${OPENING}\n2026-10-31=2026-10 balance Bank:Checking 12345 NTD\n`);
    expect(codes(failing)).toEqual(["balance.mismatch"]);
    expect(message(failing, "balance.mismatch")).toContain("off by -45 NTD");
  });
  it("a Balance without an accounting time leaves the field out", () => {
    const h = ledger(`${OPENING}\n2026-10-25 balance Bank:Checking 12300 NTD\n`);
    expect(h.balances[0]).not.toHaveProperty("accounting");
  });
  it("two pads into each other", () => {
    const h = ledger(`
2026-10-01 * "Opening"
    Bank:Checking      12300 NTD
    Assets:Cash          500 NTD
    Equity:Opening    -12800 NTD

2026-10-25 balance Bank:Checking 12345 NTD pad -> Assets:Cash
2026-10-25 balance Assets:Cash 480 NTD pad -> Bank:Checking
`);
    expect(codes(h)).toEqual(["balance.pad-conflict", "balance.pad-conflict"]);
    const [first, second] = diagnostics(h, "balance.pad-conflict");
    expect(first?.message).toMatch(/pad of Bank:Checking and the pad of Assets:Cash/);
    expect(second?.message).toMatch(/pad of Assets:Cash and the pad of Bank:Checking/);
    expect(h.transactions.filter((t) => !t.origin)).toEqual([]);
  });
});

describe("pads at one point", () => {
  const OPENING = `
2026-10-01 * "Opening"
    Bank:Checking      12300 NTD
    Assets:Cash          500 NTD
    Equity:Opening    -12800 NTD
`;
  const conflicts = (h: ReturnType<typeof ledger>) =>
    diagnostics(h, "balance.pad-conflict").map((d) => d.message);

  it("written padding in another commodity is pad-commodity", () => {
    const h = ledger(
      `${OPENING}\n2026-10-25 balance Bank:Checking 12345 NTD pad 45 USD -> Expenses:ReconcileDiff\n`,
    );
    expect(codes(h)).toEqual(["balance.pad-commodity"]);
    expect(check(h)[0]?.severity).toBe("error");
    expect(generated(h)).toEqual([]);
  });
  it("a price in another commodity is allowed", () => {
    const h = ledger(
      `${OPENING}\n2026-10-25 balance Bank:Checking 12345 NTD pad 45 NTD @@ 1.5 USD -> Expenses:ReconcileDiff\n`,
    );
    expect(codes(h)).toEqual([]);
    expect(
      generated(h)[0]?.postings.map((p) => `${p.account} ${p.amount.value} ${p.amount.commodity}`),
    ).toEqual(["Bank:Checking 45 NTD", "Expenses:ReconcileDiff -1.5 USD"]);
  });
  it("a pad on a parent and one on its sub-account conflict", () => {
    const h = ledger(`${OPENING}
2026-10-25 balance Assets 480 NTD pad -> Expenses:ReconcileDiff
2026-10-25 balance Assets:Cash 450 NTD pad -> Expenses:ReconcileDiff
`);
    expect(codes(h)).toEqual(["balance.pad-conflict", "balance.pad-conflict"]);
    const [first, second] = conflicts(h);
    expect(first).toContain("Assets:Cash");
    expect(second).toMatch(/\bAssets\b(?!:)/);
    expect(generated(h)).toEqual([]);
  });
  it("reports a pad in conflict with several others once, naming the first", () => {
    const h = ledger(`${OPENING}
2026-10-25 balance Assets 480 NTD pad -> Expenses:ReconcileDiff
2026-10-25 balance Assets:Cash 450 NTD pad -> Expenses:ReconcileDiff
2026-10-25 balance Assets:Coins 10 NTD pad -> Expenses:ReconcileDiff
`);
    expect(codes(h)).toEqual(Array(3).fill("balance.pad-conflict"));
    const [assets] = conflicts(h);
    expect(assets).toContain("Assets:Cash");
    expect(assets).not.toContain("Assets:Coins");
    expect(generated(h)).toEqual([]);
  });
  it("a counter-account inside the asserted account conflicts", () => {
    const h = ledger(`${OPENING}\n2026-10-25 balance Bank 12345 NTD pad -> Bank:Savings\n`);
    expect(codes(h)).toEqual(["balance.pad-conflict"]);
    expect(check(h)[0]?.message).toBe("the pad of Bank pads from Bank:Savings, inside Bank itself");
    expect(generated(h)).toEqual([]);
  });
  it("a pad inside its own account that also affects another is reported once, as affecting it", () => {
    const h = ledger(`${OPENING}
2026-10-25 balance Bank 200 NTD pad -> Bank:Savings
2026-10-25 balance Bank:Checking 120 NTD pad -> Expenses:Diff
`);
    expect(codes(h)).toEqual(["balance.pad-conflict", "balance.pad-conflict"]);
    const [bank, checking] = h.balances.map((b) => b.span?.start);
    expect([bank, checking]).not.toContain(undefined);
    const on = (start: number | undefined) =>
      diagnostics(h, "balance.pad-conflict")
        .filter((d) => d.span?.start === start)
        .map((d) => d.message);
    expect(on(bank)).toEqual([
      "the pad of Bank and the pad of Bank:Checking at the same point affect each other",
    ]);
    expect(on(checking)).toHaveLength(1);
    expect(on(checking)[0]).toMatch(/\bBank\b(?!:)/);
    expect(generated(h)).toEqual([]);
  });
  it("a pad with a zero difference still affects another", () => {
    const h = ledger(`${OPENING}
2026-10-25 balance Assets 500 NTD pad -> Expenses:ReconcileDiff
2026-10-25 balance Assets:Cash 450 NTD pad -> Expenses:ReconcileDiff
`);
    expect(codes(h)).toEqual(["balance.pad-conflict", "balance.pad-conflict"]);
    expect(generated(h)).toEqual([]);
  });
  it("a counter-account that is the asserted account conflicts", () => {
    const h = ledger(
      `${OPENING}\n2026-10-25 balance Bank:Checking 12345 NTD pad -> Bank:Checking\n`,
    );
    expect(codes(h)).toEqual(["balance.pad-conflict"]);
    expect(generated(h)).toEqual([]);
  });
  it("pads that do not affect each other run in source order", () => {
    const h = ledger(`${OPENING}
2026-10-25 balance Assets:Cash 480 NTD pad -> Expenses:ReconcileDiff
2026-10-25 balance Bank:Checking 12345 NTD pad 45 NTD -> Expenses:ReconcileDiff
`);
    expect(codes(h)).toEqual([]);
    expect(generated(h).map((t) => t.postings[0]?.account)).toEqual([
      "Assets:Cash",
      "Bank:Checking",
    ]);
    expect(balanceOf(h, "Assets:Cash", "2026-10-25")).toBe("480");
    expect(balanceOf(h, "Bank:Checking", "2026-10-25")).toBe("12345");
  });
  it("pads in different commodities do not conflict", () => {
    const h = ledger(`${OPENING}
2026-10-25 balance Assets:Cash 100 USD pad -> Bank:Checking
2026-10-25 balance Bank:Checking 12345 NTD pad -> Assets:Cash
`);
    expect(codes(h)).toEqual([]);
    expect(generated(h)).toHaveLength(2);
  });
});

describe("one commodity per Balance", () => {
  const h = ledger(`
2026-09-01 * "Opening"
    Bank:Checking      1000 NTD
    Bank:Checking       100 USD
    Equity:Opening    -1000 NTD
    Equity:Opening     -100 USD

2026-09-30 balance Bank:Checking 1000 NTD
2026-10-15 balance Bank:Checking 100 USD

2026-10-20 * "Fee"
    Expenses:Other     50 NTD
    Bank:Checking     -50 NTD

2026-10-31 balance Bank:Checking 950 NTD
`);
  it("checks only its own commodity", () => {
    expect(codes(h)).toEqual([]);
  });
  it("gives one view per commodity, each with its own period", () => {
    const views = reconcile(h, { account: "Bank:Checking", at: "2026-10-31" });
    const fee = query(h).accounts("Bank:Checking").within("2026-10-20").postings()[0]?.id;
    expect(views.map((v) => v.commodity)).toEqual(["NTD", "USD"]);
    const [ntd, usd] = views;
    expect(ntd?.range.after?.literal).toBe("2026-09-30");
    expect(ntd?.opening).toEqual({ value: "1000", commodity: "NTD" });
    expect(ntd?.postings).toEqual([fee]);
    expect(ntd?.closing).toEqual({ value: "950", commodity: "NTD" });
    expect(ntd?.asserted).toEqual({ value: "950", commodity: "NTD" });
    expect(ntd?.difference).toEqual({ value: "0", commodity: "NTD" });
    expect(usd?.range.after?.literal).toBe("2026-10-15");
    expect(usd?.opening).toEqual({ value: "100", commodity: "USD" });
    expect(usd?.postings).toEqual([]);
    expect(usd?.closing).toEqual({ value: "100", commodity: "USD" });
    expect(usd).not.toHaveProperty("asserted");
    expect(usd).not.toHaveProperty("difference");
  });
  it("gives no view when the account has nothing up to the time", () => {
    expect(reconcile(h, { account: "Bank:Checking", at: "2026-08-31" })).toEqual([]);
  });
});

describe("the tolerance of a Balance", () => {
  const usd = (asserted: string, mode = "") =>
    ledger(`
2026-10-01 * "Deposit"
    Bank:USDAccount     10.004 USD
    Equity:Opening
2026-10-31 balance Bank:USDAccount ${asserted} USD${mode}
`);
  it("passes within half a unit of the commodity's precision", () => {
    const h = usd("10.00");
    expect(codes(h)).toEqual(["posting.excess-precision"]);
  });
  it("fails beyond it, off by recorded minus asserted", () => {
    const h = usd("10.01");
    expect(codes(h)).toEqual(["posting.excess-precision", "balance.mismatch"]);
    expect(message(h, "balance.mismatch")).toContain("off by -0.006 USD");
  });
  it("generates no padding for a difference within it", () => {
    const h = usd("10.00", " pad -> Expenses:ReconcileDiff");
    expect(codes(h)).toEqual(["posting.excess-precision"]);
    expect(generated(h)).toEqual([]);
  });
  it("uses an inferred precision, which counts the Balance's own places", () => {
    // KRW is not declared. The posting has no decimal places but the Balance has one, so the
    // precision is 1 and the tolerance 0.05: 0.4 KRW is too much.
    const h = ledger(`
2026-10-01 * "Deposit"
    Bank:Checking     10 KRW
    Equity:Opening
2026-10-31 balance Bank:Checking 10.4 KRW
`);
    expect(h.commodities.find((c) => c.id === "KRW")?.precision).toBe(1);
    expect(codes(h)).toEqual(["balance.mismatch"]);
  });
});

describe("a Balance is on one day", () => {
  const OPENING = `
2026-10-01 * "Opening"
    Bank:Checking      12300 NTD
    Equity:Opening    -12300 NTD
`;
  it.each([
    ["a month", "2026-10"],
    ["a week", "2026-W43"],
    ["a year", "2026"],
    ["an interval of days", "2026-10-01..2026-10-25"],
    ["a time of day", "2026-10-25T10:00"],
  ])("%s is not loaded", (_, time) => {
    const h = ledger(`${OPENING}\n${time} balance Bank:Checking 12345 NTD\n`);
    expect(codes(h)).toEqual(["balance.invalid-effective"]);
    expect(h.balances).toEqual([]);
  });
  it("a pad Balance on a month generates nothing", () => {
    const h = ledger(
      `${OPENING}\n2026-10 balance Bank:Checking 12345 NTD pad -> Expenses:ReconcileDiff\n`,
    );
    expect(codes(h)).toEqual(["balance.invalid-effective"]);
    expect(h.balances).toEqual([]);
    expect(generated(h)).toEqual([]);
    expect(balanceOf(h, "Bank:Checking", "2026-10-31")).toBe("12300");
  });
});

describe("the generated transaction on its day", () => {
  const h = ledger(`
2026-10-01 * "Opening"
    Bank:Checking      12300 NTD
    Equity:Opening    -12300 NTD

2026-10-25 balance Bank:Checking 12345 NTD pad -> Expenses:ReconcileDiff
2026-10-25 balance Bank:Checking 12345 NTD

2026-10-25 "Deposit written after the Balance"
    Bank:Checking       10 NTD
    Equity:Opening     -10 NTD

2026-10-25T23:30 "Late deposit"
    Bank:Checking        5 NTD
    Equity:Opening      -5 NTD
`);
  it("sees every posting of its day, timed ones included", () => {
    expect(codes(h)).toEqual([]);
    const [padding] = generated(h);
    expect(padding?.postings.map((p) => `${p.account} ${p.amount.value}`)).toEqual([
      "Bank:Checking 30",
      "Expenses:ReconcileDiff -30",
    ]);
    expect(balanceOf(h, "Bank:Checking", "2026-10-25")).toBe("12345");
  });
  it("a later Balance sees it", () => {
    const later = ledger(`
2026-10-01 * "Opening"
    Bank:Checking      12300 NTD
    Equity:Opening    -12300 NTD

2026-10-25 balance Bank:Checking 12345 NTD pad -> Expenses:ReconcileDiff
2026-10-31 balance Bank:Checking 12345 NTD
2026-11-30 balance Bank:Checking 12345 NTD pad -> Expenses:ReconcileDiff
`);
    expect(codes(later)).toEqual([]);
    expect(generated(later)).toHaveLength(1);
  });
});

describe("the range listed when a hard assertion fails", () => {
  const h = ledger(`
2026-09-01 * "Opening"
    Bank:Checking      1000 NTD
    Equity:Opening    -1000 NTD

2026-09-20 "Withdrawal not yet checked"
    Assets:Cash       100 NTD
    Bank:Checking    -100 NTD

2026-09-30 balance Bank:Checking 900 NTD

2026-10-10 "Transfer not yet checked"
    Expenses:Other     200 NTD
    Bank:Checking     -200 NTD

2026-10-31 balance Bank:Checking 650 NTD
`);
  it("lists only what is not cleared since the previous balance", () => {
    expect(codes(h)).toEqual(["balance.mismatch"]);
    const text = message(h, "balance.mismatch");
    expect(text).toContain("asserted 650 NTD");
    expect(text).toContain("recorded 700 NTD");
    expect(text).toContain("off by 50 NTD");
    expect(text).toContain("2026-10-10 -200");
    expect(text).not.toContain("2026-09-20");
  });
  it("the view starts at the previous Balance", () => {
    const [view] = reconcile(h, { account: "Bank:Checking", at: "2026-10-31" });
    expect(view?.range.after?.literal).toBe("2026-09-30");
    expect(view?.opening).toEqual({ value: "900", commodity: "NTD" });
    expect(view?.closing).toEqual({ value: "700", commodity: "NTD" });
    expect(view?.difference).toEqual({ value: "50", commodity: "NTD" });
    expect(view?.uncleared).toHaveLength(2);
  });
});

describe("the previous Balance a failed assertion lists from", () => {
  const OPENING = `
option pad-account Equity:Opening

2026-10-01 "Opening"
    Bank:Checking     100 NTD
    Equity:Opening   -100 NTD
`;
  const LATER = `
2026-10-20 "Deposit"
    Bank:Checking      50 NTD
    Equity:Opening    -50 NTD
`;
  it("may be a pad", () => {
    const h = ledger(
      `${OPENING}\n2026-10-10 balance Bank:Checking 100 NTD pad\n${LATER}\n2026-10-31 balance Bank:Checking 0 NTD\n`,
    );
    expect(codes(h)).toEqual(["balance.mismatch"]);
    const text = message(h, "balance.mismatch");
    expect(text).toContain("2026-10-20 50");
    expect(text).not.toContain("2026-10-01");
  });
  it("is in the same commodity", () => {
    const h = ledger(
      `${OPENING}\n2026-10-10 balance Bank:Checking 0 USD\n${LATER}\n2026-10-31 balance Bank:Checking 0 NTD\n`,
    );
    expect(codes(h)).toEqual(["balance.mismatch"]);
    const text = message(h, "balance.mismatch");
    expect(text).toContain("2026-10-01 100");
    expect(text).toContain("2026-10-20 50");
  });
  it("is the one earlier in source position at the same point", () => {
    const h = ledger(`${OPENING}
2026-10-31 balance Bank:Checking 100 NTD
2026-10-31 "Deposit"
    Bank:Checking      50 NTD
    Equity:Opening    -50 NTD
2026-10-31 balance Bank:Checking 0 NTD
`);
    expect(codes(h)).toEqual(["balance.mismatch", "balance.mismatch"]);
    const [first, second] = diagnostics(h, "balance.mismatch").map((d) => d.message);
    expect(first).toContain("2026-10-01 100");
    expect(first).toContain("2026-10-31 50");
    expect(second).toContain("recorded 150 NTD");
    expect(second).not.toContain("2026-10-01");
  });
});

describe("entities in Balance assertions", () => {
  const SALARY = `
2026-10-01 * "Opening"
    Bank:Checking      1000 NTD
    Equity:Opening    -1000 NTD

2026-10-05 * "October salary" @acme
    Bank:Checking     52000 NTD
    Income:Salary    -52000 NTD

2026-10-06 * "Side job"
    Bank:Checking      3000 NTD  @globex
    Income:Other      -3000 NTD
`;
  it("asserts only the postings of the entity", () => {
    const h = ledger(`${SALARY}
2026-10-31 balance Bank:Checking @acme 52000 NTD
2026-10-31 balance Bank:Checking @globex 3000 NTD
2026-10-31 balance Bank:Checking 56000 NTD
`);
    expect(codes(h)).toEqual([]);
    expect(h.balances.slice(0, 2).map((b) => b.entity)).toEqual(["acme", "globex"]);
    expect(h.balances[2]).not.toHaveProperty("entity");
  });
  it("a wrong amount for the entity is a mismatch", () => {
    const h = ledger(`${SALARY}\n2026-10-31 balance Bank:Checking @acme 55000 NTD\n`);
    expect(codes(h)).toEqual(["balance.mismatch"]);
    expect(message(h, "balance.mismatch")).toContain("recorded 52000 NTD");
  });
  it("reads a posting's own references before its transaction's", () => {
    const h = ledger(`${SALARY}
2026-10-07 * "Paid by globex, booked under acme" @acme
    Bank:Checking       400 NTD  @globex
    Income:Other       -400 NTD

2026-10-31 balance Bank:Checking @acme 52000 NTD
2026-10-31 balance Bank:Checking @globex 3400 NTD
`);
    expect(codes(h)).toEqual([]);
  });
  it("@person:x is the same as @x", () => {
    const h = ledger(`${SALARY}\n2026-10-31 balance Bank:Checking @person:acme 52000 NTD\n`);
    expect(codes(h)).toEqual([]);
    expect(h.balances[0]?.entity).toBe("acme");
  });
  it("another role skips the reference, and the Balance asserts every posting", () => {
    const h = ledger(`${SALARY}\n2026-10-31 balance Bank:Checking @payer:acme 56000 NTD\n`);
    expect(codes(h)).toEqual(["name.unknown-role"]);
    expect(h.balances[0]).not.toHaveProperty("entity");
  });
  it("takes at most one entity", () => {
    const h = ledger(`${SALARY}\n2026-10-31 balance Bank:Checking @acme @globex 55000 NTD\n`);
    expect(codes(h)).toEqual(["parse.syntax"]);
    expect(h.balances).toEqual([]);
  });
  it("a pad with an entity puts it on the posting on the asserted account", () => {
    const h = ledger(`${SALARY}
2026-10-31 balance Bank:Checking @acme 52100 NTD pad -> Income:Salary
`);
    expect(codes(h)).toEqual([]);
    const postings = query(h).tags("system:balance").postings();
    expect(postings.map((p) => `${p.account} ${p.amount.value}`)).toEqual([
      "Bank:Checking 100",
      "Income:Salary -100",
    ]);
    expect(postings.map((p) => p.refs)).toEqual([[{ role: "person", entity: "acme" }], []]);
    expect(
      codes(
        ledger(`${SALARY}
2026-10-31 balance Bank:Checking @acme 52100 NTD pad -> Income:Salary
2026-11-01 balance Bank:Checking @acme 52100 NTD
`),
      ),
    ).toEqual([]);
  });
  it("pads at the same point on the same account conflict whatever their entities", () => {
    const h = ledger(`${SALARY}
2026-10-31 balance Bank:Checking @acme 52100 NTD pad -> Income:Salary
2026-10-31 balance Bank:Checking @globex 3100 NTD pad -> Income:Other
`);
    expect(codes(h)).toEqual(["balance.pad-conflict", "balance.pad-conflict"]);
    expect(generated(h)).toEqual([]);
  });
  it("a mismatch lists uncleared postings since the previous Balance with the same entity", () => {
    const h = ledger(`${SALARY}
2026-10-08 "Expense claim" @acme
    Bank:Checking      200 NTD
    Income:Other      -200 NTD

2026-10-10 balance Bank:Checking 56200 NTD

2026-10-20 "Bonus" @acme
    Bank:Checking      500 NTD
    Income:Salary     -500 NTD

2026-10-31 balance Bank:Checking @acme 52000 NTD
`);
    expect(codes(h)).toEqual(["balance.mismatch"]);
    const text = message(h, "balance.mismatch");
    expect(text).toContain("recorded 52700 NTD");
    expect(text).toContain("2026-10-20 500");
    expect(text).toContain("2026-10-08 200");
  });
  it("the reconciliation view does not assert a Balance with an entity", () => {
    const h = ledger(`${SALARY}\n2026-10-31 balance Bank:Checking @acme 52000 NTD\n`);
    const [view] = reconcile(h, { account: "Bank:Checking", at: "2026-11-30" });
    expect(view).not.toHaveProperty("asserted");
    expect(view?.closing).toEqual({ value: "56000", commodity: "NTD" });
  });
  // A Balance with an entity does not count in the view, so it cannot start the period.
  it("the reconciliation view does not start its period at a Balance with an entity", () => {
    const h = ledger(`${SALARY}\n2026-10-31 balance Bank:Checking @acme 52000 NTD\n`);
    const [view] = reconcile(h, { account: "Bank:Checking", at: "2026-11-30" });
    expect(view?.range).not.toHaveProperty("after");
    expect(view?.opening).toEqual({ value: "0", commodity: "NTD" });
  });
});

describe("entity Balances next to one without an entity", () => {
  const SALARY = `
2026-10-01 * "Opening"
    Bank:Checking      1000 NTD
    Equity:Opening    -1000 NTD

2026-10-05 * "October salary" @acme
    Bank:Checking     50000 NTD
    Income:Salary    -50000 NTD

2026-10-08 "Returned shoes" @shop
    Bank:Checking       300 NTD
    Expenses:Other     -300 NTD
`;
  const PAD = "2026-10-31 balance Bank:Checking @shop 200 NTD pad -> Expenses:ReconcileDiff";

  it("pads down, the entity on the asserted account's posting only", () => {
    const h = ledger(`${SALARY}\n${PAD}\n`);
    expect(codes(h)).toEqual([]);
    const postings = query(h).tags("system:balance").postings();
    expect(postings.map((p) => `${p.account} ${p.amount.value}`)).toEqual([
      "Bank:Checking -100",
      "Expenses:ReconcileDiff 100",
    ]);
    expect(postings.map((p) => p.refs)).toEqual([[{ role: "person", entity: "shop" }], []]);
    expect(balanceOf(h, "Bank:Checking", "2026-10-31")).toBe("51200");
  });
  it("a Balance without an entity sees the generated posting and alone is asserted in the view", () => {
    const h = ledger(`${SALARY}\n${PAD}\n2026-10-31 balance Bank:Checking 51200 NTD\n`);
    expect(codes(h)).toEqual([]);
    const [view] = reconcile(h, { account: "Bank:Checking", at: "2026-10-31" });
    expect(view?.asserted).toEqual({ value: "51200", commodity: "NTD" });
  });
  it("a Balance without an entity starts the view's period", () => {
    const h = ledger(`${SALARY}\n2026-10-31 balance Bank:Checking 51300 NTD\n`);
    const [view] = reconcile(h, { account: "Bank:Checking", at: "2026-11-30" });
    expect(view?.range.after?.literal).toBe("2026-10-31");
    expect(view?.opening).toEqual({ value: "51300", commodity: "NTD" });
  });
  it("another role asserts every posting", () => {
    const h = ledger(`${SALARY}\n2026-10-31 balance Bank:Checking @payee:shop 300 NTD\n`);
    expect(codes(h)).toEqual(["name.unknown-role", "balance.mismatch"]);
    expect(message(h, "balance.mismatch")).toContain("recorded 51300 NTD");
  });
});

describe("an entity Balance on an ancestor of an obligation account", () => {
  const LUNCH = `
account Assets:Receivable
    obligation receivable

2026-10-11 * "Lunch"
    Expenses:Food                   600 NTD
    Assets:Receivable:lunch-1011    400 NTD @NAT
    Assets:Cash                   -1000 NTD

2026-10-15 * "NAT pays back, naming no one"
    Bank:Checking                   250 NTD
    Assets:Receivable:lunch-1011   -250 NTD
`;
  it("reads obligation postings by the obligation's entities", () => {
    const h = ledger(`${LUNCH}\n2026-10-31 balance Assets @NAT 150 NTD\n`);
    expect(codes(h)).toEqual([]);
    expect(h.balances[0]?.entity).toBe("NAT");
  });
  it("counts the repayment that names no one", () => {
    const h = ledger(`${LUNCH}\n2026-10-31 balance Assets @NAT 400 NTD\n`);
    expect(codes(h)).toEqual(["balance.mismatch"]);
    expect(message(h, "balance.mismatch")).toContain("recorded 150 NTD");
  });
});

describe("obligations in Balance assertions", () => {
  const RECEIVABLE = `
account Assets:Receivable
    obligation receivable
    pad-account Expenses:WriteOff
`;
  const LUNCH = `
2026-10-11 * "Lunch"
    Expenses:Food                   600 NTD
    Assets:Receivable:lunch-1011    400 NTD @NAT
    Assets:Cash                   -1000 NTD

2026-10-15 * "NAT pays back 350"
    Bank:Checking                   350 NTD
    Assets:Receivable:lunch-1011   -350 NTD
`;
  const withBalance = (line: string) => ledger(`${RECEIVABLE}${LUNCH}\n${line}\n`);
  /** The generated postings, as "account value commodity". */
  const padded = (h: ReturnType<typeof ledger>) =>
    query(h)
      .tags("system:balance")
      .postings()
      .map((p) => `${p.account} ${p.amount.value} ${p.amount.commodity}`);

  it("a pad on an obligation must write its padding", () => {
    const h = withBalance(
      "2026-10-20 balance Assets:Receivable:lunch-1011 0 NTD pad -> Expenses:ReconcileDiff",
    );
    expect(codes(h)).toEqual(["balance.pad-needs-amount"]);
    expect(check(h)[0]?.severity).toBe("error");
    expect(padded(h)).toEqual([]);
  });
  it("a pad on the obligation account itself is ambiguous", () => {
    const h = withBalance("2026-10-20 balance Assets:Receivable 0 NTD pad -50 NTD");
    expect(codes(h)).toEqual(["balance.ambiguous"]);
    expect(check(h)[0]?.severity).toBe("error");
    expect(padded(h)).toEqual([]);
  });
  it("reports only the missing padding when the pad is also ambiguous", () => {
    const h = withBalance("2026-10-20 balance Assets:Receivable 0 NTD pad");
    expect(codes(h)).toEqual(["balance.pad-needs-amount"]);
  });
  it("a pad with an entity puts it on the generated repayment", () => {
    const h = withBalance("2026-10-20 balance Assets:Receivable:lunch-1011 @NAT 0 NTD pad -50 NTD");
    expect(codes(h)).toEqual([]);
    const postings = query(h).tags("system:balance").postings();
    expect(postings.map((p) => `${p.account} ${p.amount.value}`)).toEqual([
      "Assets:Receivable:lunch-1011 -50",
      "Expenses:WriteOff 50",
    ]);
    expect(postings.map((p) => p.refs)).toEqual([[{ role: "person", entity: "NAT" }], []]);
  });
  it("a Balance on the obligation account with an entity is not loaded", () => {
    const h = withBalance("2026-10-20 balance Assets:Receivable @NAT 50 NTD");
    expect(codes(h)).toEqual(["balance.obligation-entity"]);
    expect(check(h)[0]?.severity).toBe("error");
    expect(h.balances).toEqual([]);
  });
  it("a hard Balance on one obligation with an entity is not loaded", () => {
    const h = withBalance("2026-10-20 balance Assets:Receivable:lunch-1011 @NAT 50 NTD");
    expect(codes(h)).toEqual(["balance.obligation-entity"]);
    expect(h.balances).toEqual([]);
  });
  it("a hard Balance on the obligation account sees the generated transaction", () => {
    const h = withBalance(
      "2026-10-20 balance Assets:Receivable:lunch-1011 0 NTD pad -50 NTD\n2026-10-20 balance Assets:Receivable 0 NTD",
    );
    expect(codes(h)).toEqual([]);
  });
  it("a hard Balance on the obligation account totals its obligations", () => {
    expect(codes(withBalance("2026-10-20 balance Assets:Receivable 50 NTD"))).toEqual([]);
  });
  it("an obligation account without a pad account, and no counter-account written", () => {
    const h = ledger(`
account Assets:Parcels
    obligation receivable

2026-10-11 * "Parcel paid for NAT"
    Assets:Parcels:parcel-1011     200 NTD @NAT
    Assets:Cash                   -200 NTD

2026-10-20 balance Assets:Parcels:parcel-1011 0 NTD pad -200 NTD
`);
    expect(codes(h)).toEqual(["balance.missing-pad-account"]);
  });
  it("the ledger's pad account is used when the obligation account has none", () => {
    const h = ledger(`
option pad-account Expenses:ReconcileDiff

account Assets:Parcels
    obligation receivable

2026-10-11 * "Parcel paid for NAT"
    Assets:Parcels:parcel-1011     200 NTD @NAT
    Assets:Cash                   -200 NTD

2026-10-20 balance Assets:Parcels:parcel-1011 0 NTD pad -200 NTD
`);
    expect(codes(h)).toEqual([]);
    expect(padded(h)).toEqual([
      "Assets:Parcels:parcel-1011 -200 NTD",
      "Expenses:ReconcileDiff 200 NTD",
    ]);
  });
});

describe("pads one after another on the same account", () => {
  const amounts = (h: ReturnType<typeof ledger>): string[][] =>
    generated(h).map((t) => t.postings.map((p) => `${p.account} ${p.amount.value}`));
  const OPENING = `
2026-10-01 * "Opening"
    Bank:Checking      12300 NTD
    Bank:Savings        1000 NTD
    Equity:Opening    -13300 NTD
`;

  it("the later pad counts the earlier one's generated transaction", () => {
    const h = ledger(`${OPENING}
2026-10-25 balance Bank:Checking 12345 NTD pad -> Expenses:ReconcileDiff
2026-10-31 balance Bank:Checking 12400 NTD pad -> Expenses:ReconcileDiff
`);
    expect(codes(h)).toEqual([]);
    expect(amounts(h)).toEqual([
      ["Bank:Checking 45", "Expenses:ReconcileDiff -45"],
      ["Bank:Checking 55", "Expenses:ReconcileDiff -55"],
    ]);
    expect(balanceOf(h, "Bank:Checking", "2026-10-31")).toBe("12400");
  });
  it("counts postings written between the pads too", () => {
    const h = ledger(`${OPENING}
2026-10-25 balance Bank:Checking 12345 NTD pad -> Expenses:ReconcileDiff

2026-10-28 * "Deposit"
    Bank:Checking       20 NTD
    Equity:Opening     -20 NTD

2026-10-31 balance Bank:Checking 12400 NTD pad -> Expenses:ReconcileDiff
2026-11-30 balance Bank:Checking 12300 NTD pad -> Expenses:ReconcileDiff
2026-11-30 balance Bank:Checking 12300 NTD
`);
    expect(codes(h)).toEqual([]);
    expect(amounts(h)).toEqual([
      ["Bank:Checking 45", "Expenses:ReconcileDiff -45"],
      ["Bank:Checking 35", "Expenses:ReconcileDiff -35"],
      ["Bank:Checking -100", "Expenses:ReconcileDiff 100"],
    ]);
  });
  it("written in reverse source order, the pads still run by date", () => {
    const h = ledger(`${OPENING}
2026-10-31 balance Bank:Checking 12400 NTD pad -> Expenses:ReconcileDiff
2026-10-25 balance Bank:Checking 12345 NTD pad -> Expenses:ReconcileDiff
`);
    expect(codes(h)).toEqual([]);
    expect(amounts(h)).toEqual([
      ["Bank:Checking 45", "Expenses:ReconcileDiff -45"],
      ["Bank:Checking 55", "Expenses:ReconcileDiff -55"],
    ]);
    expect(balanceOf(h, "Bank:Checking", "2026-10-31")).toBe("12400");
  });
  it("a later pad on the parent counts the generated transaction of a sub-account", () => {
    const h = ledger(`${OPENING}
2026-10-25 balance Bank:Checking 12345 NTD pad -> Expenses:ReconcileDiff
2026-10-31 balance Bank 13400 NTD pad -> Expenses:ReconcileDiff
`);
    expect(codes(h)).toEqual([]);
    expect(amounts(h)).toEqual([
      ["Bank:Checking 45", "Expenses:ReconcileDiff -45"],
      ["Bank 55", "Expenses:ReconcileDiff -55"],
    ]);
  });
  it("a hard Balance after the pads sees them all", () => {
    const h = ledger(`${OPENING}
2026-10-25 balance Bank:Checking 12345 NTD pad -> Expenses:ReconcileDiff
2026-10-31 balance Bank:Checking 12400 NTD pad -> Expenses:ReconcileDiff
2026-11-01 balance Bank 13400 NTD
2026-11-01 balance Bank:Checking 12400 NTD
`);
    expect(codes(h)).toEqual([]);
  });
});

describe("which postings a Balance counts", () => {
  const ACCOUNTS = `
2026-10-01 * "Opening"
    Assets:Bank            100 NTD
    Assets:Bank:Sub         50 NTD
    Assets:Bank:Sub:Deep     5 NTD
    Assets:Bank2          1000 NTD
    Assets:BankX           300 NTD
    Equity:Opening       -1455 NTD
`;

  it("counts the account's sub-accounts", () => {
    const h = ledger(`${ACCOUNTS}
2026-10-25 balance Assets:Bank 155 NTD
2026-10-25 balance Assets:Bank:Sub 55 NTD
2026-10-25 balance Assets:Bank2 1000 NTD
`);
    expect(codes(h)).toEqual([]);
  });
  it("leaves out an account whose name only starts with the same text", () => {
    const h = ledger(`${ACCOUNTS}\n2026-10-25 balance Assets:Bank 1455 NTD\n`);
    expect(codes(h)).toEqual(["balance.mismatch"]);
    expect(message(h, "balance.mismatch")).toContain("recorded 155 NTD");
  });
  it("a pad on the parent pads by its sub-accounts' postings only", () => {
    const h = ledger(
      `${ACCOUNTS}\n2026-10-25 balance Assets:Bank 200 NTD pad -> Expenses:ReconcileDiff\n`,
    );
    expect(codes(h)).toEqual([]);
    const [padding, ...rest] = generated(h);
    expect(rest).toEqual([]);
    expect(padding?.postings.map((p) => `${p.account} ${p.amount.value}`)).toEqual([
      "Assets:Bank 45",
      "Expenses:ReconcileDiff -45",
    ]);
    expect(balanceOf(h, "Assets:Bank2", "2026-10-25")).toBe("1000");
  });
  it("leaves out planned and cancelled transactions", () => {
    const h = ledger(`${ACCOUNTS}
2026-10-10 ! "Planned deposit"
    Assets:Bank:Sub         70 NTD
    Equity:Opening         -70 NTD

2026-10-11 # "Cancelled deposit"
    Assets:Bank             80 NTD
    Equity:Opening         -80 NTD

2026-10-25 balance Assets:Bank 155 NTD
`);
    expect(codes(h)).toEqual([]);
  });
  it("a pad leaves out planned and cancelled transactions", () => {
    const h = ledger(`${ACCOUNTS}
2026-10-10 ! "Planned deposit"
    Assets:Bank:Sub         70 NTD
    Equity:Opening         -70 NTD

2026-10-11 # "Cancelled deposit"
    Assets:Bank             80 NTD
    Equity:Opening         -80 NTD

2026-10-25 balance Assets:Bank 200 NTD pad -> Expenses:ReconcileDiff
2026-10-25 balance Assets:Bank 200 NTD
`);
    expect(codes(h)).toEqual([]);
    expect(generated(h)[0]?.postings.map((p) => p.amount.value)).toEqual(["45", "-45"]);
  });
});
