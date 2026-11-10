// docs/core/ledger.md
import { describe, expect, it } from "vitest";
import { check, Hueke, parse, position } from "../../srcs/index.js";
import type { Diagnostic } from "../../srcs/index.js";
import { balanceOf, codes, descriptions, diagnostics, ledger, modules } from "./ledger.js";

const LUNCH = `2026-10-12 * "Lunch"\n    Expenses:Food  180 NTD\n    Assets:Cash\n`;

describe("unsupported syntax", () => {
  it.each([
    [
      "split",
      '2026-10-12 "x"\n    Expenses:Food  2 NTD\n        split @NAT @AMY\n    Assets:Cash\n',
    ],
    [
      "paid-by",
      '2026-10-12 "x"\n    Expenses:Food  2 NTD\n        paid-by @NAT\n    Assets:Cash\n',
    ],
    ["a shared root", "account-root Trip shared\n"],
    [
      "a statement cycle",
      "account Liabilities:Card\n    statement\n        from 2026-01-25\n        every 1 month\n",
    ],
    ["an entity type", "entity NAT\n    type person\n"],
    ["share", '2026-10-12 "x"\n    share @NAT @AMY\n    Expenses:Food  2 NTD\n    Assets:Cash\n'],
    [
      "into",
      '2026-10-12 "x"\n    into Assets:Receivables\n    Expenses:Food  2 NTD\n    Assets:Cash\n',
    ],
    ["schedule", 'schedule %rent "Rent"\n'],
    ["installment", 'installment %phone "Phone"\n'],
    ["rule", "rule %tax\n"],
    [
      "a rule with segments, fixed and cap-group",
      "rule %dining\n    active 2026-01..2026-06\n    rate 2%\n    cap 300 NTD per month\n" +
        "    cap 1000 NTD per year\n    active 2026-07..\n    fixed 15 NTD\n    cap-group cashback\n" +
        "    Income:Cashback  amount\n    Liabilities:Card\n",
    ],
    ["module", 'module trip shared "trip.hueke"\n'],
    ["an account active", "account Assets:Wallet\n    active 2026-01-01\n"],
    ["an account allow", "account Assets:Wallet\n    allow NTD\n"],
    ["an account deny", "account Assets:Wallet\n    deny NTD\n"],
    ["an account source", "account Assets:Wallet\n    source bank\n"],
    ["an account self", "account Assets:Wallet\n    self\n"],
    ["an account map", "account Assets:Wallet\n    map Cash\n"],
  ])("%s is reported and not loaded", (_, text) => {
    const h = ledger(`${text}\n${LUNCH}`);
    expect(codes(h)).toEqual(["syntax.unsupported"]);
    expect(h.transactions).toHaveLength(1);
    expect(balanceOf(h, "Assets:Cash", "2026-10-31")).toBe("-180");
  });
  it.each([
    ["installment", "#installment:phone"],
    ["statement", "#statement:card"],
    ["fulfills", "#fulfills:order"],
    ["rule", "#rule:tax"],
    ["shared", "#shared:trip:hotel"],
  ])("a tag with the scope %s does not load its transaction", (_, tag) => {
    for (const text of [
      `2026-10-13 * "Dinner" ${tag}\n    Expenses:Food  300 NTD\n    Assets:Cash\n`,
      `2026-10-13 * "Dinner"\n    Expenses:Food  300 NTD  ${tag}\n    Assets:Cash\n`,
    ]) {
      const h = ledger(`${text}\n${LUNCH}`);
      expect(codes(h)).toEqual(["syntax.unsupported"]);
      expect(h.transactions).toHaveLength(1);
      expect(balanceOf(h, "Assets:Cash", "2026-10-31")).toBe("-180");
    }
  });
  it.each([
    ["on a header's anchor", '2026-10-13 * %rent/2026-11 "Rent"\n'],
    ["on a tag", '2026-10-13 * "Trip" #trip/2026-10\n'],
    ["on a scoped tag", '2026-10-13 * "Card" #statement:card/n3\n'],
  ])("a period %s does not load the transaction", (_, header) => {
    const h = ledger(`${header}    Expenses:Food  300 NTD\n    Assets:Cash\n\n${LUNCH}`);
    expect(codes(h)).toEqual(["syntax.unsupported"]);
    expect(h.transactions).toHaveLength(1);
  });
  it("names what is not supported", () => {
    const h = ledger('schedule %rent "Rent"\n');
    expect(check(h)[0]?.message).toBe("schedule is not supported yet");
  });
});

