// Cases for the DSL: line ownership, token order and parse diagnostics.
import { describe, expect, it } from "vitest";
import { balance, check, parse, position, query } from "../../srcs/index.js";
import { balanceOf, codes, ledger, SHARED } from "./ledger.js";

describe("a broken block does not affect others", () => {
  it("loads the other blocks", () => {
    // The orphan line has to be the file's first line, so the case is its own file here.
    const h = ledger(
      `    Assets:Cash    -50 NTD

${SHARED}
2026-10-12 * "Lunch"
    Expenses:Food     180 NTD
    Assets:Cash      -180 NTD

2026-10-13 * "Dinner
    Expenses:Food     300 NTD
    Assets:Cash      -300 NTD

2026-10-14 balance Assets:Cash

2026-10-15 * "Breakfast"
    Expenses:Food     80 NTD
    Assets:Cash      -80 NTD
`,
      { prelude: "" },
    );
    expect(codes(h)).toEqual(["parse.orphan-line", "parse.unterminated-string", "parse.syntax"]);
    const data = h.data.get("main.hueke");
    const orphan = check(h)[0]?.span;
    expect(data && orphan && position(data, orphan.start).line).toBe(1);
    expect(balanceOf(h, "Assets:Cash", "2026-10-15")).toBe("-260");
  });
});

describe("token order", () => {
  it("rejects three blocks", () => {
    const h = ledger(
      `
2026-10-11 * "Lunch" %lunch-1011
    Expenses:Food     600 NTD
    Assets:Cash      -600 NTD

2026-10-12 * "Paid on behalf"
    Expenses:Food                      600 NTD
    Assets:Receivables:lunch-1012      400 NTD  @NAT %lunch-1012
    Assets:Cash                      -1000 NTD

2026-10-21 * "Ramen in Tokyo"
    Expenses:Food             1200 JPY @@ 260 NTD
    Liabilities:CreditCard    -260 NTD #foreign [2026-10-23]
`,
    );
    expect(codes(h)).toEqual(["parse.token-order", "parse.token-order", "parse.token-order"]);
    expect(h.transactions).toEqual([]);
  });
  it("reads a complete posting line", () => {
    const h = ledger(
      `
2026-10-21 * "Ramen in Tokyo"
    Expenses:Food             1200 JPY @@ 260 NTD %ramen-1021 @NAT #foreign
    Liabilities:CreditCard    -260 NTD [2026-10-23T09:00[Asia/Tokyo]] #foreign
`,
    );
    expect(codes(h)).toEqual([]);
    const [food, card] = query(h).postings();
    expect(food).toMatchObject({
      id: "ramen-1021",
      price: { value: "260", commodity: "NTD" },
      refs: [{ role: "person", entity: "NAT" }],
    });
    expect(food?.tags.map((t) => `${t.scope}:${t.ref.name}`)).toEqual(["tag:foreign"]);
    expect(card?.effective).toMatchObject({
      timezone: "Asia/Tokyo",
      start: "2026-10-23T00:00Z",
    });
  });
});

describe("once-only parts and line breaks", () => {
  it.each([
    ["a second anchor", '2026-10-12 * %a %b "Lunch"'],
    ["a second description", '2026-10-12 * "Lunch" "Again"'],
    ["a cancel mark after the description", '2026-10-14 * "Taxi" # travel'],
  ])("%s is out of order", (_, header) => {
    const h = ledger(`${header}\n    Expenses:Food  180 NTD\n    Assets:Cash\n`);
    expect(codes(h)).toEqual(["parse.token-order"]);
    expect(h.transactions).toEqual([]);
  });
  it("rejects unmatched braces", () => {
    const h = ledger(
      '2026-11-20 * "Sold"\n    Assets:Brokerage  -5 AAPL {150 USD}}\n    Bank:USDAccount  750 USD\n',
    );
    expect(codes(h)).toEqual(["parse.syntax"]);
    expect(h.transactions).toEqual([]);
  });
  it("reads \\r\\n line breaks as \\n", () => {
    const text = `2026-10-12 * "Lunch"\n    Expenses:Food  180 NTD\n    Assets:Cash\n`;
    const h = ledger(text.replaceAll("\n", "\r\n"));
    expect(codes(h)).toEqual([]);
    expect(balanceOf(h, "Assets:Cash", "2026-10-12")).toBe("-180");
    expect(h.transactions[0]?.description).toBe("Lunch");
  });
});

