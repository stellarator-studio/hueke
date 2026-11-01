// docs/core/accounts.md
import { describe, expect, it } from "vitest";
import { balance, check, position, query, register } from "../../srcs/index.js";
import { codes, diagnostics, ledger, rows } from "./ledger.js";

const account = (h: ReturnType<typeof ledger>, id: string) => h.accounts.find((a) => a.id === id);

describe("accounts and the hierarchy", () => {
  it("includes sub-accounts in filters", () => {
    const h = ledger(`
2026-10-12 * "Withdrawal"
    Assets:Cash          500 NTD
    Bank:Checking       -500 NTD

2026-10-13 * "Move to a sub-account"
    Bank:Checking:Sub    300 NTD
    Bank:Checking       -300 NTD
`);
    expect(codes(h)).toEqual([]);
    expect(query(h).accounts("Bank:Checking").within("2026-10").postings()).toHaveLength(3);
    expect(account(h, "Bank:Checking:Sub")?.parent).toBe("Bank:Checking");
    expect(account(h, "Bank:Checking")?.parent).toBe("Bank");
  });

  it("includes sub-accounts in a Balance assertion", () => {
    const text = `
2026-10-12 * "Deposit"
    Bank:Checking        200 NTD
    Bank:Checking:Sub    300 NTD
    Assets:Cash         -500 NTD
`;
    expect(codes(ledger(`${text}\n2026-10-13 balance Bank:Checking 500 NTD\n`))).toEqual([]);
    expect(codes(ledger(`${text}\n2026-10-13 balance Bank:Checking 200 NTD\n`))).toEqual([
      "balance.mismatch",
    ]);
  });

  it("keeps balances per commodity", () => {
    const h = ledger(`
2026-10-12 * "Cash in two currencies"
    Assets:Cash        1000 NTD
    Assets:Cash        2000 JPY
    Equity:Opening    -1000 NTD
    Equity:Opening    -2000 JPY
`);
    expect(codes(h)).toEqual([]);
    expect(rows(balance(h, query(h).until("2026-10-31").accounts("Assets:Cash"))).sort()).toEqual([
      "Assets:Cash 1000 NTD",
      "Assets:Cash 2000 JPY",
    ]);
  });
});

describe("account declarations", () => {
  it("sets the primary commodity and the span", () => {
    const h = ledger(`account Bank:Checking\n    primary NTD\n`);
    expect(account(h, "Bank:Checking")?.primaryCommodity).toBe("NTD");
    expect(account(h, "Bank:Checking")?.span).toBeDefined();
    expect(account(h, "Bank:Checking")?.type).toBe("asset");
  });

  it("leaves out the span of an account used without a declaration", () => {
    const h = ledger(`2026-10-12 * "x"\n    Bank:Checking  1 NTD\n    Equity:Opening  -1 NTD\n`);
    const a = account(h, "Bank:Checking");
    expect(a).toBeDefined();
    expect(a).not.toHaveProperty("span");
    expect(a).not.toHaveProperty("primaryCommodity");
  });

  it("reserves other account properties", () => {
    const h = ledger(`account Bank:Checking\n    primary NTD\n    active 2026-01\n`);
    expect(codes(h)).toEqual(["syntax.unsupported"]);
    expect(account(h, "Bank:Checking")).toBeUndefined();
  });
});

describe("account roots", () => {
  it("built-in roots", () => {
    const h = ledger(
      `2026-10-12 * "Lunch"\n    Expenses:Food  180 NTD\n    Assets:Cash  -180 NTD\n`,
    );
    expect(codes(h, true)).toEqual([]);
    expect(account(h, "Expenses:Food")?.type).toBe("expense");
    expect(
      rows(balance(h, query(h).axis("accounting").within("2026-10").accounts("Expenses"))),
    ).toEqual(["Expenses:Food 180 NTD"]);
    for (const [name, type] of [
      ["Assets", "asset"],
      ["Liabilities", "liability"],
      ["Equity", "equity"],
      ["Income", "income"],
      ["Expenses", "expense"],
    ])
      expect(h.roots.find((r) => r.name === name)).toEqual({ name, type, builtin: true });
  });

  it("changes the type of a built-in root, without a diagnostic", () => {
    const h = ledger(
      `account-root Assets liability\n\n2026-10-12 * "x"\n    Assets:Cash  1 NTD\n    Equity:Opening  -1 NTD\n`,
    );
    expect(codes(h, true)).toEqual([]);
    expect(h.roots.find((r) => r.name === "Assets")).toEqual({
      name: "Assets",
      type: "liability",
      builtin: false,
    });
    expect(account(h, "Assets:Cash")?.type).toBe("liability");
  });

  it("lets several roots share a type", () => {
    const h = ledger(
      `account-root Wallet asset\n\n2026-10-12 * "x"\n    Wallet:Coins  1 NTD\n    Bank:Checking  -1 NTD\n`,
    );
    expect(codes(h, true)).toEqual([]);
    expect(account(h, "Wallet:Coins")?.type).toBe("asset");
    expect(account(h, "Bank:Checking")?.type).toBe("asset");
  });

  for (const [what, line] of [
    ["a missing type", "account-root Wallet"],
    ["an extra word", "account-root Wallet asset extra"],
    ["an unknown type", "account-root Wallet savings"],
  ] as const)
    it(`ignores a declaration with ${what}`, () => {
      const h = ledger(`${line}\n`);
      expect(codes(h)).toEqual(["parse.syntax"]);
      expect(h.roots.find((r) => r.name === "Wallet")).toBeUndefined();
    });
});

