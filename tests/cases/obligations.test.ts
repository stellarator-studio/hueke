// docs/core/obligations.md
import { describe, expect, it } from "vitest";
import { balance, check, Hueke, obligations, query, register } from "../../srcs/index.js";
import type { AccountTreeRow, ObligationProgress } from "../../srcs/index.js";
import { balanceOf, codes, diagnostics, ledger, modules, rows } from "./ledger.js";

/** The extra declarations the examples of docs/core/obligations.md load. */
const OBLIGATIONS = `
account Assets:Receivable
    obligation receivable
    pad-account Expenses:WriteOff
account Liabilities:Payable
    obligation payable
    pad-account Expenses:WriteOff
`;

const THB = `
commodity THB
    precision 2
`;

const load = (text: string, extra = "") => ledger(`${OBLIGATIONS}${extra}${text}`);

/** A row as "account commodity [entities] original/repaid/remaining state lastRepaid". */
const row = (r: ObligationProgress): string =>
  [
    r.account,
    r.commodity,
    `[${r.entities.join(",")}]`,
    `${r.original.value}/${r.repaid.value}/${r.remaining.value}`,
    r.settled ? "settled" : "open",
    r.lastRepaid?.literal ?? "-",
  ].join(" ");

const progress = (h: Hueke, options: Parameters<typeof obligations>[1] = {}) =>
  obligations(h, options).map(row);

/** Every account tree row, subtotals included, as "account [subtotal] value commodity". */
const allRows = (tree: readonly AccountTreeRow[]): string[] =>
  tree.flatMap((r) =>
    r.amounts.map(
      (a) => `${r.account}${r.subtotal ? " (subtotal)" : ""} ${a.value} ${a.commodity}`,
    ),
  );

const generated = (h: Hueke) =>
  query(h)
    .tags("system:balance")
    .postings()
    .map((p) => `${p.account} ${p.amount.value} ${p.amount.commodity}`);

describe("lending and repayment", () => {
  const h = load(`
2026-10-11 * "Lunch" @starbucks_xinyi
    Expenses:Food                   600 NTD
    Assets:Receivable:lunch-1011    400 NTD @NAT
    Assets:Cash                   -1000 NTD

2026-10-15 * "NAT pays back"
    Bank:Checking                   250 NTD
    Assets:Receivable:lunch-1011   -250 NTD

2026-10-20 * "NAT pays the rest"
    Bank:Checking                   150 NTD
    Assets:Receivable:lunch-1011   -150 NTD @NAT
`);
  it("needs no reference on a repayment; the header's entity is not the obligation's", () => {
    expect(codes(h)).toEqual([]);
    const [r] = obligations(h, { all: true });
    expect(r?.entities).toEqual(["NAT"]);
  });
  it("progress as of the lending", () => {
    expect(progress(h, { entity: "NAT", at: "2026-10-11" })).toEqual([
      "Assets:Receivable:lunch-1011 NTD [NAT] 400/0/400 open -",
    ]);
    const [r] = obligations(h, { entity: "NAT", at: "2026-10-11" });
    expect(r).not.toHaveProperty("lastRepaid");
    expect(r?.original).toEqual({ value: "400", commodity: "NTD" });
  });
  it("progress as of the first repayment", () => {
    expect(progress(h, { entity: "NAT", at: "2026-10-15" })).toEqual([
      "Assets:Receivable:lunch-1011 NTD [NAT] 400/250/150 open 2026-10-15",
    ]);
  });
  it("hides the obligation once settled", () => {
    expect(progress(h, { entity: "NAT", at: "2026-10-20" })).toEqual([]);
  });
  it("lists it with all", () => {
    expect(progress(h, { entity: "NAT", at: "2026-10-20", all: true })).toEqual([
      "Assets:Receivable:lunch-1011 NTD [NAT] 400/400/0 settled 2026-10-20",
    ]);
  });
  it("lists the obligation's postings in effective order", () => {
    const [r] = obligations(h, { all: true });
    const postings = query(h).accounts("Assets:Receivable:lunch-1011").postings();
    expect(r?.postings).toEqual(postings.map((p) => p.id));
    expect(r?.postings).toHaveLength(3);
  });
  it("keeps a repayment's own reference in its refs", () => {
    const g = load(`
2026-10-11 * "Lunch"
    Expenses:Food                   600 NTD
    Assets:Receivable:lunch-1011    400 NTD @NAT
    Assets:Cash                   -1000 NTD

2026-10-15 * "KEN pays back for NAT"
    Bank:Checking                   400 NTD
    Assets:Receivable:lunch-1011   -400 NTD @KEN
`);
    expect(codes(g)).toEqual([]);
    const [repayment] = query(g).accounts("Assets:Receivable").within("2026-10-15").postings();
    expect(repayment?.refs).toEqual([{ role: "person", entity: "KEN" }]);
    expect(obligations(g, { all: true })[0]?.entities).toEqual(["NAT"]);
  });
});

describe("progress asked several times of one ledger", () => {
  const h = load(`
2026-10-20 * "NAT pays the rest"
    Bank:Checking                   150 NTD
    Assets:Receivable:lunch-1011   -150 NTD

2026-10-11 * "Lunch"
    Expenses:Food                   600 NTD
    Assets:Receivable:lunch-1011    400 NTD @NAT
    Assets:Cash                   -1000 NTD

2026-10-15 * "NAT pays back"
    Bank:Checking                   250 NTD
    Assets:Receivable:lunch-1011   -250 NTD
`);
  const lengths = (options: Parameters<typeof obligations>[1]) =>
    obligations(h, { all: true, ...options }).map((r) => r.postings.length);

  it("gives the same rows each time, whatever was asked before", () => {
    expect(codes(h)).toEqual([]);
    const all = progress(h, { all: true });
    const first = progress(h, { at: "2026-10-15" });
    expect(progress(h, { all: true })).toEqual(all);
    expect(progress(h, { at: "2026-10-11" })).toEqual([
      "Assets:Receivable:lunch-1011 NTD [NAT] 400/0/400 open -",
    ]);
    expect(progress(h, { at: "2026-10-15" })).toEqual(first);
    expect(first).toEqual(["Assets:Receivable:lunch-1011 NTD [NAT] 400/250/150 open 2026-10-15"]);
    expect(all).toEqual(["Assets:Receivable:lunch-1011 NTD [NAT] 400/400/0 settled 2026-10-20"]);
  });
  it("lists each result's own postings, which do not grow with later calls", () => {
    const early = obligations(h, { all: true, at: "2026-10-11" });
    const whole = obligations(h, { all: true });
    expect(early.map((r) => r.postings.length)).toEqual([1]);
    expect(whole.map((r) => r.postings.length)).toEqual([3]);
    expect(lengths({ at: "2026-10-15" })).toEqual([2]);
    expect(lengths({})).toEqual([3]);
    expect(lengths({})).toEqual([3]);
    expect(lengths({ at: "2026-10-11" })).toEqual([1]);
    expect(early.map((r) => r.postings.length)).toEqual([1]);
    expect(whole.map((r) => r.postings.length)).toEqual([3]);
  });
  it("lists the postings in effective order, not written order", () => {
    const ids = (description: string) =>
      query(h)
        .accounts("Assets:Receivable")
        .postings()
        .filter((p) =>
          h.transactions.find((t) => t.description === description)?.postings.includes(p),
        )
        .map((p) => p.id);
    const [r] = obligations(h, { all: true });
    expect(r?.postings).toEqual([
      ...ids("Lunch"),
      ...ids("NAT pays back"),
      ...ids("NAT pays the rest"),
    ]);
    expect(obligations(h, { all: true })[0]?.postings).toEqual(r?.postings);
  });
  it("hides the settled obligation in balance only from its settling on", () => {
    const receivable = (at: string) =>
      rows(balance(h, query(h).accounts("Assets:Receivable").until(at)));
    expect(receivable("2026-10-15")).toEqual(["Assets:Receivable:lunch-1011 150 NTD"]);
    expect(receivable("2026-10-20")).toEqual([]);
    expect(receivable("2026-10-15")).toEqual(["Assets:Receivable:lunch-1011 150 NTD"]);
  });
});