describe("account names cannot contain spaces", () => {
  it("drops the block", () => {
    const h = ledger(
      `2026-10-12 * "Coffee"\n    Expenses:Coffee Shop 150 NTD\n    Assets:Cash -150 NTD\n`,
    );
    expect(codes(h)).toEqual(["parse.syntax"]);
    expect(balanceOf(h, "Assets:Cash", "2026-10-12")).toBe("0");
  });
  it("one space is enough", () => {
    const h = ledger(`
2026-10-01 * "Opening"
    Bank:Checking 12345 NTD
    Equity:Opening -12345 NTD

2026-10-25 balance Bank:Checking 12345 NTD
`);
    expect(codes(h)).toEqual([]);
  });
  it("a breakdown needs two spaces after its name", () => {
    const h = ledger(`
2026-10-12 * "Breakfast"
    Expenses:Food     200 NTD
        - Bubble tea  3cups * 40
        - Toast 65
    Assets:Cash      -200 NTD
`);
    expect(codes(h)).toEqual([]);
    expect(query(h).accounts("Expenses:Food").postings()[0]?.breakdown).toEqual([
      { name: "Bubble tea", quantity: { value: "3", unit: "cups" }, unitPrice: { value: "40" } },
      { name: "Toast 65" },
    ]);
  });
});

describe("breakdown lines", () => {
  const breakdown = (h: ReturnType<typeof ledger>) =>
    query(h).accounts("Expenses:Food").postings()[0]?.breakdown;

  it("take a quantity, a unit price and a total, each optional", () => {
    const h = ledger(`
2026-10-12 * "Breakfast"
    Expenses:Food     200 NTD
        - Bubble tea  3 cups * 40 NTD = 120 NTD  ; half sugar
        - Toast  = 65 NTD
        - Apples  3kg
        - Napkins
    Assets:Cash      -200 NTD
`);
    expect(codes(h)).toEqual([]);
    expect(breakdown(h)).toEqual([
      {
        name: "Bubble tea",
        quantity: { value: "3", unit: "cups" },
        unitPrice: { value: "40", commodity: "NTD" },
        total: { value: "120", commodity: "NTD" },
      },
      { name: "Toast", total: { value: "65", commodity: "NTD" } },
      { name: "Apples", quantity: { value: "3", unit: "kg" } },
      { name: "Napkins" },
    ]);
  });
  it("need no spaces around * and =, and take ×", () => {
    const h = ledger(`
2026-10-12 * "Breakfast"
    Expenses:Food     200 NTD
        - Bubble tea  3cups*40=120
        - Toast  2 × 30
    Assets:Cash      -200 NTD
`);
    expect(codes(h)).toEqual([]);
    expect(breakdown(h)).toEqual([
      {
        name: "Bubble tea",
        quantity: { value: "3", unit: "cups" },
        unitPrice: { value: "40" },
        total: { value: "120" },
      },
      { name: "Toast", quantity: { value: "2" }, unitPrice: { value: "30" } },
    ]);
  });
  it("quote a name that holds ; or two spaces", () => {
    const h = ledger(`
2026-10-12 * "Dinner"
    Expenses:Food     200 NTD
        - "Rice; large"  = 50
        - "Two  spaces"
    Assets:Cash      -200 NTD
`);
    expect(codes(h)).toEqual([]);
    expect(breakdown(h)).toEqual([
      { name: "Rice; large", total: { value: "50" } },
      { name: "Two  spaces" },
    ]);
  });
  it("need one space after a quoted name, and a quoted name may follow - directly", () => {
    const h = ledger(`
2026-10-12 * "Dinner"
    Expenses:Food     200 NTD
        - "x" = 5
        -"y"  = 5
    Assets:Cash      -200 NTD
`);
    expect(codes(h)).toEqual([]);
    expect(breakdown(h)).toEqual([
      { name: "x", total: { value: "5" } },
      { name: "y", total: { value: "5" } },
    ]);
  });
  it.each(["-", '- ""', '- ""  = 5', "-%x"])("reject %s: a breakdown line needs a name", (line) => {
    const h = ledger(`
2026-10-12 * "Dinner"
    Expenses:Food     200 NTD
        ${line}
    Assets:Cash      -200 NTD

2026-10-13 * "Lunch"
    Expenses:Food     100 NTD
    Assets:Cash      -100 NTD
`);
    expect(codes(h)).toEqual(["parse.syntax"]);
    expect(h.transactions.map((t) => t.description)).toEqual(["Lunch"]);
  });
  it("need a space after a quoted name", () => {
    const h = ledger(`
2026-10-12 * "Dinner"
    Expenses:Food     200 NTD
        - "x"= 5
    Assets:Cash      -200 NTD
`);
    expect(codes(h)).toEqual(["parse.syntax"]);
    expect(h.transactions).toEqual([]);
  });
  it("before any posting is an orphan line", () => {
    const h = ledger(`
2026-10-12 * "Dinner"
    - Rice  = 50
    Expenses:Food     200 NTD
    Assets:Cash      -200 NTD
`);
    expect(codes(h)).toEqual(["parse.orphan-line"]);
    expect(h.transactions).toEqual([]);
  });
});