describe("a root that was never loaded", () => {
  it("is module.missing and the ledger is empty", () => {
    const h = modules({ "other.hueke": LUNCH }, "main.hueke", { timezone: "Europe/Paris" });
    expect(codes(h, true)).toEqual(["module.missing"]);
    expect(h.transactions).toEqual([]);
    expect(h.accounts).toEqual([]);
    expect(h.commodities).toEqual([]);
    expect(h.roots).toEqual([]);
    expect(h.entities).toEqual([]);
    expect(h.settings).toEqual({
      timezone: "UTC",
      weekStart: "monday",
      strict: [],
      decimalMark: ".",
      groupMark: ",",
    });
  });
});

describe("loading and initialization", () => {
  const TEXT = `option timezone UTC\n${LUNCH}`;

  it("throws on load after init, on a second init and on check before init", () => {
    const h = new Hueke();
    expect(() => check(h)).toThrow();
    h.init("main.hueke");
    expect(() => {
      h.init("main.hueke");
    }).toThrow();
    expect(() => {
      h.load("main.hueke", parse("main.hueke", TEXT));
    }).toThrow();
  });
  it("replaces a module loaded again under the same path", () => {
    const h = new Hueke();
    h.load("main.hueke", parse("main.hueke", "option timezone UTC\n"));
    h.load("main.hueke", parse("main.hueke", TEXT));
    h.init("main.hueke");
    expect(descriptions(h.transactions)).toEqual(["Lunch"]);
  });
  it("does not depend on the order of loading", () => {
    const files = { "main.hueke": `${TEXT}include sub.hueke\n`, "sub.hueke": LUNCH };
    const reversed = Object.fromEntries(Object.entries(files).reverse());
    const ids = (h: Hueke) => h.transactions.map((t) => `${t.id} ${t.source ?? ""}`);
    expect(ids(modules(reversed))).toEqual(ids(modules(files)));
    expect(ids(modules(files))).toEqual(["~1 main.hueke", "~2 sub.hueke"]);
  });
});

describe("source positions", () => {
  it("gives a record a span over its whole block, and the module its line starts", () => {
    const text =
      '2026-10-12 * "Lunch"\n    Expenses:Food 180 NTD\n        - Rice  = 50\n    ; afterthought\n\n2026-10-13 "x"\n';
    const data = parse("main.hueke", text);
    const [first] = data.items;
    expect(first && text.slice(first.span?.start, first.span?.end)).toBe(
      '2026-10-12 * "Lunch"\n    Expenses:Food 180 NTD\n        - Rice  = 50\n    ; afterthought',
    );
    expect(data.lineStarts).toEqual([0, 21, 47, 68, 87, 88, 103]);
  });
  it("gives a derived record the span of the block it was written in", () => {
    const text = `option timezone UTC\n${LUNCH}`;
    const h = modules({ "main.hueke": text });
    const [lunch] = h.transactions;
    expect(lunch?.span && text.slice(lunch.span.start, lunch.span.end)).toBe(LUNCH.trimEnd());
    expect(
      lunch?.postings[1]?.span &&
        text.slice(lunch.postings[1].span.start, lunch.postings[1].span.end),
    ).toBe("Assets:Cash");
  });
  it("keeps the module's text exactly as parsed", () => {
    const text =
      'option timezone UTC\r\n2026-10-12 "Lunch"\n    Expenses:Food  180 NTD\n    Assets:Cash';
    expect(parse("main.hueke", text).text).toBe(text);
  });
  it("counts offsets and columns in UTF-16 code units", () => {
    const text = '2026-10-12 "🍜 Ramen" #x\n';
    const data = parse("main.hueke", text);
    expect(data.items[0]?.span?.end).toBe(text.indexOf("#x") + 2);
    expect(position(data, text.indexOf("#x"))).toEqual({ line: 1, column: text.indexOf("#x") + 1 });
  });
});

