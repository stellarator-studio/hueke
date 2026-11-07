import { describe, expect, it } from "vitest";
import { parse } from "../../../srcs/index.js";
import type { DeclarationData, PostingData, TransactionData } from "../../../srcs/index.js";

const codes = (text: string): string[] => parse("main.hueke", text).diagnostics.map((d) => d.code);
const transactions = (text: string): TransactionData[] =>
  parse("main.hueke", text).items.filter((i): i is TransactionData => i.kind === "transaction");

describe("parse: records", () => {
  it("reads a transaction with every header part", () => {
    const [t] = transactions(
      '2026-11-30=2026-12 * %rent "Rent" @landlord ^home #tag:x #refund:a1 #statement:card/2026-10 #shared:trip:t1 #shared:trip:t2/2026-10\n' +
        "    Expenses:Housing  15000 NTD\n" +
        "    Bank:Checking  -15000 NTD [2026-12-02]\n",
    );
    expect(t).toMatchObject({
      effective: "2026-11-30",
      accounting: "2026-12",
      mark: "*",
      anchor: { name: "rent" },
      description: "Rent",
      refs: ["landlord"],
      primaryTag: { ref: { name: "home" } },
      tags: [
        { scope: "tag", ref: { name: "x" } },
        { scope: "refund", ref: { name: "a1" } },
        { scope: "statement", ref: { name: "card", period: "2026-10" } },
        { scope: "shared", ref: { module: "trip", name: "t1" } },
        { scope: "shared", ref: { module: "trip", name: "t2", period: "2026-10" } },
      ],
    });
    expect(t?.postings[1]).toMatchObject({
      account: "Bank:Checking",
      amount: "-15000 NTD",
      effective: "2026-12-02",
    });
  });

  it("takes a period label or n<number> after an anchor", () => {
    const [t] = transactions(
      '2026-10-25 %card/2026-Q4 "Statement" #statement:card/2026-W45 #x/2026 #y/2026-10-05 #z/n12\n',
    );
    expect([t?.anchor, ...(t?.tags ?? []).map((g) => g.ref)].map((r) => r?.period)).toEqual([
      "2026-Q4",
      "2026-W45",
      "2026",
      "2026-10-05",
      "n12",
    ]);
    for (const bad of ["2026-13", "2026-02-30", "2026-W54"])
      expect(codes(`2026-10-25 "Statement" #card/${bad}\n`)).toEqual(["parse.invalid-time"]);
    for (const bad of ["", "2026-Q5", "n0", "n01", "t1", "2026:10", "n3/x"])
      expect(codes(`2026-10-25 "Statement" #card/${bad}\n`)).toEqual(["parse.syntax"]);
    expect(codes('2026-10-25 "Old form" #shared:trip/t1\n')).toEqual(["parse.syntax"]);
  });

  it("reads a full posting line in order", () => {
    const [t] = transactions(
      '2026-10-21 * "Ramen in Tokyo"\n' +
        "    Expenses:Food  1200 JPY @@ 260 NTD %ramen-1021 @NAT #foreign\n" +
        "    Liabilities:CreditCard  -260 NTD [2026-10-23T09:00[Asia/Tokyo]] #foreign\n",
    );
    expect(t?.postings[0]).toMatchObject({
      amount: "1200 JPY",
      price: { kind: "total", amount: "260 NTD" },
      anchor: { name: "ramen-1021" },
      refs: ["NAT"],
      tags: [{ ref: { name: "foreign" } }],
    });
    expect(t?.postings[1]?.effective).toBe("2026-10-23T09:00[Asia/Tokyo]");
  });

  it("reads costs, prices, aliases and omitted amounts", () => {
    const [t] = transactions(
      '2026-11-20 * "Sold"\n' +
        "    Assets:Brokerage  -5 AAPL {150 USD} @ 170 USD\n" +
        "    Assets:Equipment  -1 camera-01 {{30000 NTD}}\n" +
        "    Expenses:Food  NT$ 180\n" +
        "    Assets:Cash\n",
    );
    const [a, b, c, d] = t?.postings ?? [];
    expect(a).toMatchObject({
      cost: { kind: "unit", amount: "150 USD" },
      price: { kind: "unit", amount: "170 USD" },
    });
    expect(b?.cost).toEqual({ kind: "total", amount: "30000 NTD" });
    expect(c?.amount).toBe("NT$ 180");
    expect(d).toBeDefined();
    expect(d).not.toHaveProperty("amount");
  });

  it("reads a balance with pad", () => {
    const { items } = parse(
      "main.hueke",
      "2026-10-05 balance Liabilities:Payables:hotel @AMY 0 THB pad 3000 THB @@ 2700 NTD -> Bank:Checking\n",
    );
    expect(items[0]).toMatchObject({
      kind: "balance",
      time: "2026-10-05",
      account: "Liabilities:Payables:hotel",
      entity: "AMY",
      amount: "0 THB",
      pad: {
        amount: "3000 THB",
        price: { kind: "total", amount: "2700 NTD" },
        account: "Bank:Checking",
      },
    });
  });

  it("reads declarations, statement children and include", () => {
    const { items, diagnostics } = parse(
      "main.hueke",
      "option timezone Asia/Taipei\n" +
        "include 2026.hueke\n" +
        "commodity NTD\n    precision 0\n    alias NT$ prefix\n" +
        "account Liabilities:CreditCard %esun-card\n    primary NTD\n    statement\n        from 2026-01-25\n" +
        "        ; monthly\n        every 1 month\n    pad-account Expenses:Difference\n",
    );
    expect(diagnostics).toEqual([]);
    const [option, include, commodity, account] = items as DeclarationData[];
    expect(option).toMatchObject({ kind: "option", args: ["timezone", "Asia/Taipei"] });
    expect(include).toMatchObject({ kind: "include", args: ["2026.hueke"] });
    expect(commodity?.lines.map((l) => (l.kind === "property" ? l.key : l.kind))).toEqual([
      "precision",
      "alias",
    ]);
    expect(account?.anchor).toEqual({ name: "esun-card" });
    const statement = account?.lines[1];
    expect(statement?.kind === "property" && statement.children?.map((c) => c.kind)).toEqual([
      "property",
      "note",
      "property",
    ]);
    expect(account?.lines[2]).toMatchObject({ key: "pad-account", value: "Expenses:Difference" });
  });

  it("reads template postings with slots", () => {
    const { items, diagnostics } = parse(
      "main.hueke",
      'rule %cashback "Rewards"\n    active 2026-01-01..\n    rate 1%\n    Assets:Rewards  amount\n    Income:Rewards  -amount\n',
    );
    expect(diagnostics).toEqual([]);
    const rule = items[0] as DeclarationData;
    expect(rule.postings.map((p: PostingData) => p.slot)).toEqual([
      { name: "amount", negated: false },
      { name: "amount", negated: true },
    ]);
  });
});