describe("where Metadata belongs", () => {
  const h = ledger(`
2026-10-12 * "Stationery"
    Expenses:Other     320 NTD
    ;; invoice_number: AB-12345678
    Assets:Cash       -320 NTD
`);
  it("goes to the nearest posting after the first one", () => {
    expect(codes(h)).toEqual([]);
    const [t] = h.transactions;
    expect(t?.meta).toEqual({});
    expect(t?.postings.map((p) => p.meta)).toEqual([{ invoice_number: "AB-12345678" }, {}]);
  });
});

describe("properties written twice or in the wrong place", () => {
  it("rejects each block", () => {
    const h = ledger(`
commodity KRW
    precision 0
    precision 2

account Assets:Won
    precision 0

commodity guitar-01
    item
    precision 0
`);
    expect(codes(h)).toEqual([
      "parse.duplicate-property",
      "parse.unexpected-property",
      "parse.unexpected-property",
    ]);
  });
});

describe("lines a declaration does not accept", () => {
  it.each([
    "option week-start sunday",
    "account-root Wallet asset",
    'include "other.hueke"',
    "commodity KRW",
    "account Assets:Won",
  ])("rejects a posting line under %s", (declaration) => {
    const data = parse("main.hueke", `${declaration}\n    Assets:Cash  100 NTD\n`);
    expect(data.diagnostics.map((d) => d.code)).toEqual(["parse.unexpected-property"]);
    expect(data.items).toEqual([]);
  });
  it("skips Metadata under option and keeps the option", () => {
    const h = ledger("option week-start sunday\n    ;; note: start on Sunday\n");
    expect(codes(h)).toEqual(["parse.orphan-line"]);
    expect(h.settings.weekStart).toBe("sunday");
  });
  it("rejects a property under include", () => {
    const data = parse("main.hueke", 'include "other.hueke"\n    precision 0\n');
    expect(data.diagnostics.map((d) => d.code)).toEqual(["parse.unexpected-property"]);
    expect(data.items).toEqual([]);
  });
});

describe("a posting mark", () => {
  it("needs no space before the account", () => {
    const h = ledger(`
2026-10-12 "Lunch"
    *Expenses:Food     180 NTD
    Assets:Cash       -180 NTD
`);
    expect(codes(h)).toEqual([]);
    expect(
      query(h)
        .postings()
        .map((p) => `${p.account} ${p.status}`),
    ).toEqual(["Expenses:Food cleared", "Assets:Cash none"]);
  });
});

describe("invalid times", () => {
  it("rejects them while parsing", () => {
    const h = ledger(`
2026-02-30 * "A date that does not exist"
    Expenses:Other     100 NTD
    Assets:Cash       -100 NTD

2026-13 * "A month that does not exist"
    Expenses:Other     100 NTD
    Assets:Cash       -100 NTD

2026-10-12T25:00 * "A time that does not exist"
    Expenses:Other     100 NTD
    Assets:Cash       -100 NTD
`);
    expect(codes(h)).toEqual(["parse.invalid-time", "parse.invalid-time", "parse.invalid-time"]);
  });
});

