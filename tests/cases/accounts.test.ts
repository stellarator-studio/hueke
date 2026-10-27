// docs/core/accounts.md
import { describe, expect, it } from "vitest";
import { balance, check, position, query } from "../../srcs/index.js";
import { codes, ledger, rows } from "./ledger.js";

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
    expect("span" in (a ?? {})).toBe(false);
    expect("primaryCommodity" in (a ?? {})).toBe(false);
  });

  it("reserves an anchor after the name and does not load the declaration", () => {
    const h = ledger(`
account Bank:Savings %savings
    primary NTD
    ;; bank_code: 808

2026-10-12 * "Deposit"
    Bank:Savings      1000 NTD
    Assets:Cash      -1000 NTD
`);
    expect(codes(h)).toEqual(["syntax.unsupported"]);
    const a = account(h, "Bank:Savings");
    expect(a).toBeDefined();
    expect("anchor" in (a ?? {})).toBe(false);
    expect("span" in (a ?? {})).toBe(false);
    expect("primaryCommodity" in (a ?? {})).toBe(false);
    expect(a?.meta.bank_code).toBeUndefined();
    expect(a?.type).toBe("asset");
  });

  it("an anchored declaration does not declare the account in strict mode", () => {
    const h = ledger(`
option strict account

account Bank:Savings %savings

2026-10-12 * "Deposit"
    Bank:Savings      1000 NTD
    Assets:Cash      -1000 NTD
`);
    expect(codes(h)).toContain("syntax.unsupported");
    expect(codes(h)).toContain("strict.undeclared");
  });

  it("reserves other account properties", () => {
    const h = ledger(`account Bank:Checking\n    primary NTD\n    obligation card\n`);
    expect(codes(h)).toEqual(["syntax.unsupported"]);
    expect(account(h, "Bank:Checking")).toBeUndefined();
  });

  it("uses the first of duplicate declarations, strict or not", () => {
    const text = `account Bank:Checking\n    primary NTD\n\naccount Bank:Checking\n    primary USD\n`;
    for (const strict of ["", "option strict account\n\n"]) {
      const h = ledger(`${strict}${text}`);
      expect(codes(h)).toEqual(["declaration.duplicate"]);
      const d = check(h).find((x) => x.code === "declaration.duplicate");
      expect(d?.severity).toBe("error");
      expect(d?.message).toMatch(/main\.hueke:\d+/);
      expect(account(h, "Bank:Checking")?.primaryCommodity).toBe("NTD");
    }
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

  it("changes the type of a built-in root", () => {
    const h = ledger(
      `account-root Assets liability\n\n2026-10-12 * "x"\n    Assets:Cash  1 NTD\n    Equity:Opening  -1 NTD\n`,
    );
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
    expect("incomeExpenseRoot" in g.settings).toBe(false);
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
    const [invalid] = check(g).filter((d) => d.code === "option.invalid-root");
    const data = g.data.get("main.hueke");
    expect(data && invalid?.span && position(data, invalid.span.start).line).toBe(3);
    expect("incomeExpenseRoot" in g.settings).toBe(false);
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
    expect("incomeExpenseRoot" in g.settings).toBe(false);
  });
});

describe("untyped accounts", () => {
  const UNDECLARED_ROOT = `2026-10-12 * "Lunch"\n    Spending:Food  180 NTD\n    Assets:Cash  -180 NTD\n`;
  it("an undeclared root", () => {
    const h = ledger(UNDECLARED_ROOT);
    expect(codes(h, true)).toEqual(["name.unknown-root"]);
    expect(check(h)[0]?.severity).toBe("info");
    expect(check(h)[0]?.message).toContain("Spending");
    expect("type" in (account(h, "Spending:Food") ?? {})).toBe(false);
    expect(rows(balance(h, query(h).within("2026-10").accounts("Spending")))).toEqual([
      "Spending:Food 180 NTD",
    ]);
    expect(
      rows(balance(h, query(h).axis("accounting").within("2026-10").accounts("Expenses"))),
    ).toEqual([]);
  });

  it("reports once per account and allows a posting's own time", () => {
    const h = ledger(`
2026-10-12 * "Lunch"
    Spending:Food  180 NTD [2026-10-13]
    Assets:Cash   -180 NTD

2026-10-14 * "Dinner"
    Spending:Food  300 NTD
    Assets:Cash   -300 NTD

2026-10-15 balance Spending:Food 480 NTD
`);
    expect(codes(h, true)).toEqual(["name.unknown-root"]);
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

  it("a new passbook", () => {
    const h = ledger(`
account Bank:Checking
    ;; bank_code: 808
    ;; account_no: 0123-456-789

2026-10-30 * "Deposit"
    Bank:Checking     1000 NTD
        ;; passbook_no: 3
        ;; passbook_page: 40
        ;; passbook_line: 22
    Assets:Cash      -1000 NTD

2026-11-02 * "First entry in the new passbook: interest"
    Bank:Checking       12 NTD
        ;; passbook_no: 4
        ;; passbook_page: 1
        ;; passbook_line: 1
    Income:Interest    -12 NTD
`);
    expect(codes(h)).toEqual([]);
    expect(
      query(h)
        .accounts("Bank:Checking")
        .within("2026-10-30..2026-11-02")
        .postings()
        .map((p) => [p.meta.passbook_no, p.meta.passbook_page, p.meta.passbook_line]),
    ).toEqual([
      ["3", "40", "22"],
      ["4", "1", "1"],
    ]);
    expect(account(h, "Bank:Checking")?.meta).toEqual({
      bank_code: "808",
      account_no: "0123-456-789",
    });
  });
});