describe("parse: rule properties", () => {
  const rule = (body: string) =>
    parse(
      "main.hueke",
      `rule %cashback\n${body}    Income:Cashback  amount\n    Liabilities:Card\n`,
    );

  it("starts a segment at each active", () => {
    const { items, diagnostics } = parse(
      "main.hueke",
      "rule %cashback\n    active 2026-01..2026-06\n    rate 1%\n    cap 300 NTD per month\n" +
        "    cap 3000 NTD per year\n    active 2026-07..\n    fixed 15 NTD\n    rounding down\n" +
        "    cap-group main\n    Income:Cashback  amount\n    Liabilities:Card\n",
    );
    expect(diagnostics).toEqual([]);
    expect((items[0] as DeclarationData).lines.map((l) => l.kind === "property" && l.key)).toEqual([
      "active",
      "rate",
      "cap",
      "cap",
      "active",
      "fixed",
      "rounding",
      "cap-group",
    ]);
  });

  it.each([
    ["rate in one segment", "    active 2026..\n    rate 1%\n    rate 2%\n"],
    ["follows across segments", "    follows card\n    active 2026..\n    follows card\n"],
    ["cap-group", "    cap-group a\n    active 2026..\n    cap-group b\n"],
    ["every", "    every 1 month\n    active 2026..\n    every 1 month\n"],
  ])("rejects %s written twice", (_, body) => {
    expect(rule(body).diagnostics.map((d) => d.code)).toEqual(["parse.duplicate-property"]);
  });

  it.each([
    [
      "rate in each segment",
      "    active 2026-01..2026-06\n    rate 1%\n    active 2026-07..\n    rate 2%\n",
    ],
    [
      "rounding in each segment",
      "    active 2026..\n    rounding down\n    active 2027..\n    rounding down\n",
    ],
    ["minimum", "    minimum 100 NTD per posting\n    minimum 1000 NTD per month\n"],
  ])("accepts %s", (_, body) => {
    expect(rule(body).diagnostics).toEqual([]);
  });

  it("does not take from", () => {
    expect(rule("    from 2026-01-01\n").diagnostics.map((d) => d.code)).toEqual([
      "parse.unexpected-property",
    ]);
  });

  it("reserves fixed and cap-group as keywords", () => {
    for (const root of ["fixed", "cap-group"])
      expect(
        parse("main.hueke", `account-root ${root} asset\n`).diagnostics.map((d) => d.code),
      ).toEqual(["parse.syntax"]);
  });
});