describe("combined income and expense", () => {
  const CASE = `
2026-10-05 * "October salary"
    Bank:Checking     50000 NTD
    Income:Salary    -50000 NTD

2026-10-10 * "Dinner"
    Expenses:Food     800 NTD
    Assets:Cash      -800 NTD

2026-10-12 * "Dinner, one dish refunded"
    Assets:Cash      200 NTD
    Expenses:Food   -200 NTD

2026-10-20 * "Sold leftover rice to a neighbor"
    Assets:Cash     100 NTD
    Income:Food    -100 NTD
`;
  const merged = (h: ReturnType<typeof ledger>, root: string) =>
    balance(h, query(h).accounts(root).within("2026-10")).map(
      (r) =>
        `${r.account}${r.subtotal ? " (subtotal)" : ""} ${r.amounts.map((a) => `${a.value} ${a.commodity}`).join(", ")}`,
    );
  const h = ledger(`option income-expense on
${CASE}`);

  it("shows income and expenses under one merged root", () => {
    expect(codes(h, true)).toEqual([]);
    expect(h.settings.incomeExpenseRoot).toBe("IncomeExpenses");
    expect(merged(h, "IncomeExpenses")).toEqual([
      "IncomeExpenses (subtotal) -49500 NTD",
      "IncomeExpenses:Food 500 NTD",
      "IncomeExpenses:Salary -50000 NTD",
    ]);
  });

  it("keeps the accounts, their types and the postings' accounts as written", () => {
    expect(account(h, "Expenses:Food")?.type).toBe("expense");
    expect(account(h, "Income:Food")?.type).toBe("income");
    expect(account(h, "IncomeExpenses:Food")).toBeUndefined();
    expect(
      query(h)
        .accounts("IncomeExpenses:Food")
        .postings()
        .map((p) => p.account),
    ).toEqual(["Expenses:Food", "Expenses:Food", "Income:Food"]);
  });

  it("still takes the original names in filters", () => {
    expect(rows(balance(h, query(h).accounts("Expenses:Food")))).toEqual([
      "IncomeExpenses:Food 600 NTD",
    ]);
    expect(query(h).accounts("Income").postings()).toHaveLength(2);
  });

  it("merges a declared root of type income or expense too", () => {
    const g = ledger(`option income-expense on
account-root Gifts income

2026-10-05 * "Birthday money"
    Assets:Cash        1000 NTD
    Gifts:Birthday    -1000 NTD
`);
    expect(codes(g, true)).toEqual([]);
    expect(rows(balance(g, query(g).accounts("IncomeExpenses")))).toEqual([
      "IncomeExpenses:Birthday -1000 NTD",
    ]);
  });

  it("shows the merged names in register", () => {
    expect(
      register(h, query(h).accounts("Income:Food"))
        .filter((r) => !r.subtotal)
        .map((r) => [r.account, r.postings.map((p) => p.account)]),
    ).toEqual([["IncomeExpenses:Food", ["Income:Food"]]]);
  });

  it("takes another name for the merged root", () => {
    const g = ledger(`option income-expense on Flow
${CASE}`);
    expect(codes(g, true)).toEqual([]);
    expect(merged(g, "Flow")).toEqual([
      "Flow (subtotal) -49500 NTD",
      "Flow:Food 500 NTD",
      "Flow:Salary -50000 NTD",
    ]);
  });

  it("changes no rule that depends on type", () => {
    const g = ledger(`
option income-expense on

2026-10-10 * "Dinner"
    Expenses:Food   800 NTD [2026-10-11]
    Assets:Cash    -800 NTD
`);
    expect(codes(g)).toEqual(["posting.pnl-effective"]);
  });

  it("rejects a name that equals a built-in root", () => {
    const g = ledger(`option income-expense on Expenses
${CASE}`);
    expect(codes(g)).toEqual(["option.invalid-root"]);
    expect(merged(g, "IncomeExpenses")).toEqual([]);
    expect(g.settings).not.toHaveProperty("incomeExpenseRoot");
  });

  it("rejects a name that an undeclared account's root already uses", () => {
    const text = `option income-expense on Flow

2026-10-10 * "Dinner"
    Flow:Food         800 NTD
    Assets:Cash      -800 NTD

2026-10-11 * "Lunch"
    Expenses:Food     200 NTD
    Assets:Cash      -200 NTD
`;
    const g = ledger(text, { prelude: "option timezone Asia/Taipei\n" });
    expect(codes(g)).toEqual(["option.invalid-root"]);
    const [invalid] = diagnostics(g, "option.invalid-root");
    const data = g.data.get("main.hueke");
    expect(data && invalid?.span && position(data, invalid.span.start).line).toBe(3);
    expect(g.settings).not.toHaveProperty("incomeExpenseRoot");
    expect(rows(balance(g, query(g).accounts("Flow", "Expenses")))).toEqual([
      "Expenses:Food 200 NTD",
      "Flow:Food 800 NTD",
    ]);
  });
  it("rejects a name that equals a declared root", () => {
    const g = ledger(`account-root Flow asset
option income-expense on Flow
${CASE}`);
    expect(codes(g)).toEqual(["option.invalid-root"]);
    expect(g.settings).not.toHaveProperty("incomeExpenseRoot");
  });
});