describe("strict mode", () => {
  const UNDECLARED = `
2026-10-12 * "Lunch" @NAT
    Expenses:Food     180 NTD
    Assets:Cash      -180 NTD

2026-10-13 * "Gave points to a friend" @KEN
    Expenses:Other     1 POINT
    Assets:Points     -1 POINT
`;
  const undeclared = (h: Hueke): string[] =>
    diagnostics(h, "strict.undeclared").map((d) => d.message);

  it("normal mode", () => {
    expect(codes(ledger(UNDECLARED), true)).toEqual(["name.inferred-commodity"]);
  });
  it("every kind", () => {
    const h = ledger(`option strict account, commodity, entity\n${UNDECLARED}`);
    expect(codes(h, true).every((c) => c === "strict.undeclared")).toBe(true);
    const messages = undeclared(h).join("\n");
    for (const name of ["Expenses:Food", "Expenses:Other", "Assets:Points", "POINT", "NAT", "KEN"])
      expect(messages).toContain(name);
    expect(messages).not.toContain("Assets:Cash");
  });
  it("strict mode given when creating the ledger is strict mode for every kind", () => {
    const h = ledger(`option strict account\n${UNDECLARED}`, { strict: true });
    expect(h.settings.strict).toEqual(["account", "commodity", "entity"]);
    expect(undeclared(h)).toEqual(
      undeclared(ledger(`option strict account, commodity, entity\n${UNDECLARED}`)),
    );
  });
  it("entities only", () => {
    const h = ledger(`option strict entity\n\nentity NAT\n${UNDECLARED}`);
    expect(codes(h)).toEqual(["strict.undeclared"]);
    expect(undeclared(h)[0]).toContain("KEN");
  });
  it("commodities only", () => {
    const h = ledger(`option strict commodity\n${UNDECLARED}`);
    expect(codes(h, true)).toEqual(["strict.undeclared"]);
    expect(undeclared(h)[0]).toContain("POINT");
  });
});