describe("parse: notes", () => {
  it("keeps Metadata and comments where they are written", () => {
    const [t] = transactions(
      '2026-10-12 * "Lunch"  ; with colleagues\n' +
        "    ;; rule: record the total, then split it\n" +
        "    ; note: this line is only a comment\n" +
        "    Expenses:Food 180 NTD  ;; note: with colleagues\n" +
        "        - Lunch box  = 120\n" +
        "        ; the drink was a treat\n" +
        "    ;; invoice: AB-1\n" +
        "    Assets:Cash -180 NTD\n",
    );
    expect(t?.trailer).toEqual({ kind: "comment", text: "with colleagues" });
    expect(t?.lines.map((l) => l.kind === "note" && l.note)).toEqual([
      { kind: "meta", key: "rule", value: "record the total, then split it" },
      { kind: "comment", text: "note: this line is only a comment" },
    ]);
    const [food, cash] = t?.postings ?? [];
    expect(food?.trailer).toEqual({ kind: "meta", key: "note", value: "with colleagues" });
    expect(food?.lines.map((l) => l.kind)).toEqual(["breakdown", "note", "note"]);
    expect(cash?.lines).toEqual([]);
  });

  it("continues Metadata on lines indented past its key", () => {
    const data = parse(
      "main.hueke",
      '2026-10-12 * "Lunch"\n' +
        "    ;; memo: First line\n" +
        "    ;;    second line   \n" +
        "    ;;      note: still the memo\n" +
        '    ;;    ""\n' +
        '    ;;    "a ; b"\n' +
        "    ;; summary:\n" +
        "    ;;   Transfer\n" +
        "    ;;     to savings\n" +
        "    ;; next: one line\n" +
        "    Expenses:Food 180 NTD\n" +
        "    Assets:Cash -180 NTD\n",
    );
    expect(data.diagnostics).toEqual([]);
    const [t] = data.items as TransactionData[];
    expect(t?.lines.map((l) => l.kind === "note" && l.note)).toEqual([
      {
        kind: "meta",
        key: "memo",
        value: "First line\nsecond line\n  note: still the memo\n\na ; b",
      },
      { kind: "meta", key: "summary", value: "Transfer\n  to savings" },
      { kind: "meta", key: "next", value: "one line" },
    ]);
    const [memo] = t?.lines ?? [];
    expect(memo?.span).toEqual({ start: 25, end: 133 });
  });

  it("ends multi-line Metadata at any other line, and never continues a trailer", () => {
    expect(
      codes(
        '2026-10-12 * "Lunch"\n    ;; memo: First line\n    ; a comment\n    ;;    second line\n',
      ),
    ).toEqual(["parse.syntax"]);
    expect(
      codes('2026-10-12 * "Lunch"\n    Expenses:Food 180 NTD  ;; memo: First\n    ;;    second\n'),
    ).toEqual(["parse.syntax"]);
    expect(codes('2026-10-12 * "Lunch"\n    ;; memo: First\n    ;;    a ; b\n')).toEqual([
      "parse.syntax",
    ]);
  });

  it("ends multi-line Metadata at a ;; line with no text, and joins a deeper key line", () => {
    const blank = parse(
      "main.hueke",
      '2026-10-12 * "Lunch"\n    ;; memo: a\n    ;;      \n    ;;    b\n',
    );
    expect(blank.diagnostics.map((d) => [d.code, d.span])).toEqual([
      ["parse.syntax", { start: 40, end: 48 }],
    ]);
    const [t] = transactions('2026-10-12 * "Lunch"\n    ;; a: 1\n      ;; b: 2\n\t;;\t\t\t\t\tc\n');
    expect(t?.lines.map((l) => l.kind === "note" && l.note)).toEqual([
      { kind: "meta", key: "a", value: "1\n b: 2\nc" },
    ]);
  });

  it("does not continue a line that is not Metadata", () => {
    const data = parse("main.hueke", '2026-10-12 * "Lunch"\n    ;; TODO fix\n    ;;    b: x\n');
    expect(data.diagnostics.map((d) => [d.code, d.span])).toEqual([
      ["parse.syntax", { start: 25, end: 36 }],
    ]);
  });

  it("splits the breakdown name from its figures at two spaces", () => {
    const [t] = transactions(
      '2026-10-12 * "Breakfast"\n    Expenses:Food 200 NTD\n        - Bubble tea  3cups * 40 = 120\n        - Toast 65\n',
    );
    expect(t?.postings[0]?.lines).toMatchObject([
      { kind: "breakdown", name: "Bubble tea", figure: "3cups * 40 = 120" },
      { kind: "breakdown", name: "Toast 65" },
    ]);
    expect(t?.postings[0]?.lines[1]).not.toHaveProperty("figure");
  });

  it("unquotes a quoted breakdown name", () => {
    const [t] = transactions(
      '2026-10-12 * "Dinner"\n    Expenses:Food 200 NTD\n        - "Rice; large"  = 50\n        - "Say \\"hi\\""\n',
    );
    expect(t?.postings[0]?.lines).toMatchObject([
      { kind: "breakdown", name: "Rice; large", figure: "= 50" },
      { kind: "breakdown", name: 'Say "hi"' },
    ]);
  });

  it("warns about Metadata after a breakdown line and keeps it on the posting", () => {
    const text =
      '2026-10-12 * "Lunch"\n    Expenses:Food 180 NTD\n' +
      "        - Lunch box  = 120  ;; receipt: R-1\n" +
      "        ;; invoice: AB-1\n" +
      "    Assets:Cash -180 NTD\n";
    expect(codes(text)).toEqual([
      "parse.metadata-after-breakdown",
      "parse.metadata-after-breakdown",
    ]);
    const [t] = transactions(text);
    expect(t?.postings[0]?.lines.map((l) => l.kind)).toEqual(["breakdown", "note"]);
  });
});