describe("comments and Metadata", () => {
  it("ownership", () => {
    const h = ledger(`
2026-10-12 * "Lunch"
    ;; rule: record the total, then split it
    ; note: this line is only a comment
    Expenses:Food 180 NTD  ;; note: with colleagues
    Assets:Cash -180 NTD
`);
    expect(codes(h)).toEqual([]);
    const [t] = h.transactions;
    expect(t?.meta).toEqual({ rule: "record the total, then split it" });
    expect(t?.postings.map((p) => p.meta)).toEqual([{ note: "with colleagues" }, {}]);
  });
  it("Metadata before the first record", () => {
    const h = ledger(
      `; About this file: a comment that belongs to the file\n;; owner: NAT\n\n${SHARED}\n2026-10-12 * "Lunch"\n    Expenses:Food 180 NTD\n    Assets:Cash -180 NTD\n`,
      {
        prelude: "",
      },
    );
    expect(codes(h)).toEqual(["parse.orphan-line"]);
    expect(balanceOf(h, "Assets:Cash", "2026-10-12")).toBe("-180");
    expect(parse("main.hueke", "; About this file\n").comments).toHaveLength(1);
  });
  it("two Metadata on a line, and a quoted value", () => {
    const h = ledger(`
2026-10-13 * "Dinner"
    Expenses:Food 300 NTD  ;; a: 1 ; b: 2
    Assets:Cash -300 NTD

2026-10-14 * "Breakfast"
    Expenses:Food 80 NTD  ;; memo: "extra egg ; no scallions"
    Assets:Cash -80 NTD
`);
    expect(codes(h)).toEqual(["parse.syntax"]);
    expect(query(h).accounts("Expenses:Food").postings()[0]?.meta).toEqual({
      memo: "extra egg ; no scallions",
    });
    expect(balanceOf(h, "Assets:Cash", "2026-10-14")).toBe("-80");
  });
  it("Metadata after a breakdown line still belongs to the posting, with a warning", () => {
    const h = ledger(`
2026-10-12 * "Lunch"
    Expenses:Food 180 NTD
        - Lunch box  = 120  ;; receipt: R-1
        - Drink  = 60
        ;; invoice: AB-1
    Assets:Cash -180 NTD
`);
    expect(codes(h)).toEqual(["parse.metadata-after-breakdown", "parse.metadata-after-breakdown"]);
    expect(check(h)[0]?.severity).toBe("warning");
    const [t] = h.transactions;
    expect(t?.meta).toEqual({});
    expect(t?.postings[0]?.meta).toEqual({ receipt: "R-1", invoice: "AB-1" });
  });
  it("a comment after a breakdown line is not reported", () => {
    const h = ledger(`
2026-10-12 * "Lunch"
    Expenses:Food 180 NTD
        - Lunch box  = 120  ; with egg
        ; the drink was a treat
    Assets:Cash -180 NTD
`);
    expect(codes(h, true)).toEqual([]);
  });
  it("Metadata at the end of a property line belongs to the declaration", () => {
    const h = ledger(`
commodity KRW
    precision 0  ;; source: bank
`);
    expect(codes(h)).toEqual([]);
    expect(h.commodities.find((c) => c.id === "KRW")?.meta).toEqual({ source: "bank" });
  });
  it("a key written twice keeps the later value", () => {
    const h = ledger(`
2026-10-12 * "Lunch"  ;; receipt: R-0
    ;; receipt: R-1
    ;; document: a.pdf
    ;; document: b.pdf
    Expenses:Food 180 NTD
    Assets:Cash -180 NTD

account Assets:Wallet  ;; owner: NAT
    ;; owner: AMY
`);
    expect(codes(h)).toEqual([]);
    expect(h.transactions[0]?.meta).toEqual({ receipt: "R-1", document: "b.pdf" });
    expect(h.accounts.find((a) => a.id === "Assets:Wallet")?.meta).toEqual({ owner: "AMY" });
  });
  it("a value in quotes is read as a string, with its escapes", () => {
    const h = ledger(`
2026-10-12 * "Book"
    ;; title: "\\"Dune\\""
    ;; path: "a\\\\b"
    Expenses:Other 300 NTD
    Assets:Cash -300 NTD
`);
    expect(codes(h)).toEqual([]);
    expect(h.transactions[0]?.meta).toEqual({ title: '"Dune"', path: "a\\b" });
  });
  it("Metadata may follow ;; without a space", () => {
    const h = ledger(
      `2026-10-12 * "Lunch"\n    ;;receipt: R-1\n    Expenses:Food 180 NTD\n    Assets:Cash\n`,
    );
    expect(codes(h)).toEqual([]);
    expect(h.transactions[0]?.meta).toEqual({ receipt: "R-1" });
  });
  it("a Metadata key starts with a letter", () => {
    const h = ledger(
      `2026-10-12 * "Lunch"\n    ;; 1receipt: R-1\n    Expenses:Food 180 NTD\n    Assets:Cash\n`,
    );
    expect(codes(h)).toEqual(["parse.syntax"]);
    expect(h.transactions).toEqual([]);
  });
  it(";; must be key: value", () => {
    const h = ledger(`
2026-10-15 * "Late snack"
    ;; anything
    Expenses:Food 120 NTD
    Assets:Cash -120 NTD
`);
    expect(codes(h)).toEqual(["parse.syntax"]);
    expect(balance(h, query(h).accounts("Assets:Cash").until("2026-10-15"))).toEqual([]);
  });
});