describe("duplicate declarations", () => {
  /** The start offset of the n-th item of the root module. */
  const startOf = (h: Hueke, index: number): number => {
    const start = h.data.get("main.hueke")?.items.at(index)?.span?.start;
    if (start === undefined) throw new Error(`no item ${String(index)}`);
    return start;
  };
  /** The 1-based line of the n-th item of the root module, as the message names it. */
  const lineOf = (h: Hueke, index: number): string => {
    const data = h.data.get("main.hueke");
    return `main.hueke:${String(data ? position(data, startOf(h, index)).line : 0)}`;
  };
  const duplicates = (h: Hueke): Diagnostic[] => diagnostics(h, "declaration.duplicate");

  it.each([
    ["normal mode", ""],
    ["strict account", "option strict account\n"],
    ["strict commodity", "option strict commodity\n"],
  ])("keeps the first account root and reports the later one in %s", (_, strict) => {
    const h = ledger(`${strict}account-root Bank asset\naccount-root Bank liability\n`);
    expect(codes(h, true)).toEqual(["declaration.duplicate"]);
    expect(h.roots.find((r) => r.name === "Bank")?.type).toBe("asset");
    const [d] = duplicates(h);
    expect(d?.severity).toBe("error");
    expect(d?.source).toBe("main.hueke");
    expect(d?.span?.start).toBe(startOf(h, -1));
    expect(d?.message).toContain(lineOf(h, -2));
  });
  it("reports a built-in root declared twice", () => {
    const h = ledger("account-root Assets liability\naccount-root Assets asset\n");
    expect(codes(h, true)).toEqual(["declaration.duplicate"]);
    expect(h.roots.find((r) => r.name === "Assets")?.type).toBe("liability");
  });
  it.each([
    ["normal mode", ""],
    ["strict commodity", "option strict commodity\n"],
  ])("keeps the first commodity in %s", (_, strict) => {
    const h = ledger(`${strict}commodity NTD\n    precision 0\ncommodity NTD\n    precision 2\n`);
    expect(codes(h, true)).toEqual(["declaration.duplicate"]);
    expect(h.commodities.filter((c) => c.id === "NTD")).toHaveLength(1);
    expect(h.commodities.find((c) => c.id === "NTD")?.precision).toBe(0);
    expect(duplicates(h)[0]?.span?.start).toBe(startOf(h, -1));
    expect(duplicates(h)[0]?.message).toContain(lineOf(h, -2));
  });
  it.each([
    ["normal mode", ""],
    ["strict account", "option strict account\n"],
  ])("keeps the first account in %s", (_, strict) => {
    const text = "account Bank:Checking\n    primary NTD\naccount Bank:Checking\n    primary USD\n";
    const h = ledger(`${strict}${text}`);
    expect(codes(h, true)).toEqual(["declaration.duplicate"]);
    expect(h.accounts.filter((a) => a.id === "Bank:Checking")).toHaveLength(1);
    expect(h.accounts.find((a) => a.id === "Bank:Checking")?.primaryCommodity).toBe("NTD");
    expect(duplicates(h)[0]?.message).toContain(lineOf(h, -2));
  });
  it.each([
    ["normal mode", ""],
    ["strict entity", "option strict entity\n"],
  ])("keeps the first entity in %s", (_, strict) => {
    const h = ledger(
      `${strict}entity NAT\n    display-name Nat\nentity NAT\n    display-name Nathan\n`,
    );
    expect(codes(h, true)).toEqual(["declaration.duplicate"]);
    expect(h.entities).toHaveLength(1);
    expect(h.entities[0]?.displayName).toBe("Nat");
    expect(duplicates(h)[0]?.message).toContain(lineOf(h, -2));
  });
  it("reports each later declaration", () => {
    const h = ledger("commodity MILE\ncommodity MILE\ncommodity MILE\n");
    const ds = duplicates(h);
    expect(ds).toHaveLength(2);
    for (const d of ds) expect(d.message).toContain(lineOf(h, -3));
  });
  it("is reported by strict mode given when creating the ledger as well", () => {
    const h = ledger("commodity MILE\ncommodity MILE\n", { strict: true });
    expect(codes(h, true)).toEqual(["declaration.duplicate"]);
  });
});

describe("objects used without a declaration", () => {
  it("lists entities declared first, then those used, in the order of first use", () => {
    const h = ledger(`
2026-10-12 * "Lunch" @NAT
    Expenses:Food     180 NTD  @AMY
    Assets:Cash      -180 NTD

entity KEN

2026-10-01 * "Earlier, written later" @BOB
    Expenses:Food     100 NTD
    Assets:Cash      -100 NTD
`);
    expect(h.entities.map((e) => e.id)).toEqual(["KEN", "NAT", "AMY", "BOB"]);
  });
  it("are created in the order of their first use in the source", () => {
    const h = ledger(`
2026-10-20 * "Written first, later in time"
    Spending:Late     1 POINT
    Assets:Cash      -1 POINT

2026-10-01 balance Saving:Early 0 MILE

2026-10-05 * "Written last, earliest"
    Gifts:Earliest     1 NTD
    Assets:Cash       -1 NTD
`);
    const declared = new Set(["Assets:Cash", "Liabilities:CardInstallments"]);
    expect(h.accounts.map((a) => a.id).filter((id) => !declared.has(id))).toEqual([
      "Spending:Late",
      "Saving:Early",
      "Gifts:Earliest",
    ]);
    expect(h.commodities.slice(-2).map((c) => c.id)).toEqual(["POINT", "MILE"]);
    expect(
      check(h)
        .filter((d) => d.severity === "info")
        .map((d) => d.message.split(":")[0]),
    ).toEqual([
      "Spending",
      "commodity POINT is not declared",
      "Saving",
      "commodity MILE is not declared",
      "Gifts",
    ]);
  });
});