describe("parse: names", () => {
  it("names a module only after #shared:", () => {
    // Under any other scope, the colon is part of the anchor's name, which an anchor cannot hold.
    expect(codes('2026-10-18 "Hotel" #refund:trip:hotel\n    Expenses:Travel  100 NTD\n')).toEqual([
      "anchor.invalid-name",
    ]);
  });
});

describe("parse: parenthesized amounts", () => {
  it("keeps whitespace inside parentheses in one amount", () => {
    const [t] = transactions(
      '2026-10-12 * "Dinner"\n' +
        "    Expenses:Food  -((100 + 50) * 2)NTD @ (1 / 2) USD\n" +
        "    Assets:Cash  NT$ (1 + 2)\n",
    );
    const [food, cash] = t?.postings ?? [];
    expect([food?.amount, food?.price?.amount]).toEqual(["-((100 + 50) * 2)NTD", "(1 / 2) USD"]);
    expect(cash?.amount).toBe("NT$ (1 + 2)");
    expect(cash).not.toHaveProperty("price");
  });
  it("does not join an unclosed parenthesis", () => {
    expect(codes('2026-10-12 * "X"\n    Expenses:Food  (1 + 2 NTD\n')).toEqual(["parse.syntax"]);
  });
  it("rejects parentheses, + and / in an alias", () => {
    for (const alias of ["N(T", "NT)", "+N", "N/T"])
      expect(codes(`commodity NTD\n    alias ${alias} prefix\n`)).toEqual(["parse.syntax"]);
  });
});