describe("an obligation with several people", () => {
  const h = load(`
2026-10-13 * "Dinner, I paid 1200"
    Expenses:Food                     400 NTD
    Assets:Receivable:dinner-1013     800 NTD @AMY @BOB
    Assets:Cash                     -1200 NTD

2026-10-20 * "AMY pays back"
    Bank:Checking                     400 NTD
    Assets:Receivable:dinner-1013    -400 NTD @AMY

2026-10-20 * "BOB pays back"
    Bank:Checking                     300 NTD
    Assets:Receivable:dinner-1013    -300 NTD @BOB
`);
  it("counts every posting, whoever it names", () => {
    expect(codes(h)).toEqual([]);
    expect(progress(h, { entity: "AMY", at: "2026-10-20" })).toEqual([
      "Assets:Receivable:dinner-1013 NTD [AMY,BOB] 800/700/100 open 2026-10-20",
    ]);
  });
  it("each obligation's postings take its entities in queries", () => {
    expect(query(h).entities("BOB").postings()).toHaveLength(3);
    expect(query(h).entities("AMY").accounts("Assets:Receivable").postings()).toHaveLength(3);
  });
});

describe("offsetting a receivable against a payable", () => {
  const h = load(`
2026-09-01 * "Paid AMY's dinner"
    Assets:Receivable:dinner-0901     300 NTD @AMY
    Assets:Cash                      -300 NTD

2026-09-15 * "Borrowed 200 from AMY"
    Assets:Cash                       200 NTD
    Liabilities:Payable:loan-0915    -200 NTD @AMY

2026-10-31 * "Offset with AMY"
    Liabilities:Payable:loan-0915     200 NTD
    Assets:Receivable:dinner-0901    -200 NTD
`);
  it("leaves the receivable open and settles the payable", () => {
    expect(codes(h)).toEqual([]);
    expect(progress(h, { entity: "AMY", at: "2026-10-31" })).toEqual([
      "Assets:Receivable:dinner-0901 NTD [AMY] 300/200/100 open 2026-10-31",
    ]);
    expect(progress(h, { entity: "AMY", at: "2026-10-31", all: true })).toContain(
      "Liabilities:Payable:loan-0915 NTD [AMY] 200/200/0 settled 2026-10-31",
    );
    expect(balanceOf(h, "Assets:Cash", "2026-10-31")).toBe("-100");
  });
});

describe("a prepayment before any lending", () => {
  const h = load(`
2026-10-01 * "NAT sends trip money first"
    Bank:Checking                   500 NTD
    Assets:Receivable:trip-1001    -500 NTD @NAT

2026-10-05 * "Train ticket for NAT"
    Assets:Receivable:trip-1001     300 NTD @NAT
    Assets:Cash                    -300 NTD

2026-10-10 * "Hotel for NAT"
    Assets:Receivable:trip-1001     500 NTD @NAT
    Assets:Cash                    -500 NTD
`);
  it.each([
    ["2026-10-01", "0/500/-500"],
    ["2026-10-05", "300/500/-200"],
    ["2026-10-10", "800/500/300"],
  ])("at %s", (at, figures) => {
    expect(codes(h)).toEqual([]);
    expect(progress(h, { entity: "NAT", at })).toEqual([
      `Assets:Receivable:trip-1001 NTD [NAT] ${figures} open 2026-10-01`,
    ]);
  });
  it("has its entities whatever the time looked at, even when the lending names them later", () => {
    const g = load(`
2026-10-01 * "Trip money first, naming no one"
    Bank:Checking                   500 NTD
    Assets:Receivable:trip-1001    -500 NTD

2026-10-05 * "Train ticket for NAT"
    Assets:Receivable:trip-1001     300 NTD @NAT
    Assets:Cash                    -300 NTD
`);
    expect(codes(g)).toEqual([]);
    expect(progress(g, { entity: "NAT", at: "2026-10-01" })).toEqual([
      "Assets:Receivable:trip-1001 NTD [NAT] 0/500/-500 open 2026-10-01",
    ]);
    expect(
      query(g)
        .entities("NAT")
        .until("2026-10-01")
        .postings()
        .map((p) => p.account),
    ).toEqual(["Assets:Receivable:trip-1001"]);
  });
  it("has its entities whatever the time looked at", () => {
    expect(
      query(h)
        .entities("NAT")
        .until("2026-10-01")
        .postings()
        .map((p) => p.account),
    ).toEqual(["Assets:Receivable:trip-1001"]);
  });
  it("takes its entities from the repayments when no lending names anyone", () => {
    const g = load(`
2026-10-01 * "NAT sends trip money first"
    Bank:Checking                   500 NTD
    Assets:Receivable:trip-1001    -500 NTD @NAT

2026-10-05 * "Train ticket"
    Assets:Receivable:trip-1001     300 NTD
    Assets:Cash                    -300 NTD
`);
    expect(codes(g)).toEqual([]);
    expect(obligations(g)[0]?.entities).toEqual(["NAT"]);
  });
  it("takes its entities from the lending postings only when one names someone", () => {
    const g = load(`
2026-10-01 * "KEN sends trip money first"
    Bank:Checking                   500 NTD
    Assets:Receivable:trip-1001    -500 NTD @KEN

2026-10-05 * "Train ticket for NAT"
    Assets:Receivable:trip-1001     300 NTD @NAT
    Assets:Cash                    -300 NTD
`);
    expect(obligations(g)[0]?.entities).toEqual(["NAT"]);
    expect(query(g).entities("KEN").postings()).toEqual([]);
  });
  it("never takes the transaction's references", () => {
    const g = load(`
2026-10-05 * "Train ticket" @NAT
    Assets:Receivable:trip-1001     300 NTD
    Assets:Cash                    -300 NTD
`);
    expect(codes(g)).toEqual(["obligation.missing-entity"]);
    expect(obligations(g)[0]?.entities).toEqual([]);
  });
});