describe("identifiers", () => {
  const posting = (account: string, extra = "") =>
    `2026-10-12 * "x"${extra}\n    ${account}  1 NTD\n    Assets:Cash  -1 NTD\n`;
  it.each([
    ["an empty segment", posting("Expenses::Food")],
    ["a comma in an account", posting("Expenses:Food,Drink")],
    ["a root not starting with a letter", posting("_Expenses:Food")],
    ["a keyword as a root", "account-root include asset\n"],
    ["a root that is not one segment", "account-root Bank:Sub asset\n"],
    ["a commodity code starting with a digit", "commodity 1X\n"],
    ["a commodity code with a symbol", "commodity N$D\n"],
    ["a primary commodity that is not a code", "account Assets:Bank\n    primary $\n"],
    ["an entity with a dot", posting("Expenses:Food", " @a.b")],
    ["a role with a dot", posting("Expenses:Food", " @r.x:NAT")],
    ["a tag scope with capitals", posting("Expenses:Food", " #Trip:x")],
    ["an alias with a digit", "commodity TWD\n    alias NT1 prefix\n"],
    ["an alias starting with a dot", "commodity TWD\n    alias .x suffix\n"],
  ])("rejects %s", (_, text) => {
    const h = ledger(text);
    expect(codes(h)).toEqual(["parse.syntax"]);
  });
  it.each([
    ["an anchor with a dot", '2026-10-12 * %a.b "x"\n'],
    ["the anchor self", '2026-10-12 * "x"\n    Expenses:Food  1 NTD %self\n    Assets:Cash\n'],
    ["a tag's anchor with a dot", posting("Expenses:Food", " #lunch.1005")],
    ["a scoped tag's anchor with a dot", posting("Expenses:Food", " #refund:lunch.1005")],
    ["a primary tag's anchor with a dot", posting("Expenses:Food", " ^trip.1")],
    ["an account's anchor with a dot", "account Bank:Checking %main.bank\n"],
  ])("rejects %s as an invalid anchor name, and does not load the block", (_, text) => {
    const h = ledger(text);
    expect(codes(h)).toEqual(["anchor.invalid-name"]);
    expect(h.transactions).toEqual([]);
    expect(h.accounts.find((a) => a.id === "Bank:Checking")).toBeUndefined();
  });
  it.each([
    ["accounts with letters of any script", posting("支出:餐飲")],
    ["codes with digits, dots and dashes", "commodity BRK.B\ncommodity camera-02\n"],
    [
      "entities, roles, anchors and scopes",
      posting("Expenses:Food", " @xx_breakfast @payer:NAT ^trip #system:balance #旅行"),
    ],
    ["anchors, one with a period", '2026-10-12 * %lunch-1011 "x"\n2026-10-13 * %rent/2026-11\n'],
    ["aliases with symbols", "commodity TWD\n    alias NT$ prefix\n    alias 元 suffix\n"],
    ["an entity and its display name", "entity NAT\n    display-name Nat Chen\n"],
  ])("accepts %s", (_, text) => {
    // The parser accepts them; whether a role or scope is known is checked when loading.
    expect(parse("main.hueke", text).diagnostics).toEqual([]);
  });
});