describe("untyped accounts", () => {
  const UNDECLARED_ROOT = `2026-10-12 * "Lunch"\n    Spending:Food  180 NTD\n    Assets:Cash  -180 NTD\n`;
  it("an undeclared root", () => {
    const h = ledger(UNDECLARED_ROOT);
    expect(codes(h, true)).toEqual(["name.unknown-root"]);
    expect(check(h)[0]?.severity).toBe("info");
    expect(check(h)[0]?.message).toContain("Spending");
    expect(account(h, "Spending:Food")).toBeDefined();
    expect(account(h, "Spending:Food")).not.toHaveProperty("type");
    expect(rows(balance(h, query(h).within("2026-10").accounts("Spending")))).toEqual([
      "Spending:Food 180 NTD",
    ]);
    expect(
      rows(balance(h, query(h).axis("accounting").within("2026-10").accounts("Expenses"))),
    ).toEqual([]);
  });

  it("reports once per account and allows a posting's own time", () => {
    const h = ledger(`
2026-10-11 * "Coffee"
    Spending:Drinks  90 NTD
    Assets:Cash     -90 NTD

2026-10-12 * "Lunch"
    Spending:Food  180 NTD [2026-10-13]
    Assets:Cash   -180 NTD

2026-10-14 * "Dinner"
    Spending:Food  300 NTD
    Assets:Cash   -300 NTD

2026-10-15 balance Spending:Food 480 NTD
`);
    expect(codes(h, true)).toEqual(["name.unknown-root", "name.unknown-root"]);
    expect(
      query(h)
        .accounts("Spending:Food")
        .within("2026-10-13")
        .postings()
        .map((p) => p.amount.value),
    ).toEqual(["180"]);
  });

  it("gets a type from a declared root", () => {
    const h = ledger(`account-root Spending expense\n\n${UNDECLARED_ROOT}`);
    expect(codes(h, true)).toEqual([]);
    expect(account(h, "Spending:Food")?.type).toBe("expense");
  });

  it("strict accounts", () => {
    const h = ledger(`option strict account\n\naccount Spending:Food\n\n${UNDECLARED_ROOT}`);
    expect(codes(h, true)).toEqual(["strict.unknown-root"]);
  });

  it("strict accounts, undeclared", () => {
    const h = ledger(`option strict account\n\n${UNDECLARED_ROOT}`);
    expect(codes(h, true)).toEqual(["strict.undeclared"]);
  });
});

describe("account metadata", () => {
  it("keeps account and posting metadata apart", () => {
    const h = ledger(`
account Bank:Checking
    ;; bank_code: 808

2026-10-30 * "Deposit"
    Bank:Checking     1000 NTD
        ;; passbook_no: 3
    Assets:Cash      -1000 NTD
`);
    expect(codes(h)).toEqual([]);
    expect(account(h, "Bank:Checking")?.meta).toEqual({ bank_code: "808" });
    expect(
      query(h)
        .accounts("Bank:Checking")
        .within("2026-10-30")
        .postings()
        .map((p) => p.meta),
    ).toEqual([{ passbook_no: "3" }]);
  });
});