describe("several commodities", () => {
  const LENT = `
2026-09-10 * "AMY paid my hotel in Bangkok"
    Expenses:Lodging                  3000 THB
    Liabilities:Payable:hotel-0910   -3000 THB @AMY
`;
  it("a debt in THB repaid in NTD, with a price", () => {
    const h = load(
      `${LENT}
2026-10-05 * "Paid AMY back in NTD"
    Liabilities:Payable:hotel-0910    3000 THB @@ 2700 NTD
    Bank:Checking                    -2700 NTD
`,
      THB,
    );
    expect(codes(h)).toEqual([]);
    expect(progress(h, { entity: "AMY", at: "2026-10-04" })).toEqual([
      "Liabilities:Payable:hotel-0910 THB [AMY] 3000/0/3000 open -",
    ]);
    expect(progress(h, { entity: "AMY", at: "2026-10-05" })).toEqual([]);
    expect(balanceOf(h, "Bank:Checking", "2026-10-05")).toBe("-2700");
  });
  it("closed with a priced pad instead", () => {
    const h = load(
      `${LENT}
2026-10-05 balance Liabilities:Payable:hotel-0910 0 THB pad 3000 THB @@ 2700 NTD -> Bank:Checking
`,
      THB,
    );
    expect(codes(h)).toEqual([]);
    expect(generated(h)).toEqual([
      "Liabilities:Payable:hotel-0910 3000 THB",
      "Bank:Checking -2700 NTD",
    ]);
    const [pad] = query(h).tags("system:balance").postings();
    expect(pad?.price).toEqual({ value: "2700", commodity: "NTD" });
    expect(progress(h, { entity: "AMY", at: "2026-10-04" })).toHaveLength(1);
    expect(progress(h, { entity: "AMY", at: "2026-10-05" })).toEqual([]);
  });
  it("an obligation open in one commodity keeps all its rows", () => {
    const h = load(
      `${LENT}
2026-10-01 * "Converted to NTD"
    Liabilities:Payable:hotel-0910    3000 THB @@ 2700 NTD
    Liabilities:Payable:hotel-0910   -2700 NTD

2026-10-05 * "Paid AMY back"
    Liabilities:Payable:hotel-0910    2700 NTD
    Bank:Checking                    -2700 NTD
`,
      THB,
    );
    expect(codes(h)).toEqual([]);
    expect(
      obligations(h, { entity: "AMY", at: "2026-10-01" }).map(
        (r) => `${r.commodity} ${r.remaining.value} ${r.settled ? "settled" : "open"}`,
      ),
    ).toEqual(["NTD 2700 open", "THB 0 settled"]);
    expect(progress(h, { entity: "AMY", at: "2026-10-05" })).toEqual([]);
  });
  it("a cost links the commodities as a price does", () => {
    const h = load(
      `${LENT}
2026-10-05 * "Paid AMY back in NTD, at cost"
    Liabilities:Payable:hotel-0910    2700 NTD {{3000 THB}}
    Equity:Exchange                  -3000 THB
`,
      THB,
    );
    expect(codes(h)).toEqual([]);
  });
  it("a repayment in another commodity without a price is unlinked", () => {
    const h = load(
      `${LENT}
2026-10-05 * "Paid AMY back in NTD, no price"
    Liabilities:Payable:hotel-0910    2700 NTD
    Bank:Checking                    -2700 NTD
`,
      THB,
    );
    expect(codes(h)).toEqual(["obligation.unlinked-commodity"]);
    expect(diagnostics(h, "obligation.unlinked-commodity")[0]?.severity).toBe("warning");
    expect(
      obligations(h, { entity: "AMY", at: "2026-10-05" }).map(
        (r) => `${r.commodity} ${r.remaining.value} ${r.settled ? "settled" : "open"}`,
      ),
    ).toEqual(["NTD -2700 open", "THB 3000 open"]);
  });
  it("is unlinked once, on the first posting in another commodity than the first", () => {
    const h = load(
      `${LENT}
2026-10-05 * "Paid AMY back in NTD, no price"
    Liabilities:Payable:hotel-0910    2700 NTD
    Bank:Checking                    -2700 NTD

2026-10-06 * "And in USD"
    Liabilities:Payable:hotel-0910       1 USD
    Bank:Checking                       -1 USD
`,
      THB,
    );
    expect(codes(h)).toEqual(["obligation.unlinked-commodity"]);
    const [d] = diagnostics(h, "obligation.unlinked-commodity");
    const repayment = h.transactions.find((t) => t.description?.startsWith("Paid AMY"));
    expect(d?.span).toBeDefined();
    expect(d?.span?.start).toBe(repayment?.postings[0]?.span?.start);
  });
  it("looks only at occurred postings for unlinked commodities", () => {
    const h = load(
      `${LENT}
2026-10-05 ! "Planned: pay AMY back in NTD"
    Liabilities:Payable:hotel-0910    2700 NTD
    Bank:Checking                    -2700 NTD
`,
      THB,
    );
    expect(codes(h)).toEqual([]);
  });
});