describe("include lines", () => {
  it("reads the path as one token, quoted when it holds whitespace or ;", () => {
    const data = parse(
      "main.hueke",
      'include 2026/10.hueke\ninclude "a b.hueke"\ninclude "c;d.hueke"\n',
    );
    expect(data.diagnostics).toEqual([]);
    expect(data.items.map((i) => (i.kind === "include" ? i.args : []))).toEqual([
      ["2026/10.hueke"],
      ["a b.hueke"],
      ["c;d.hueke"],
    ]);
  });
  it.each([["../a.hueke"], ["/years/2026.hueke"]])("reads include %s as one path", (path) => {
    const data = parse("main.hueke", `include ${path}\n`);
    expect(data.diagnostics).toEqual([]);
    expect(data.items.map((i) => (i.kind === "include" ? i.args : []))).toEqual([[path]]);
  });
  it.each([
    ["a missing path", "include\n"],
    ["an unquoted path with a space", "include a b.hueke\n"],
    ["an extra token after a quoted path", 'include "a.hueke" b.hueke\n'],
    ["an unquoted path with a space inside a token", "include a(b c).hueke\n"],
  ])("rejects %s and does not load the line", (_, text) => {
    const data = parse("main.hueke", text);
    expect(data.diagnostics.map((d) => d.code)).toEqual(["parse.syntax"]);
    expect(data.items.filter((i) => i.kind === "include")).toEqual([]);
  });
  it("owns no child lines", () => {
    const data = parse("main.hueke", "include a.hueke\n    ;; key: value\n");
    expect(data.diagnostics.map((d) => d.code)).toEqual(["parse.orphan-line"]);
  });
});

describe("times of day", () => {
  it("are written to the minute", () => {
    const h = ledger(`
2026-10-12T14:30 * "Lunch"
    Expenses:Food     180 NTD
    Assets:Cash      -180 NTD
`);
    expect(codes(h)).toEqual([]);
    expect(h.transactions[0]?.effective).toMatchObject({
      precision: "time",
      start: "2026-10-12T06:30Z",
      end: "2026-10-12T06:30Z",
    });
  });
  it("reject seconds", () => {
    const h = ledger(`
2026-10-12T14:30:15 * "Lunch"
    Expenses:Food     180 NTD
    Assets:Cash      -180 NTD
`);
    expect(codes(h)).toEqual(["parse.invalid-time"]);
    expect(h.transactions).toEqual([]);
  });
});

describe("symbols", () => {
  const LINES = "    Expenses:Food  1 NTD\n    Assets:Cash\n";
  it.each([
    ["a primary tag with a scope other than tag", '2026-10-12 * "x" ^refund:a\n'],
    ["## before a tag", '2026-10-12 * "x" ##a\n'],
    ["@ followed by a digit", '2026-10-12 * "x" @1a\n'],
  ])("rejects %s", (_, header) => {
    const h = ledger(`${header}${LINES}`);
    expect(codes(h)).toEqual(["parse.syntax"]);
    expect(h.transactions).toEqual([]);
  });
  it.each([["@"], ["@@"]])("rejects %s joined to its price", (at) => {
    const h = ledger(
      `2026-10-12 * "x"\n    Bank:USDAccount  1 USD ${at}32 NTD\n    Bank:Checking\n`,
    );
    expect(codes(h)).toEqual(["parse.syntax"]);
    expect(h.transactions).toEqual([]);
  });
  it("reads ^tag:x as ^x", () => {
    const h = ledger(`2026-10-12 * "x" ^tag:trip\n${LINES}`);
    expect(codes(h)).toEqual([]);
    expect(h.transactions[0]?.primaryTag).toBe("trip");
  });
});

describe("Balance lines", () => {
  it("take no posting line", () => {
    const h = ledger("2026-10-12 balance Assets:Cash 0 NTD\n    Assets:Cash  1 NTD\n");
    expect(codes(h)).toEqual(["parse.unexpected-property"]);
    expect(h.balances).toEqual([]);
  });
  it("take no tag", () => {
    const h = ledger("2026-10-12 balance Assets:Cash 0 NTD #x\n");
    expect(codes(h)).toEqual(["parse.syntax"]);
    expect(h.balances).toEqual([]);
  });
});

