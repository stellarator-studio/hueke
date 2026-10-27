// docs/core/balance.md
import { describe, expect, it } from "vitest";
import { check, query, reconcile } from "../../srcs/index.js";
import { balanceOf, codes, ledger } from "./ledger.js";

const message = (h: ReturnType<typeof ledger>, code: string): string =>
  check(h)
    .filter((d) => d.code === code)
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
    const [first, second] = check(h).filter((d) => d.code === "balance.pad-conflict");
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
    check(h)
      .filter((d) => d.code === "balance.pad-conflict")
      .map((d) => d.message);

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
  it("a counter-account inside the asserted account conflicts", () => {
    const h = ledger(`${OPENING}\n2026-10-25 balance Bank 12345 NTD pad -> Bank:Savings\n`);
    expect(codes(h)).toEqual(["balance.pad-conflict"]);
    expect(generated(h)).toEqual([]);
  });
  it("a pad inside its own account that also affects another gets both conflicts", () => {
    const h = ledger(`${OPENING}
2026-10-25 balance Bank 200 NTD pad -> Bank:Savings
2026-10-25 balance Bank:Checking 120 NTD pad -> Expenses:Diff
`);
    expect(codes(h)).toEqual([
      "balance.pad-conflict",
      "balance.pad-conflict",
      "balance.pad-conflict",
    ]);
    const lines = check(h)
      .filter((d) => d.code === "balance.pad-conflict")
      .map((d) => `${String(d.span?.start)} ${d.message}`);
    const [bank, checking] = h.balances.map((b) => String(b.span?.start));
    const onBank = lines.filter((l) => l.startsWith(`${String(bank)} `));
    const onChecking = lines.filter((l) => l.startsWith(`${String(checking)} `));
    expect(onBank).toHaveLength(2);
    expect(onBank.some((l) => l.includes("Bank:Savings"))).toBe(true);
    expect(onBank.some((l) => l.includes("Bank:Checking"))).toBe(true);
    expect(onChecking).toHaveLength(1);
    expect(onChecking[0]).toMatch(/\bBank\b(?!:)/);
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
  it("throws on a time it cannot read", () => {
    expect(() => reconcile(h, { account: "Bank:Checking", at: "2026-13" })).toThrow(
      /parse\.invalid-time/,
    );
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
    // KRW is not declared: its precision is 3, from the posting, so 0.004 KRW is too much.
    const h = ledger(`
2026-10-01 * "Deposit"
    Bank:Checking     10.004 KRW
    Equity:Opening
2026-10-31 balance Bank:Checking 10.00 KRW
`);
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
  it("sorts after the source transactions of its day", () => {
    expect(h.transactions.map((t) => t.description ?? "(generated)")).toEqual([
      "Opening",
      "Late deposit",
      "Deposit written after the Balance",
      "(generated)",
    ]);
    expect(
      query(h)
        .accounts("Bank:Checking")
        .postings()
        .map((p) => p.amount.value),
    ).toEqual(["12300", "5", "10", "30"]);
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

describe("statement summaries and memos", () => {
  const h = ledger(`
2026-10-15 * "Paid rent"
    Expenses:Housing     15000 NTD
    Bank:Checking       -15000 NTD
        ;; summary: Interbank transfer
        ;; memo: October rent
        ;; txn_code: TRF

2026-10-16 * "ATM withdrawal"
    Assets:Cash       2000 NTD
    Bank:Checking    -2000 NTD
        ;; summary: ATM withdrawal
        ;; txn_code: ATM
`);
  it("returns the full Metadata", () => {
    expect(codes(h)).toEqual([]);
    expect(
      query(h)
        .accounts("Bank:Checking")
        .within("2026-10")
        .postings()
        .map((p) => p.meta),
    ).toEqual([
      { summary: "Interbank transfer", memo: "October rent", txn_code: "TRF" },
      { summary: "ATM withdrawal", txn_code: "ATM" },
    ]);
  });
});