describe("closing an obligation", () => {
  const LUNCH = `
2026-10-11 * "Lunch"
    Expenses:Food                   600 NTD
    Assets:Receivable:lunch-1011    400 NTD @NAT
    Assets:Cash                   -1000 NTD

2026-10-15 * "NAT pays back 350"
    Bank:Checking                   350 NTD
    Assets:Receivable:lunch-1011   -350 NTD
`;
  const withBalance = (line: string) => load(`${LUNCH}\n${line}\n`);

  it("writes off the remainder to the inherited pad account", () => {
    const h = withBalance("2026-10-20 balance Assets:Receivable:lunch-1011 0 NTD pad -50 NTD");
    expect(codes(h)).toEqual([]);
    const [t] = query(h).tags("system:balance");
    expect(t?.effective.literal).toBe("2026-10-20");
    expect(generated(h)).toEqual([
      "Assets:Receivable:lunch-1011 -50 NTD",
      "Expenses:WriteOff 50 NTD",
    ]);
    expect(progress(h, { entity: "NAT", at: "2026-10-20" })).toEqual([]);
    expect(progress(h, { entity: "NAT", at: "2026-10-19" })).toEqual([
      "Assets:Receivable:lunch-1011 NTD [NAT] 400/350/50 open 2026-10-15",
    ]);
  });
  it("writes off to the counter-account the pad names", () => {
    const h = withBalance(
      "2026-10-20 balance Assets:Receivable:lunch-1011 0 NTD pad -50 NTD -> Expenses:Discount",
    );
    expect(codes(h)).toEqual([]);
    expect(generated(h)).toEqual([
      "Assets:Receivable:lunch-1011 -50 NTD",
      "Expenses:Discount 50 NTD",
    ]);
  });
  it("padding that does not reach the amount is a mismatch", () => {
    const h = withBalance("2026-10-20 balance Assets:Receivable:lunch-1011 0 NTD pad -40 NTD");
    expect(codes(h)).toEqual(["balance.mismatch"]);
    const text = check(h)[0]?.message ?? "";
    for (const part of ["asserted 0 NTD", "recorded 50 NTD", "off by 10 NTD"])
      expect(text).toContain(part);
    expect(text).toContain("-40");
    expect(generated(h)).toEqual([]);
  });
  it("a remainder within the tolerance is settled", () => {
    const h = load(`
2026-10-11 * "Lunch in USD"
    Expenses:Food                   10.00 USD
    Assets:Receivable:lunch-usd     10.004 USD @NAT
    Bank:Checking                  -20.004 USD

2026-10-15 * "NAT pays back"
    Bank:Checking                   10.00 USD
    Assets:Receivable:lunch-usd    -10.00 USD

2026-10-20 balance Assets:Receivable:lunch-usd 0 USD
`);
    expect(codes(h)).toEqual(["posting.excess-precision", "posting.excess-precision"]);
    const [r] = obligations(h, { all: true });
    expect(r?.remaining).toEqual({ value: "0.004", commodity: "USD" });
    expect(r?.settled).toBe(true);
    expect(obligations(h)).toEqual([]);
  });
  it("an overpayment is closed with a positive pad", () => {
    const h = load(`
2026-10-11 * "Lunch"
    Expenses:Food                   600 NTD
    Assets:Receivable:lunch-1011    400 NTD @NAT
    Assets:Cash                   -1000 NTD

2026-10-15 * "NAT pays back 450"
    Bank:Checking                   450 NTD
    Assets:Receivable:lunch-1011   -450 NTD

2026-10-20 balance Assets:Receivable:lunch-1011 0 NTD pad 50 NTD -> Income:Other
`);
    expect(codes(h)).toEqual([]);
    expect(progress(h, { at: "2026-10-19" })).toEqual([
      "Assets:Receivable:lunch-1011 NTD [NAT] 400/450/-50 open 2026-10-15",
    ]);
    expect(generated(h)).toEqual(["Assets:Receivable:lunch-1011 50 NTD", "Income:Other -50 NTD"]);
    expect(progress(h)).toEqual([]);
  });
  it("counts a positive generated posting on a receivable as lending, not repayment", () => {
    const h = load(`
2026-10-11 * "Lunch"
    Expenses:Food                   600 NTD
    Assets:Receivable:lunch-1011    400 NTD @NAT
    Assets:Cash                   -1000 NTD

2026-10-15 * "NAT pays back 450"
    Bank:Checking                   450 NTD
    Assets:Receivable:lunch-1011   -450 NTD

2026-10-20 balance Assets:Receivable:lunch-1011 0 NTD pad 50 NTD -> Income:Other
`);
    expect(progress(h, { all: true })).toEqual([
      "Assets:Receivable:lunch-1011 NTD [NAT] 450/450/0 settled 2026-10-15",
    ]);
  });
});

describe("the history of an obligation", () => {
  const h = load(`
2026-10-11 * "Lunch for NAT"
    Assets:Receivable:trip-1011     400 NTD @NAT
    Assets:Cash                    -400 NTD

2026-10-12 * "Ticket for NAT"
    Assets:Receivable:trip-1011     300 NTD @NAT
    Assets:Cash                    -300 NTD

2026-10-15 * "NAT pays part"
    Bank:Checking                   500 NTD
    Assets:Receivable:trip-1011    -500 NTD

2026-10-20 * "NAT pays more"
    Bank:Checking                   180 NTD
    Assets:Receivable:trip-1011    -180 NTD

2026-10-25 balance Assets:Receivable:trip-1011 0 NTD pad -20 NTD
`);
  it("lists every posting, the write-off last", () => {
    expect(codes(h)).toEqual([]);
    const postings = query(h).accounts("Assets:Receivable:trip-1011").postings();
    expect(postings.map((p) => p.amount.value)).toEqual(["400", "300", "-500", "-180", "-20"]);
    expect(postings.at(-1)?.tags.map((t) => `${t.scope}:${t.ref.name}`)).toEqual([
      "system:balance",
    ]);
  });
  it("gives the progress of the obligation", () => {
    expect(
      progress(h, { accounts: ["Assets:Receivable:trip-1011"], at: "2026-10-25", all: true }),
    ).toEqual(["Assets:Receivable:trip-1011 NTD [NAT] 700/700/0 settled 2026-10-25"]);
    const [r] = obligations(h, { accounts: ["Assets:Receivable:trip-1011"], all: true });
    expect(r?.postings).toEqual(
      query(h)
        .accounts("Assets:Receivable:trip-1011")
        .postings()
        .map((p) => p.id),
    );
  });
  it("register lists it only with all", () => {
    const q = query(h).accounts("Assets:Receivable:trip-1011");
    expect(register(h, q).filter((r) => !r.subtotal)).toEqual([]);
    const listed = register(h, q, { all: true }).filter((r) => !r.subtotal);
    expect(listed.map((r) => r.account)).toEqual(["Assets:Receivable:trip-1011"]);
    expect(listed[0]?.postings).toHaveLength(5);
  });
});