describe("header marks", () => {
  it("set the status or the occurrence", () => {
    const h = ledger(`
2026-10-12 "Unchecked"
2026-10-13 * "Cleared"
2026-10-14 ! "Planned"
2026-10-15 # "Cancelled"
2026-10-16 #travel
`);
    expect(codes(h)).toEqual([]);
    expect(h.transactions.map((t) => [t.status, t.occurrence])).toEqual([
      ["none", "occurred"],
      ["cleared", "occurred"],
      ["none", "planned"],
      ["none", "cancelled"],
      ["none", "occurred"],
    ]);
    expect(h.transactions[4]?.tags.map((t) => t.ref.name)).toEqual(["travel"]);
  });
});

describe("Balance times", () => {
  it("takes an accounting time after =", () => {
    const h = ledger(`
2026-10-01 * "Opening"
    Bank:Checking     12345 NTD
    Equity:Opening   -12345 NTD

2026-10-25=2026-10 balance Bank:Checking 12345 NTD
`);
    expect(codes(h)).toEqual([]);
    const [b] = h.balances;
    expect(b?.effective.literal).toBe("2026-10-25");
    expect(b?.accounting?.literal).toBe("2026-10");
    expect(b?.origin).toMatchObject({ time: "2026-10-25", accounting: "2026-10" });
  });
  it("leaves the accounting time out when it is not written", () => {
    const h = ledger(`2026-10-25 balance Bank:Checking 0 NTD\n`);
    expect(codes(h)).toEqual([]);
    const [b] = h.balances;
    expect(b).toBeDefined();
    expect(b).not.toHaveProperty("accounting");
    expect(b?.origin).not.toHaveProperty("accounting");
  });
});

describe("account anchors", () => {
  it("are read after the name, and the declaration is loaded", () => {
    const h = ledger(`
account Bank:Checking %checking
    primary USD
    ;; bank_code: 808
`);
    expect(codes(h)).toEqual([]);
    const account = h.accounts.find((a) => a.id === "Bank:Checking");
    expect(account?.anchor).toBe("checking");
    expect(account?.span).toBeDefined();
    expect(account?.primaryCommodity).toBe("USD");
    expect(account?.meta).toEqual({ bank_code: "808" });
  });
  it("take no period", () => {
    const h = ledger(`account Bank:Checking %checking/2026-10\n`);
    expect(codes(h)).toEqual(["parse.syntax"]);
    expect(h.accounts.find((a) => a.id === "Bank:Checking")).toBeUndefined();
  });
});