describe("IDs", () => {
  it("numbers transactions without an anchor in source order and postings within their transaction", () => {
    const h = ledger(`
2026-10-12 * "Lunch"
    Expenses:Food     180 NTD
    Assets:Cash      -180 NTD

2026-10-01 * %rent "Rent"
    Expenses:Housing  20000 NTD  %rent-cost
    Assets:Cash      -20000 NTD

2026-10-05 * "Coffee"
    Expenses:Food      90 NTD
    Assets:Cash       -90 NTD
`);
    expect(codes(h)).toEqual([]);
    expect(h.transactions.map((t) => [t.id, t.postings.map((p) => p.id)])).toEqual([
      ["rent", ["rent-cost", "rent.2"]],
      ["~2", ["~2.1", "~2.2"]],
      ["~1", ["~1.1", "~1.2"]],
    ]);
  });
  it("numbers the transactions pad generates in expansion order", () => {
    const h = ledger(`
2026-10-25 balance Bank:Checking 100 NTD pad -> Equity:Opening
2026-10-31 balance Bank:Checking 300 NTD pad -> Equity:Opening
`);
    expect(codes(h)).toEqual([]);
    expect(h.transactions.map((t) => [t.id, t.postings.map((p) => p.id)])).toEqual([
      ["~balance.1", ["~balance.1.1", "~balance.1.2"]],
      ["~balance.2", ["~balance.2.1", "~balance.2.2"]],
    ]);
  });
  it("gives a number to a transaction dropped while loading", () => {
    const h = ledger(`
2026-10-01 * "Not inferable"
    Expenses:Food
    Assets:Cash

2026-10-02 * "Card payment" #statement:card
    Liabilities:Card     900 NTD
    Bank:Checking       -900 NTD

2026-10-03 * "Lunch"
    Expenses:Food     180 NTD
    Assets:Cash      -180 NTD
`);
    expect(codes(h).sort()).toEqual(["syntax.unsupported", "txn.amount-not-inferable"]);
    expect(h.transactions.map((t) => t.id)).toEqual(["~3"]);
  });
  it("gives no number to a block that could not be parsed", () => {
    const h = ledger(`
2026-10-01 * "Broken
    Liabilities:Card     900 NTD
    Bank:Checking       -900 NTD

2026-10-03 * "Lunch"
    Expenses:Food     180 NTD
    Assets:Cash      -180 NTD
`);
    expect(codes(h)).toEqual(["parse.unterminated-string"]);
    expect(h.transactions.map((t) => t.id)).toEqual(["~1"]);
  });

  it("an anchor defined more than once is no record's ID", () => {
    const h = ledger(`
2026-10-03 * "Before"
    Expenses:Other     100 NTD
    Assets:Cash       -100 NTD

2026-10-04 * %t_x "First"
    Expenses:Other     200 NTD  %p_x
    Assets:Cash       -200 NTD  %t_x

2026-10-05 * "After"
    Expenses:Other     300 NTD
    Assets:Cash       -300 NTD
`);
    expect(codes(h)).toEqual(["anchor.duplicate"]);
    const [, first] = h.transactions;
    expect(first?.id).toBe("~2");
    expect(first?.postings.map((p) => p.id)).toEqual(["p_x", "~2.2"]);
    expect(h.transactions.map((t) => t.id)).toEqual(["~1", "~2", "~3"]);
  });
});