describe("one person's obligations", () => {
  const h = load(
    `
2026-10-09 * "Movie tickets"
    Expenses:Entertainment           100 NTD
    Assets:Receivable:movie-1009     100 NTD @NAT
    Assets:Cash                     -200 NTD

2026-10-11 * "Lunch"
    Expenses:Food                    600 NTD
    Assets:Receivable:lunch-1011     400 NTD @NAT
    Assets:Cash                    -1000 NTD

2026-10-12 * "NAT paid my massage in Bangkok"
    Expenses:Other                    800 THB
    Liabilities:Payable:massage-1012 -800 THB @NAT

2026-10-14 * "Borrowed from NAT"
    Bank:Checking                    5000 NTD
    Liabilities:Payable:loan-1014   -5000 NTD @NAT

2026-10-15 * "NAT pays for the movie and part of lunch"
    Bank:Checking                     350 NTD
    Assets:Receivable:movie-1009     -100 NTD @NAT
    Assets:Receivable:lunch-1011     -250 NTD @NAT

2026-10-30 * "Paid NAT back in part"
    Liabilities:Payable:loan-1014    2000 NTD @NAT
    Bank:Checking                   -2000 NTD
`,
    THB,
  );
  const OPEN = [
    "Assets:Receivable:lunch-1011 NTD [NAT] 400/250/150 open 2026-10-15",
    "Liabilities:Payable:loan-1014 NTD [NAT] 5000/2000/3000 open 2026-10-30",
    "Liabilities:Payable:massage-1012 THB [NAT] 800/0/800 open -",
  ];
  const q = query(h).accounts("Assets:Receivable").entities("NAT");

  it("lists the open obligations, sorted by account", () => {
    expect(codes(h)).toEqual([]);
    expect(progress(h, { entity: "NAT", at: "2026-10-31" })).toEqual(OPEN);
  });
  it("with all, also the settled one", () => {
    expect(progress(h, { entity: "NAT", at: "2026-10-31", all: true })).toEqual([
      OPEN[0],
      "Assets:Receivable:movie-1009 NTD [NAT] 100/100/0 settled 2026-10-15",
      OPEN[1],
      OPEN[2],
    ]);
  });
  it("without an entity, the same rows", () => {
    expect(progress(h, { at: "2026-10-31" })).toEqual(OPEN);
  });
  it("balance leaves the settled obligation out", () => {
    expect(allRows(balance(h, q.until("2026-10-31")))).toEqual([
      "Assets (subtotal) 150 NTD",
      "Assets:Receivable (subtotal) 150 NTD",
      "Assets:Receivable:lunch-1011 150 NTD",
    ]);
  });
  it("balance with all lists it", () => {
    expect(allRows(balance(h, q.until("2026-10-31"), { all: true }))).toEqual([
      "Assets (subtotal) 150 NTD",
      "Assets:Receivable (subtotal) 150 NTD",
      "Assets:Receivable:lunch-1011 150 NTD",
      "Assets:Receivable:movie-1009 0 NTD",
    ]);
  });
  it("balance before the repayment lists both", () => {
    expect(allRows(balance(h, q.until("2026-10-12")))).toEqual([
      "Assets (subtotal) 500 NTD",
      "Assets:Receivable (subtotal) 500 NTD",
      "Assets:Receivable:lunch-1011 400 NTD",
      "Assets:Receivable:movie-1009 100 NTD",
    ]);
  });
  it("balance hides a settled obligation even when the query names it", () => {
    const named = query(h).accounts("Assets:Receivable:movie-1009").until("2026-10-31");
    expect(rows(balance(h, named))).toEqual([]);
    expect(rows(balance(h, named, { all: true }))).toEqual(["Assets:Receivable:movie-1009 0 NTD"]);
  });
  it("hides by the time clause that ends first", () => {
    const within = query(h).accounts("Assets:Receivable:movie-1009").within("2026-10");
    expect(rows(balance(h, within))).toEqual([]);
    expect(rows(balance(h, within.until("2026-10-12")))).toEqual([
      "Assets:Receivable:movie-1009 100 NTD",
    ]);
  });
  it("hides by effective time, whatever the query's axis", () => {
    // The repayment's accounting time is before the lending; on the effective axis it comes later.
    const g = load(`
2026-10-09 * "Movie tickets"
    Assets:Receivable:movie-1009     100 NTD @NAT
    Assets:Cash                     -100 NTD

2026-10-15=2026-10-01 * "NAT pays back, booked to the start of the month"
    Assets:Cash                      100 NTD
    Assets:Receivable:movie-1009    -100 NTD
`);
    expect(codes(g)).toEqual([]);
    const q = query(g).axis("accounting").accounts("Assets:Receivable");
    expect(rows(balance(g, q.until("2026-10-12")))).toEqual(["Assets:Receivable:movie-1009 0 NTD"]);
    expect(rows(balance(g, q.until("2026-10-15")))).toEqual([]);
  });
  it("without a time clause, hides by the end of the ledger", () => {
    expect(rows(balance(h, query(h).accounts("Assets:Receivable")))).toEqual([
      "Assets:Receivable:lunch-1011 150 NTD",
    ]);
  });
  it("looks at every posting of the obligation, not only those matched", () => {
    // Only the cleared lending is matched; the obligation is settled by its repayment anyway.
    const g = load(`
2026-10-09 * "Movie tickets"
    Assets:Receivable:movie-1009     100 NTD @NAT
    Assets:Cash                     -100 NTD

2026-10-15 "NAT pays back"
    Bank:Checking                     100 NTD
    Assets:Receivable:movie-1009     -100 NTD
`);
    const lending = query(g).accounts("Assets:Receivable").status("cleared");
    expect(lending.postings()).toHaveLength(1);
    expect(rows(balance(g, lending.until("2026-10-31")))).toEqual([]);
    expect(rows(balance(g, lending.until("2026-10-14")))).toEqual([
      "Assets:Receivable:movie-1009 100 NTD",
    ]);
  });
  it("hiding changes no subtotal", () => {
    const hidden = balance(h, query(h).accounts("Assets:Receivable").until("2026-10-31"));
    const shown = balance(h, query(h).accounts("Assets:Receivable").until("2026-10-31"), {
      all: true,
    });
    expect(hidden.filter((r) => r.subtotal)).toEqual(shown.filter((r) => r.subtotal));
  });
  it("a parent whose obligations are all hidden keeps its subtotal row", () => {
    const named = query(h).accounts("Assets:Receivable:movie-1009").until("2026-10-31");
    expect(allRows(balance(h, named))).toEqual([
      "Assets (subtotal) 0 NTD",
      "Assets:Receivable (subtotal) 0 NTD",
    ]);
  });
});