describe("account and entity declarations", () => {
  it("read every account property", () => {
    const h = ledger(`
account Bank:Checking %main-bank
    display-name Main checking account
    primary NTD
    ;; bank_code: 808
account Assets:Receivable
    obligation receivable
    pad-account Expenses:WriteOff

entity NAT
    display-name Nat Chen
`);
    expect(codes(h)).toEqual([]);
    const bank = h.accounts.find((a) => a.id === "Bank:Checking");
    expect(bank?.displayName).toBe("Main checking account");
    expect(bank?.meta).toEqual({ bank_code: "808" });
    const receivable = h.accounts.find((a) => a.id === "Assets:Receivable");
    expect(receivable?.obligation).toBe("receivable");
    expect(receivable?.padAccount).toBe("Expenses:WriteOff");
    expect(h.entities.map((e) => [e.id, e.displayName])).toEqual([["NAT", "Nat Chen"]]);
  });
  it.each([
    ["display-name without text", "account Bank:Checking\n    display-name\n"],
    ["display-name without text on an entity", "entity NAT\n    display-name\n"],
    [
      "an obligation that is neither receivable nor payable",
      "account Bank:Checking\n    obligation card\n",
    ],
    ["an obligation without a value", "account Bank:Checking\n    obligation\n"],
    ["two pad accounts", "account Bank:Checking\n    pad-account Expenses:A Expenses:B\n"],
    [
      "a pad account that is not an account",
      "account Bank:Checking\n    pad-account Expenses::A\n",
    ],
    ["an entity starting with a digit", "entity 1NAT\n"],
    ["an entity with a dot", "entity N.AT\n"],
    ["an entity without an ID", "entity\n"],
  ])("reject %s, and the block is not loaded", (_, text) => {
    const h = ledger(text);
    expect(codes(h)).toEqual(["parse.syntax"]);
    expect(h.accounts.some((a) => a.id === "Bank:Checking")).toBe(false);
    expect(h.entities).toEqual([]);
    expect(h.balances).toEqual([]);
  });
  it.each(["display-name A", "obligation payable", "pad-account Expenses:A"])(
    "reject %s written twice",
    (line) => {
      const h = ledger(`account Bank:Checking\n    ${line}\n    ${line}\n`);
      expect(codes(h)).toEqual(["parse.duplicate-property"]);
      expect(h.accounts.some((a) => a.id === "Bank:Checking")).toBe(false);
    },
  );
  it("an entity takes no account property", () => {
    const h = ledger("entity NAT\n    primary NTD\n");
    expect(codes(h)).toEqual(["parse.unexpected-property"]);
    expect(h.entities).toEqual([]);
  });
  it("a display name runs to the end of the line", () => {
    const h = ledger("entity NAT\n    display-name  Nat  Chen (school)  ; a friend\n");
    expect(codes(h)).toEqual([]);
    expect(h.entities[0]?.displayName).toBe("Nat  Chen (school)");
  });
  it("entity is a declaration keyword and cannot be an account root", () => {
    expect(codes(ledger("account-root entity asset\n"))).toEqual(["parse.syntax"]);
  });
  it("name is not a keyword: it may be an account root", () => {
    const h = ledger("account-root name asset\n");
    expect(codes(h)).toEqual([]);
    expect(h.roots.find((r) => r.name === "name")?.type).toBe("asset");
  });
  it("a Balance reads one entity after the account", () => {
    const h = ledger("2026-10-31 balance Bank:Checking @acme 0 NTD\n");
    expect(codes(h)).toEqual([]);
    expect(h.balances[0]?.entity).toBe("acme");
    expect(h.balances[0]?.origin?.entity).toBe("acme");
  });
});

describe("properties that may repeat", () => {
  it.each([
    ["map on an account", "account Assets:Wallet\n    map Cash\n    map Purse\n"],
    [
      "share on a transaction",
      '2026-10-12 "x"\n    share @NAT\n    share @AMY\n    Expenses:Food  2 NTD\n    Assets:Cash\n',
    ],
    ["from on a schedule", 'schedule %rent "Rent"\n    from 2026-01\n    from 2026-07\n'],
    [
      "active, cap and minimum on a rule",
      "rule %dining\n    active 2026-01..2026-06\n    cap 300 NTD per month\n" +
        "    cap 1000 NTD per year\n    minimum 10 NTD per posting\n    minimum 100 NTD per month\n" +
        "    active 2026-07..\n",
    ],
    [
      "rate, fixed and rounding once in each segment of a rule",
      "rule %dining\n    active 2026-01..2026-06\n    rate 2%\n    fixed 5 NTD\n    rounding floor\n" +
        "    active 2026-07..\n    rate 3%\n    fixed 15 NTD\n    rounding floor\n",
    ],
  ])("accepts %s, as reserved syntax", (_, text) => {
    expect(codes(ledger(text))).toEqual(["syntax.unsupported"]);
  });
  it.each([
    [
      "fixed twice in one segment",
      "rule %dining\n    active 2026..\n    fixed 5 NTD\n    fixed 6 NTD\n",
    ],
    ["follows twice on a rule", "rule %dining\n    follows card\n    follows card\n"],
    [
      "cap-group twice on a rule, even in two segments",
      "rule %dining\n    cap-group a\n    active 2026..\n    cap-group b\n",
    ],
  ])("rejects %s", (_, text) => {
    expect(codes(ledger(text))).toEqual(["parse.duplicate-property"]);
  });
  it("takes fixed and cap-group only on a rule", () => {
    expect(codes(ledger("account Assets:Wallet\n    fixed 5 NTD\n"))).toEqual([
      "parse.unexpected-property",
    ]);
    expect(codes(ledger("account Assets:Wallet\n    cap-group a\n"))).toEqual([
      "parse.unexpected-property",
    ]);
  });
  it("cap-group is not a declaration", () => {
    expect(codes(ledger("cap-group %food 3000 NTD\n"))).toEqual(["parse.unexpected-property"]);
  });
});
