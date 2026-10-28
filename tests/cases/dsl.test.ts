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
    Liabilities:CreditCard    -260 NTD #foreign @NAT
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
    Liabilities:CreditCard    -260 NTD @NAT #foreign
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
    expect(card?.refs).toEqual([{ role: "person", entity: "NAT" }]);
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
`);
    expect(codes(h)).toEqual([]);
    expect(balanceOf(h, "Bank:Checking", "2026-10-01")).toBe("12345");
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
  it("rejects a property under include", () => {
    const data = parse("main.hueke", 'include "other.hueke"\n    precision 0\n');
    expect(data.diagnostics.map((d) => d.code)).toEqual(["parse.unexpected-property"]);
    expect(data.items).toEqual([]);
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
  it("a key written twice keeps the later value", () => {
    const h = ledger(`
2026-10-12 * "Lunch"  ;; receipt: R-0
    ;; receipt: R-1
    ;; document: a.pdf
    ;; document: b.pdf
    Expenses:Food 180 NTD
    Assets:Cash -180 NTD
`);
    expect(codes(h)).toEqual([]);
    expect(h.transactions[0]?.meta).toEqual({ receipt: "R-1", document: "b.pdf" });
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
    ["an entity with a dot", posting("Expenses:Food", " @a.b")],
    ["a role with a dot", posting("Expenses:Food", " @r.x:NAT")],
    ["an anchor with a dot", '2026-10-12 * %a.b "x"\n'],
    ["the anchor self", '2026-10-12 * "x"\n    Expenses:Food  1 NTD %self\n    Assets:Cash\n'],
    ["a tag scope with capitals", posting("Expenses:Food", " #Trip:x")],
  ])("rejects %s", (_, text) => {
    expect(codes(ledger(text))).toEqual(["parse.syntax"]);
  });
  it.each([
    ["accounts with letters of any script", posting("支出:餐飲")],
    ["codes with digits, dots and dashes", "commodity BRK.B\ncommodity camera-02\n"],
    [
      "entities, roles, primary tags and scopes",
      posting("Expenses:Food", " @xx_breakfast @payer:NAT ^trip #system:balance #旅行"),
    ],
    ["anchors, one with a period", '2026-10-12 * %lunch-1011 "x"\n2026-10-13 * %rent/2026-11\n'],
  ])("accepts %s", (_, text) => {
    expect(codes(ledger(text))).toEqual([]);
  });
});

describe("a malformed precision", () => {
  it("drops the commodity declaration", () => {
    const h = ledger("commodity MILE\n    precision x\n");
    expect(codes(h)).toEqual(["parse.syntax"]);
    expect(h.commodities.find((c) => c.id === "MILE")).toBeUndefined();
  });
});