describe("mistakes", () => {
  const h = load(`
2026-10-11 * "Lunch"
    Expenses:Food                  600 NTD
    Assets:Receivable:lunch-1011   400 NTD
    Assets:Cash                  -1000 NTD

2026-10-12 * "Breakfast"
    Expenses:Food              80 NTD
    Assets:Receivable          80 NTD @NAT
    Assets:Cash              -160 NTD

2026-10-12 * "Late snack"
    Expenses:Food                        120 NTD
    Assets:Receivable:NAT:snack-1012     120 NTD @NAT
    Assets:Cash                         -240 NTD
`);
  it("reports each, and every transaction loads and counts", () => {
    expect(codes(h)).toEqual([
      "obligation.missing-entity",
      "obligation.root-posting",
      "obligation.nested",
    ]);
    for (const d of check(h)) expect(d.severity).toBe("error");
    expect(h.transactions).toHaveLength(3);
    expect(balanceOf(h, "Assets:Receivable", "2026-10-31")).toBe("80");
    expect(rows(balance(h, query(h).accounts("Assets:Receivable"), { all: true }))).toEqual([
      "Assets:Receivable 80 NTD",
      "Assets:Receivable:NAT:snack-1012 120 NTD",
      "Assets:Receivable:lunch-1011 400 NTD",
    ]);
  });
  it("reports a missing entity once, on the obligation's first posting", () => {
    const [d] = diagnostics(h, "obligation.missing-entity");
    const lunch = h.transactions.find((t) => t.description === "Lunch");
    expect(d?.span).toBeDefined();
    expect(d?.span?.start).toBe(lunch?.postings[1]?.span?.start);
  });
  it("lists the obligation without an entity, and no row for the misplaced postings", () => {
    expect(progress(h)).toEqual(["Assets:Receivable:lunch-1011 NTD [] 400/0/400 open -"]);
  });
  it("an obligation declared inside an obligation account takes no effect", () => {
    const g = load(`
account Assets:Receivable:group
    obligation payable

2026-10-11 * "Lunch"
    Assets:Receivable:group       400 NTD @NAT
    Assets:Cash                  -400 NTD
`);
    expect(codes(g)).toEqual(["obligation.nested"]);
    const account = g.accounts.find((a) => a.id === "Assets:Receivable:group");
    expect(account?.obligation).toBe("receivable");
    expect(progress(g)).toEqual(["Assets:Receivable:group NTD [NAT] 400/0/400 open -"]);
  });
  it("counts a planned posting for neither progress nor diagnostics about entities", () => {
    const g = load(`
2026-10-11 ! "Planned lunch"
    Assets:Receivable:lunch-1011   400 NTD
    Assets:Cash                   -400 NTD
`);
    expect(codes(g)).toEqual([]);
    expect(obligations(g, { all: true })).toEqual([]);
  });
  it("reports a posting on the obligation account even when planned", () => {
    const g = load(`
2026-10-11 ! "Planned breakfast"
    Assets:Receivable    80 NTD @NAT
    Assets:Cash         -80 NTD
`);
    expect(codes(g)).toEqual(["obligation.root-posting"]);
  });
  it("reports a posting inside an obligation even when planned", () => {
    const g = load(`
2026-10-12 ! "Planned snack"
    Assets:Receivable:NAT:snack-1012     120 NTD @NAT
    Assets:Cash                         -120 NTD
`);
    expect(codes(g)).toEqual(["obligation.nested"]);
  });
});

describe("obligation accounts", () => {
  it("the same name under receivable and payable gives two obligations", () => {
    const h = load(`
2026-10-01 * "Trip costs I paid for NAT"
    Assets:Receivable:tokyo-trip     300 NTD @NAT
    Assets:Cash                     -300 NTD

2026-10-02 * "Trip costs NAT paid for me"
    Expenses:Travel                  300 NTD
    Liabilities:Payable:tokyo-trip  -300 NTD @NAT
`);
    expect(codes(h)).toEqual([]);
    expect(progress(h)).toEqual([
      "Assets:Receivable:tokyo-trip NTD [NAT] 300/0/300 open -",
      "Liabilities:Payable:tokyo-trip NTD [NAT] 300/0/300 open -",
    ]);
  });
  it("on payable, a negative posting is lending and a positive one repayment", () => {
    const h = load(`
2026-10-01 * "Borrowed"
    Bank:Checking                    5000 NTD
    Liabilities:Payable:loan-1001   -5000 NTD @NAT

2026-10-10 * "Paid back part"
    Liabilities:Payable:loan-1001    2000 NTD
    Bank:Checking                   -2000 NTD
`);
    expect(progress(h)).toEqual([
      "Liabilities:Payable:loan-1001 NTD [NAT] 5000/2000/3000 open 2026-10-10",
    ]);
    expect(balanceOf(h, "Liabilities:Payable:loan-1001", "2026-10-31")).toBe("-3000");
  });
  it("may stand under any root, type rules still applying to its postings", () => {
    const h = ledger(`
account Expenses:Shared
    obligation payable
account Pocket:Lent
    obligation receivable

2026-10-11 * "NAT paid my share"
    Expenses:Shared:a    -100 NTD [2026-10-12] @NAT
    Assets:Cash           100 NTD

2026-10-12 * "Lent to KEN"
    Pocket:Lent:b         200 NTD @KEN
    Assets:Cash          -200 NTD
`);
    expect(codes(h)).toEqual(["posting.pnl-effective"]);
    expect(h.accounts.find((a) => a.id === "Expenses:Shared:a")?.type).toBe("expense");
    const untyped = h.accounts.find((a) => a.id === "Pocket:Lent:b");
    expect(untyped?.obligation).toBe("receivable");
    expect(untyped).not.toHaveProperty("type");
    expect(progress(h)).toEqual([
      "Expenses:Shared:a NTD [NAT] 100/0/100 open -",
      "Pocket:Lent:b NTD [KEN] 200/0/200 open -",
    ]);
  });
});

describe("the obligations function", () => {
  const h = load(`
account Bank:Checking
    primary NTD

2026-10-01 * "Two loans"
    Assets:Receivable:b              100 NTD @NAT
    Assets:Receivable:a:x            100 NTD @NAT
    Assets:Receivable:a              100 NTD @KEN
    Assets:Receivable:a-b            100 NTD @AMY
    Assets:Receivable:a-b             10 USD @AMY @KEN
    Assets:Cash                     -400 NTD
    Assets:Cash                      -10 USD
`);
  it("sorts rows by account, segment by segment, then by commodity", () => {
    expect(obligations(h).map((r) => `${r.account} ${r.commodity}`)).toEqual([
      "Assets:Receivable:a NTD",
      "Assets:Receivable:a-b NTD",
      "Assets:Receivable:a-b USD",
      "Assets:Receivable:b NTD",
    ]);
    expect(obligations(h).find((r) => r.commodity === "USD")?.entities).toEqual(["AMY", "KEN"]);
  });
  it("takes obligation accounts or obligations", () => {
    expect(obligations(h, { accounts: ["Assets:Receivable:b"] }).map((r) => r.account)).toEqual([
      "Assets:Receivable:b",
    ]);
    expect(obligations(h, { accounts: ["Assets:Receivable"] })).toHaveLength(4);
    expect(obligations(h, { accounts: ["Liabilities:Payable"] })).toEqual([]);
  });
  it("an account that is not an obligation account and not inside one matches nothing", () => {
    expect(obligations(h, { accounts: ["Assets"] })).toEqual([]);
    expect(obligations(h, { accounts: ["Bank:Checking"] })).toEqual([]);
    expect(obligations(h, { accounts: ["Assets:Nowhere"] })).toEqual([]);
  });
  it("counts an empty list of accounts as none given", () => {
    expect(obligations(h, { accounts: [] })).toEqual(obligations(h));
    expect(obligations(h, { accounts: [] })).toHaveLength(4);
  });
  it("an entity with no obligation matches nothing", () => {
    expect(obligations(h, { entity: "BOB" })).toEqual([]);
  });
  it("throws when at is rejected", () => {
    expect(() => obligations(h, { at: "2026-13" })).toThrow(/parse\.invalid-time/);
    expect(() => obligations(h, { at: "2026-10-31T12:00" })).toThrow(/query\.time-of-day/);
  });
  it("throws before initialization", () => {
    expect(() => obligations(new Hueke())).toThrow();
  });
  it("counts every posting without at", () => {
    expect(obligations(h)).toEqual(obligations(h, { at: "2026-12-31" }));
  });
});