describe("account anchors and display names", () => {
  it("keeps the full name as the ID, with the anchor and the display name besides", () => {
    const h = ledger(`
account Bank:Checking %main-bank
    display-name Main checking account
`);
    expect(codes(h)).toEqual([]);
    const a = account(h, "Bank:Checking");
    expect(a?.id).toBe("Bank:Checking");
    expect(a?.anchor).toBe("main-bank");
    expect(a?.displayName).toBe("Main checking account");
    expect(h.accounts.find((x) => x.anchor === "main-bank")?.id).toBe("Bank:Checking");
  });

  it("an anchored declaration declares the account in strict mode", () => {
    const h = ledger(`
option strict account

account Bank:Savings %savings
    primary NTD
    ;; bank_code: 808

2026-10-12 * "Deposit"
    Bank:Savings      1000 NTD
    Assets:Cash      -1000 NTD
`);
    expect(codes(h)).toEqual([]);
    const a = account(h, "Bank:Savings");
    expect(a?.span).toBeDefined();
    expect(a?.primaryCommodity).toBe("NTD");
    expect(a?.meta).toEqual({ bank_code: "808" });
  });

  it("lets a tag name the account, its target being the account's full name", () => {
    const h = ledger(`
account Bank:Checking %main-bank

2026-10-12 * "Transfer" #main-bank
    Bank:Checking      100 NTD
    Assets:Cash       -100 NTD
`);
    expect(codes(h)).toEqual([]);
    const [t] = h.transactions;
    expect(t?.tags).toEqual([
      { scope: "tag", ref: { name: "main-bank" }, target: "Bank:Checking" },
    ]);
  });

  it("is not inherited by sub-accounts", () => {
    const h = ledger(`
account Bank:Checking %main-bank
    display-name Main checking account

2026-10-12 * "Move to a sub-account"
    Bank:Checking:Sub    300 NTD
    Bank:Checking       -300 NTD
`);
    expect(codes(h)).toEqual([]);
    const sub = account(h, "Bank:Checking:Sub");
    expect(sub).toBeDefined();
    expect(sub).not.toHaveProperty("anchor");
    expect(sub).not.toHaveProperty("displayName");
  });

  it("leaves out the fields an account does not declare", () => {
    const h = ledger(`account Bank:Checking\n    primary NTD\n`);
    const a = account(h, "Bank:Checking");
    for (const field of ["anchor", "displayName", "obligation", "padAccount"])
      expect(a).not.toHaveProperty(field);
  });
});

describe("obligation and pad settings", () => {
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
`;

  it("an obligation's sub-account inherits the obligation and the pad account", () => {
    const h = ledger(`${RECEIVABLE}${LUNCH}`);
    expect(codes(h)).toEqual([]);
    expect(account(h, "Assets:Receivable")?.obligation).toBe("receivable");
    expect(account(h, "Assets:Receivable")?.padAccount).toBe("Expenses:WriteOff");
    const sub = account(h, "Assets:Receivable:lunch-1011");
    expect(sub?.obligation).toBe("receivable");
    expect(sub?.padAccount).toBe("Expenses:WriteOff");
    expect(sub).not.toHaveProperty("span");
  });

  it("an obligation's sub-account counts as declared in strict mode", () => {
    const h = ledger(`option strict account

account Expenses:Food
${RECEIVABLE}${LUNCH}`);
    expect(diagnostics(h, "strict.undeclared")).toEqual([]);
  });

  it("declares a payable obligation account", () => {
    const h = ledger(`account Liabilities:Payable\n    obligation payable\n`);
    expect(codes(h)).toEqual([]);
    expect(account(h, "Liabilities:Payable")?.obligation).toBe("payable");
    expect(account(h, "Liabilities:Payable")).not.toHaveProperty("padAccount");
  });

  it("keeps a pad account as written, without checking it", () => {
    const h = ledger(`
option strict account

account Bank:Checking
    pad-account Expenses:Nowhere
`);
    expect(codes(h)).toEqual([]);
    expect(account(h, "Bank:Checking")?.padAccount).toBe("Expenses:Nowhere");
  });

  it("a pad uses the account's pad account before the ledger's", () => {
    const h = ledger(`
option pad-account Expenses:ReconcileDiff

account Bank:Checking
    pad-account Expenses:BankDiff

2026-10-01 * "Opening"
    Bank:Checking      12300 NTD
    Equity:Opening    -12300 NTD

2026-10-25 balance Bank:Checking 12345 NTD pad
`);
    expect(codes(h)).toEqual([]);
    expect(rows(balance(h, query(h).tags("system:balance")))).toEqual([
      "Bank:Checking 45 NTD",
      "Expenses:BankDiff -45 NTD",
    ]);
  });

  it("a sub-account of an account that is not an obligation account does not inherit", () => {
    const h = ledger(`
account Bank
    pad-account Expenses:BankDiff

2026-10-01 * "Opening"
    Bank:Checking      12300 NTD
    Equity:Opening    -12300 NTD

2026-10-25 balance Bank:Checking 12345 NTD pad
`);
    expect(codes(h)).toEqual(["balance.missing-pad-account"]);
    expect(account(h, "Bank:Checking")).not.toHaveProperty("padAccount");
  });
});
