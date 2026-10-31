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
    expect(d && "amount" in d).toBe(false);
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
      'rule %cashback "Rewards"\n    from 2026-01-01\n    rate 1%\n    Assets:Rewards  amount\n    Income:Rewards  -amount\n',
    );
    expect(diagnostics).toEqual([]);
    const rule = items[0] as DeclarationData;
    expect(rule.postings.map((p: PostingData) => p.slot)).toEqual([
      { name: "amount", negated: false },
      { name: "amount", negated: true },
    ]);
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

  it("reads quoted Metadata values and rejects two on a line", () => {
    const text =
      '2026-10-13 * "Dinner"\n    Expenses:Food 300 NTD  ;; a: 1 ; b: 2\n    Assets:Cash -300 NTD\n\n' +
      '2026-10-14 * "Breakfast"\n    Expenses:Food 80 NTD  ;; memo: "extra egg ; no scallions"\n    Assets:Cash -80 NTD\n';
    const data = parse("main.hueke", text);
    expect(data.diagnostics.map((d) => d.code)).toEqual(["parse.syntax"]);
    expect(data.items).toHaveLength(1);
    const [t] = data.items as TransactionData[];
    expect(t?.postings[0]?.trailer).toEqual({
      kind: "meta",
      key: "memo",
      value: "extra egg ; no scallions",
    });
  });

  it("keeps file comments and rejects Metadata before the first record", () => {
    const data = parse("main.hueke", '; About this file\n;; owner: NAT\n\n2026-10-12 "Lunch"\n');
    expect(data.comments.map((c) => c.note.text)).toEqual(["About this file"]);
    expect(data.diagnostics.map((d) => d.code)).toEqual(["parse.orphan-line"]);
    expect(data.items).toHaveLength(1);
  });

  it("rejects ;; without key: value", () => {
    expect(
      codes('2026-10-15 * "Late snack"\n    ;; anything\n    Expenses:Food 120 NTD\n'),
    ).toEqual(["parse.syntax"]);
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

describe("parse: errors stay within a block", () => {
  it("broken blocks do not affect others", () => {
    const data = parse(
      "main.hueke",
      "    Assets:Cash    -50 NTD\n\n" +
        '2026-10-12 * "Lunch"\n    Expenses:Food     180 NTD\n    Assets:Cash    -180 NTD\n\n' +
        '2026-10-13 * "Dinner\n    Expenses:Food     300 NTD\n    Assets:Cash    -300 NTD\n\n' +
        "2026-10-14 balance Assets:Cash\n\n" +
        '2026-10-15 * "Breakfast"\n    Expenses:Food      80 NTD\n    Assets:Cash     -80 NTD\n',
    );
    expect(data.diagnostics.map((d) => d.code)).toEqual([
      "parse.orphan-line",
      "parse.unterminated-string",
      "parse.syntax",
    ]);
    expect((data.items as TransactionData[]).map((t) => t.description)).toEqual([
      "Lunch",
      "Breakfast",
    ]);
  });

  it("token order", () => {
    expect(
      codes(
        '2026-10-11 * "Lunch" %lunch-1011\n    Expenses:Food  600 NTD\n\n' +
          '2026-10-12 * "Paid on behalf"\n    Assets:Receivables:lunch-1012   400 NTD  @NAT %lunch-1012\n\n' +
          '2026-10-21 * "Ramen in Tokyo"\n    Liabilities:CreditCard       -260 NTD #foreign [2026-10-23]\n',
      ),
    ).toEqual(["parse.token-order", "parse.token-order", "parse.token-order"]);
  });

  it("names a module only after #shared:", () => {
    expect(codes('2026-10-18 "Hotel" #refund:trip:hotel\n    Expenses:Travel  100 NTD\n')).toEqual([
      "parse.syntax",
    ]);
  });

  it("status marks", () => {
    expect(codes('2026-10-14 "Withdrawal"\n    ! Assets:Cash      1000 NTD\n')).toEqual([
      "parse.syntax",
    ]);
    expect(codes('2026-10-15 * ! "Two marks"\n')).toEqual(["parse.token-order"]);
    expect(codes('2026-10-14 * "Taxi" # travel\n    Expenses:Transport 300 NTD\n')).toEqual([
      "parse.token-order",
    ]);
    expect(codes('schedule %gym * "Gym membership"\n    from 2026-01-05\n')).toEqual([
      "parse.syntax",
    ]);
    const [cancelled, tagged] = transactions('2026-10-12 # "Lunch"\n2026-10-13 #travel\n');
    expect(cancelled?.mark).toBe("#");
    expect(tagged).toMatchObject({ tags: [{ ref: { name: "travel" } }] });
    expect(tagged?.mark).toBeUndefined();
  });

  it("an account name cannot contain spaces", () => {
    expect(
      codes('2026-10-12 * "Coffee"\n    Expenses:Coffee Shop 150 NTD\n    Assets:Cash -150 NTD\n'),
    ).toEqual(["parse.syntax"]);
  });

  it("properties written twice or in the wrong place", () => {
    expect(
      codes(
        "commodity KRW\n    precision 0\n    precision 2\n\n" +
          "account Assets:Won\n    precision 0\n\n" +
          "commodity guitar-01\n    item\n    precision 0\n",
      ),
    ).toEqual([
      "parse.duplicate-property",
      "parse.unexpected-property",
      "parse.unexpected-property",
    ]);
  });

  it("invalid times", () => {
    expect(
      codes(
        '2026-02-30 * "a"\n    Expenses:Other 100 NTD\n\n2026-13 * "b"\n\n2026-10-12T25:00 * "c"\n\n' +
          '2026-10-12 * "d"\n    Expenses:Other 100 NTD [2026-W54]\n',
      ),
    ).toEqual([
      "parse.invalid-time",
      "parse.invalid-time",
      "parse.invalid-time",
      "parse.invalid-time",
    ]);
  });

  it("gives every item a span over its whole block and the module its line starts", () => {
    const text =
      '2026-10-12 * "Lunch"\n    Expenses:Food 180 NTD\n    ; afterthought\n\n2026-10-13 "x"\n';
    const data = parse("main.hueke", text);
    const [first] = data.items;
    expect(first && text.slice(first.span?.start, first.span?.end)).toBe(
      '2026-10-12 * "Lunch"\n    Expenses:Food 180 NTD\n    ; afterthought',
    );
    expect(data.lineStarts).toEqual([0, 21, 47, 66, 67, 82]);
  });
});

describe("parse: parenthesized amounts", () => {
  it("keeps whitespace inside parentheses in one amount", () => {
    const [t] = transactions(
      '2026-10-12 * "Dinner"\n' +
        "    Expenses:Food  -((100 + 50) * 2)NTD @ (1 / 2) USD\n" +
        "    Assets:Cash  NT$ (1 + 2)\n",
    );
    expect(t?.postings.map((p) => [p.amount, p.price?.amount])).toEqual([
      ["-((100 + 50) * 2)NTD", "(1 / 2) USD"],
      ["NT$ (1 + 2)", undefined],
    ]);
  });
  it("does not join an unclosed parenthesis", () => {
    expect(codes('2026-10-12 * "X"\n    Expenses:Food  (1 + 2 NTD\n')).toEqual(["parse.syntax"]);
  });
  it("rejects parentheses, + and / in an alias", () => {
    for (const alias of ["N(T", "NT)", "+N", "N/T"])
      expect(codes(`commodity NTD\n    alias ${alias} prefix\n`)).toEqual(["parse.syntax"]);
  });
});