describe("hiding settled obligations with combined income and expense", () => {
  const SHARED = `
option income-expense on

account Expenses:Shared
    obligation payable

2026-10-11 * "NAT paid my share"
    Expenses:Shared:a    -100 NTD @NAT
    Assets:Cash           100 NTD

2026-10-15 * "Paid NAT back"
    Expenses:Shared:a     100 NTD
    Assets:Cash          -100 NTD
`;
  const h = ledger(SHARED);
  const shared = query(h).accounts("Expenses:Shared");

  it("is an obligation of type expense", () => {
    expect(codes(h)).toEqual([]);
    expect(h.accounts.find((a) => a.id === "Expenses:Shared:a")?.type).toBe("expense");
  });
  it("leaves out the settled obligation under its merged name", () => {
    expect(allRows(balance(h, shared))).toEqual([
      "IncomeExpenses (subtotal) 0 NTD",
      "IncomeExpenses:Shared (subtotal) 0 NTD",
    ]);
  });
  it("lists it with all", () => {
    expect(allRows(balance(h, shared, { all: true }))).toEqual([
      "IncomeExpenses (subtotal) 0 NTD",
      "IncomeExpenses:Shared (subtotal) 0 NTD",
      "IncomeExpenses:Shared:a 0 NTD",
    ]);
  });
  it("lists it while open", () => {
    expect(allRows(balance(h, shared.until("2026-10-14")))).toEqual([
      "IncomeExpenses (subtotal) -100 NTD",
      "IncomeExpenses:Shared (subtotal) -100 NTD",
      "IncomeExpenses:Shared:a -100 NTD",
    ]);
  });
  it("obligations keeps the name as written", () => {
    expect(progress(h, { all: true })).toEqual([
      "Expenses:Shared:a NTD [NAT] 100/100/0 settled 2026-10-15",
    ]);
  });
  it("keeps a merged row that also counts another account's postings", () => {
    const g = ledger(`${SHARED}
2026-10-16 * "Sold a ticket"
    Assets:Cash         50 NTD
    Income:Shared:a    -50 NTD
`);
    expect(codes(g)).toEqual([]);
    expect(rows(balance(g))).toContain("IncomeExpenses:Shared:a -50 NTD");
  });
});

describe("a zero-amount posting on an obligation", () => {
  it("is neither lending nor repayment", () => {
    const h = load(`
2026-10-11 * "Lunch"
    Assets:Receivable:lunch-1011    400 NTD @NAT
    Assets:Cash                    -400 NTD

2026-10-15 * "Reminder sent to KEN"
    Assets:Receivable:lunch-1011      0 NTD @KEN
    Assets:Cash                       0 NTD
`);
    expect(codes(h)).toEqual([]);
    const [r] = obligations(h);
    expect(row(r as ObligationProgress)).toBe(
      "Assets:Receivable:lunch-1011 NTD [NAT] 400/0/400 open -",
    );
    expect(r).not.toHaveProperty("lastRepaid");
    expect(r?.postings).toHaveLength(2);
    expect(query(h).entities("KEN").postings()).toEqual([]);
  });
  it("does not give the obligation an entity when nothing else names one", () => {
    const h = load(`
2026-10-11 * "Lunch"
    Assets:Receivable:lunch-1011    400 NTD
    Assets:Cash                    -400 NTD

2026-10-15 * "Note about KEN"
    Assets:Receivable:lunch-1011      0 NTD @KEN
    Assets:Cash                       0 NTD
`);
    expect(codes(h)).toEqual(["obligation.missing-entity"]);
    expect(obligations(h)[0]?.entities).toEqual([]);
  });
});

describe("obligations across modules", () => {
  const ROOT = `option timezone Asia/Taipei
account Assets:Receivable
    obligation receivable
    pad-account Expenses:WriteOff
include 2026/10.hueke
`;
  it("counts lending and repayment written in an included module", () => {
    const h = modules({
      "main.hueke": `${ROOT}
2026-10-20 * "NAT pays the rest"
    Bank:Checking                   150 NTD
    Assets:Receivable:lunch-1011   -150 NTD
`,
      "2026/10.hueke": `
2026-10-11 * "Lunch"
    Assets:Receivable:lunch-1011    400 NTD @NAT
    Assets:Cash                    -400 NTD

2026-10-15 * "NAT pays back"
    Bank:Checking                   250 NTD
    Assets:Receivable:lunch-1011   -250 NTD
`,
    });
    expect(codes(h)).toEqual([]);
    expect(progress(h, { at: "2026-10-15" })).toEqual([
      "Assets:Receivable:lunch-1011 NTD [NAT] 400/250/150 open 2026-10-15",
    ]);
    expect(progress(h)).toEqual([]);
    expect(progress(h, { all: true })).toEqual([
      "Assets:Receivable:lunch-1011 NTD [NAT] 400/400/0 settled 2026-10-20",
    ]);
    expect(query(h).entities("NAT").postings()).toHaveLength(3);
  });
  it("reports mistakes on obligation postings in the module they are written in", () => {
    const h = modules({
      "main.hueke": ROOT,
      "2026/10.hueke": `
2026-10-11 * "Lunch"
    Assets:Receivable:lunch-1011    400 NTD
    Assets:Cash                    -400 NTD

2026-10-12 * "Breakfast"
    Assets:Receivable                80 NTD @NAT
    Assets:Cash                     -80 NTD
`,
    });
    expect(
      check(h)
        .filter((d) => d.code.startsWith("obligation."))
        .map((d) => `${d.code} ${String(d.source)}`),
    ).toEqual(["obligation.missing-entity 2026/10.hueke", "obligation.root-posting 2026/10.hueke"]);
  });
  it("closes an obligation of an included module with a pad in the root", () => {
    const h = modules({
      "main.hueke": `${ROOT}
2026-10-20 balance Assets:Receivable:lunch-1011 0 NTD pad -400 NTD
`,
      "2026/10.hueke": `
2026-10-11 * "Lunch"
    Assets:Receivable:lunch-1011    400 NTD @NAT
    Assets:Cash                    -400 NTD
`,
    });
    expect(codes(h)).toEqual([]);
    expect(generated(h)).toEqual([
      "Assets:Receivable:lunch-1011 -400 NTD",
      "Expenses:WriteOff 400 NTD",
    ]);
    expect(progress(h)).toEqual([]);
  });
});

describe("accounts inside an obligation", () => {
  const SNACK = `
2026-10-12 * "Late snack"
    Expenses:Food                        120 NTD
    Assets:Receivable:NAT:snack-1012     120 NTD @NAT
    Assets:Cash                         -240 NTD
`;
  const SNACK_ACCOUNT = "Assets:Receivable:NAT:snack-1012";
  /** The start of each obligation.nested, which must have a span, in text order. */
  const nested = (h: Hueke): number[] =>
    diagnostics(h, "obligation.nested")
      .map((d) => {
        if (!d.span) throw new Error("obligation.nested without a span");
        return d.span.start;
      })
      .sort((a, b) => a - b);
  /** The start of the snack's posting on the account inside the obligation. */
  const snackPosting = (h: Hueke): number | undefined =>
    h.transactions
      .find((t) => t.description === "Late snack")
      ?.postings.find((p) => p.account === SNACK_ACCOUNT)?.span?.start;

  it("inherit the obligation and the pad account", () => {
    const h = load(SNACK);
    expect(codes(h)).toEqual(["obligation.nested"]);
    const a = h.accounts.find((x) => x.id === "Assets:Receivable:NAT:snack-1012");
    expect(a?.obligation).toBe("receivable");
    expect(a?.padAccount).toBe("Expenses:WriteOff");
  });
  it("an obligation declared on its own still inherits the pad account", () => {
    const h = load(`account Assets:Receivable:lunch-1011\n    display-name Lunch\n`);
    expect(codes(h)).toEqual([]);
    const a = h.accounts.find((x) => x.id === "Assets:Receivable:lunch-1011");
    expect(a?.obligation).toBe("receivable");
    expect(a?.padAccount).toBe("Expenses:WriteOff");
  });
  it("need no declaration in strict mode", () => {
    const h = load(`option strict account\n\naccount Expenses:Food\n${SNACK}`);
    expect(codes(h)).toEqual(["obligation.nested"]);
  });
  it("a pad on one without padding generates nothing", () => {
    const h = load(`${SNACK}
2026-10-20 balance Assets:Receivable:NAT:snack-1012 0 NTD pad
`);
    expect(codes(h).sort()).toEqual([
      "balance.pad-needs-amount",
      "obligation.nested",
      "obligation.nested",
    ]);
    expect(nested(h)).toEqual([snackPosting(h), h.balances[0]?.span?.start]);
    expect(generated(h)).toEqual([]);
  });
  it("a pad on one with padding writes off to the inherited pad account", () => {
    const h = load(`${SNACK}
2026-10-20 balance Assets:Receivable:NAT:snack-1012 0 NTD pad -120 NTD
`);
    // Once on the written posting and once on the Balance; never on the generated posting.
    expect(codes(h)).toEqual(["obligation.nested", "obligation.nested"]);
    expect(nested(h)).toEqual([snackPosting(h), h.balances[0]?.span?.start]);
    expect(generated(h)).toEqual([
      "Assets:Receivable:NAT:snack-1012 -120 NTD",
      "Expenses:WriteOff 120 NTD",
    ]);
    expect(balanceOf(h, "Assets:Receivable:NAT:snack-1012", "2026-10-31")).toBe("0");
  });
  it("a hard Balance on one is reported on the Balance", () => {
    const h = load(`${SNACK}
2026-10-20 balance Assets:Receivable:NAT:snack-1012 120 NTD
`);
    expect(codes(h)).toEqual(["obligation.nested", "obligation.nested"]);
    expect(nested(h)).toEqual([snackPosting(h), h.balances[0]?.span?.start]);
  });
  it("an account declaration of one is reported on the declaration", () => {
    const h = load(`account Assets:Receivable:NAT:snack-1012\n    display-name Snack\n`);
    expect(codes(h)).toEqual(["obligation.nested"]);
    const declared = h.accounts.find((a) => a.id === SNACK_ACCOUNT);
    expect(declared?.span).toBeDefined();
    expect(nested(h)).toEqual([declared?.span?.start]);
  });
  it("an account declaration of one that also declares obligation is reported once", () => {
    const h = load(`account Assets:Receivable:NAT:snack-1012\n    obligation payable\n`);
    expect(codes(h)).toEqual(["obligation.nested"]);
    const declared = h.accounts.find((a) => a.id === SNACK_ACCOUNT);
    expect(nested(h)).toEqual([declared?.span?.start]);
    expect(declared?.obligation).toBe("receivable");
  });
});

describe("where an account stands among obligations", () => {
  const ROOTS = `
account Payable
    obligation payable
`;
  /** A ledger with one lending posting on `account`, naming an entity. */
  const lend = (account: string): Hueke =>
    load(
      `
2026-10-11 * "Lent"
    ${account}    100 NTD @NAT
    Assets:Cash  -100 NTD
`,
      ROOTS,
    );
  /** The diagnostics and the obligations of `lend(account)`. */
  const placed = (account: string) => {
    const h = lend(account);
    return { codes: codes(h), rows: obligations(h).map((r) => r.account) };
  };

  it.each([["Assets:Receivable"], ["Liabilities:Payable"], ["Payable"]])(
    "a posting on the obligation account %s belongs to no obligation",
    (account) => {
      expect(placed(account)).toEqual({ codes: ["obligation.root-posting"], rows: [] });
    },
  );
  it.each([["Assets:Receivable:alice-2026-10"], ["Liabilities:Payable:bob"], ["Payable:bob"]])(
    "%s, a direct sub-account, is one obligation",
    (account) => {
      expect(placed(account)).toEqual({ codes: [], rows: [account] });
    },
  );
  it.each([
    ["Assets:Receivable:alice-2026-10:interest"],
    ["Assets:Receivable:alice-2026-10:interest:late"],
    ["Payable:bob:fee"],
  ])("%s is inside an obligation", (account) => {
    expect(placed(account)).toEqual({ codes: ["obligation.nested"], rows: [] });
  });
  it.each([
    ["Assets"],
    ["Assets:Bank:Checking"],
    ["Assets:Receivable2"],
    ["Assets:Receivable2:x"],
    ["Assets:ReceivableX:y:z"],
    ["Liabilities"],
    ["Payables:bob"],
    ["Receivable:alice"],
  ])("%s, whose name only looks alike, is outside every obligation", (account) => {
    expect(placed(account)).toEqual({ codes: [], rows: [] });
    const h = lend(account);
    expect(h.accounts.find((a) => a.id === account)).not.toHaveProperty("obligation");
    expect(obligations(h, { accounts: [account] })).toEqual([]);
  });
  it("the outermost obligation account wins", () => {
    const h = load(`
account Assets:Receivable:alice
    obligation receivable

2026-10-11 * "Lent"
    Assets:Receivable:alice      100 NTD @NAT
    Assets:Receivable:alice:x     50 NTD @NAT
    Assets:Cash                 -150 NTD
`);
    // Once on the declaration and once on the posting inside the obligation.
    expect(codes(h)).toEqual(["obligation.nested", "obligation.nested"]);
    expect(progress(h)).toEqual(["Assets:Receivable:alice NTD [NAT] 100/0/100 open -"]);
  });
});
