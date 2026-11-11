// docs/dsl/formatting.md
import { describe, expect, it } from "vitest";
import {
  parse,
  serialize,
  type Hueke,
  type ItemData,
  type TransactionData,
} from "../../srcs/index.js";
import { ledger, modules, SHARED } from "./ledger.js";

const PRELUDE = SHARED.replace(
  "commodity NTD\n    precision 0\n",
  "commodity NTD\n    precision 0\n    alias NT$ prefix\n",
);

/** Each record of `text`, serialized with the ledger it loads into. */
function canonical(text: string, prelude = PRELUDE): string[] {
  const h = ledger(text, { prelude });
  return records(h, text).map((r) => serialize(h, r));
}

/** The records of `text` alone, without the prelude. */
function records(h: Hueke, text: string): ItemData[] {
  const own = parse("own.hueke", text).items.length;
  return h.data.get("main.hueke")?.items.slice(-own) ?? [];
}

/** The derived model without source positions and Raw records. */
function meaning(h: Hueke): unknown {
  return JSON.parse(
    JSON.stringify({ t: h.transactions, b: h.balances }, (k, v: unknown) =>
      k === "span" || k === "origin" || k === "source" ? undefined : v,
    ),
  );
}

describe("serialization", () => {
  const BREAKFAST = `2026-10-12   *   "Breakfast"    @person:xx_breakfast  #tag:food
  Expenses:Food 1200 NTD   ;; receipt: 42
      -   Bubble tea  3cups*40
  Assets:Cash   -NT$1200
`;
  const FORMATTED = `2026-10-12 * "Breakfast" @xx_breakfast #food
    Expenses:Food  1,200 NTD  ;; receipt: 42
        - Bubble tea  3 cups * 40
    Assets:Cash   -1,200 NTD
`;

  it("writes the canonical form", () => {
    expect(canonical(BREAKFAST)).toEqual([FORMATTED]);
  });
  it("is a fixed point", () => {
    expect(canonical(FORMATTED)).toEqual([FORMATTED]);
  });
  it("keeps the meaning", () => {
    expect(meaning(ledger(FORMATTED, { prelude: PRELUDE }))).toEqual(
      meaning(ledger(BREAKFAST, { prelude: PRELUDE })),
    );
  });

  it("keeps comments and metadata in place", () => {
    const text = `2026-10-12 "Lunch"  ; paid in cash
;; receipt: 7
; before the postings
Expenses:Food  180 NTD
; under the food
    Assets:Cash
        ;; drawer: 2
`;
    expect(canonical(text)).toEqual([
      `2026-10-12 "Lunch"  ; paid in cash
    ;; receipt: 7
    ; before the postings
    Expenses:Food  180 NTD
        ; under the food
    Assets:Cash
        ;; drawer: 2
`,
    ]);
  });

  it.each([
    ["1500.50 USD", "1,500.50 USD"],
    ["-1234567 NTD", "-1,234,567 NTD"],
    ["0.125 USD", "0.125 USD"],
    ["NT$ 1200", "1,200 NTD"],
  ])("writes %s as %s", (written, expected) => {
    const [text] = canonical(`2026-10-12\n    Expenses:Other  ${written}\n    Assets:Cash\n`);
    expect(text?.split("\n")[1]).toBe(`    Expenses:Other  ${expected}`);
  });
  it("uses the ledger's marks", () => {
    const prelude = "option decimal-mark ,\noption group-mark .\n";
    const [text] = canonical(
      `2026-10-12\n    Expenses:Other  1500,25 EUR\n    Assets:Cash  -1.500,25 EUR\n`,
      prelude,
    );
    expect(text).toBe(
      "2026-10-12\n    Expenses:Other  1.500,25 EUR\n    Assets:Cash    -1.500,25 EUR\n",
    );
    const [none] = canonical(
      "2026-10-12\n    Expenses:Other  1500 EUR\n    Assets:Cash\n",
      "option group-mark none\n",
    );
    expect(none).toBe("2026-10-12\n    Expenses:Other  1500 EUR\n    Assets:Cash\n");
  });

  it("writes postings with prices, costs, times, anchors and tags", () => {
    const text = `2026-10-12=2026-11 ! %buy "Shares" @payer:KEN ^tag:trip #trip:t1
    * Assets:Brokerage  -5 AAPL {150 USD}   @   170 USD [2026-10-14]  %sale  #x
    Bank:USDAccount      850 USD
    Income:Gains   -100 USD
`;
    expect(canonical(text)).toEqual([
      `2026-10-12=2026-11 ! %buy "Shares" @payer:KEN ^trip #trip:t1
    * Assets:Brokerage  -5 AAPL {150 USD} @ 170 USD [2026-10-14] %sale #x
    Bank:USDAccount    850 USD
    Income:Gains      -100 USD
`,
    ]);
  });
  it("writes a total price", () => {
    const text = `2026-10-12 * "Shares"\n    Assets:Brokerage   5 AAPL  @@  850 USD\n    Bank:USDAccount\n`;
    expect(canonical(text)).toEqual([
      `2026-10-12 * "Shares"\n    Assets:Brokerage  5 AAPL @@ 850 USD\n    Bank:USDAccount\n`,
    ]);
  });
  it("writes Balances and declarations", () => {
    const text = `option   pad-account   Expenses:ReconcileDiff
account-root  Card   liability
commodity   MILE  ; airline
    precision   2
    alias  mi  suffix
account   Bank:Savings
  primary   NTD
include   "a;b.hueke"
2026-10-25   balance  Bank:Checking   NT$12345   pad 45 NTD  ->  Expenses:ReconcileDiff
  ;; document: "statements/oct;1.pdf"
`;
    expect(canonical(text)).toEqual([
      "option pad-account Expenses:ReconcileDiff\n",
      "account-root Card liability\n",
      "commodity MILE  ; airline\n    precision 2\n    alias mi suffix\n",
      "account Bank:Savings\n    primary NTD\n",
      'include "a;b.hueke"\n',
      '2026-10-25 balance Bank:Checking 12,345 NTD pad 45 NTD -> Expenses:ReconcileDiff\n    ;; document: "statements/oct;1.pdf"\n',
    ]);
  });
  it.each([
    [
      "without quotes when it needs none",
      'option timezone "Asia/Taipei"\n',
      "option timezone Asia/Taipei\n",
    ],
    [
      "with its inner spacing",
      "option pad-account   Expenses:A  B  \n",
      "option pad-account Expenses:A  B\n",
    ],
    [
      "quoted when it holds a ;",
      'option pad-account "Expenses:A;B"\n',
      'option pad-account "Expenses:A;B"\n',
    ],
  ])("writes an option's value %s", (_, text, written) => {
    expect(canonical(text)).toEqual([written]);
    expect(canonical(written)).toEqual([written]);
  });
  it.each([
    ["a path with a space", 'include "a b.hueke"\n', "a b.hueke"],
    ["a path with brackets", 'include "a[1].hueke"\n', "a[1].hueke"],
    ["a plain path", "include 2026/10.hueke\n", "2026/10.hueke"],
    ["a path with parentheses", 'include "a(b).hueke"\n', "a(b).hueke"],
  ])("writes an include of %s that reads back as the same path", (_, text, path) => {
    const written = canonical(text);
    expect(written).toEqual([text]);
    const again = parse("again.hueke", written.join(""));
    expect(again.diagnostics).toEqual([]);
    expect(again.items.map((i) => (i.kind === "include" ? i.args : []))).toEqual([[path]]);
    expect(canonical(written.join(""))).toEqual(written);
  });
  it("quotes an include path with parentheses written without quotes", () => {
    expect(canonical("include a(b).hueke\n")).toEqual(['include "a(b).hueke"\n']);
  });
  it("writes a Balance's accounting time after its effective time", () => {
    expect(canonical("2026-10-25=2026-10   balance  Assets:Cash  NT$500\n")).toEqual([
      "2026-10-25=2026-10 balance Assets:Cash 500 NTD\n",
    ]);
  });
  it("writes times of day as written", () => {
    const text = `2026-10-12T09:30 "Coffee"
    Expenses:Food  90 NTD [2026-10-12T08:15[Asia/Tokyo]]
    Assets:Cash
`;
    expect(canonical(text)).toEqual([text]);
  });
  it("escapes strings", () => {
    expect(canonical('2026-10-12 "say \\"hi\\" \\\\ bye"\n')).toEqual([
      '2026-10-12 "say \\"hi\\" \\\\ bye"\n',
    ]);
  });

  it("writes breakdown figures with single spaces and codes", () => {
    const text = `2026-10-12 * "Breakfast"
    Expenses:Food  200 NTD
        - Bubble tea  3cups*NT$40=NT$120
        - Toast\t=  1200.5 JPY
        - Apples  2kg
        - Two words  2 × 30
        - Napkins
`;
    expect(canonical(text)).toEqual([
      `2026-10-12 * "Breakfast"
    Expenses:Food  200 NTD
        - Bubble tea  3 cups * 40 NTD = 120 NTD
        - Toast  = 1,200.5 JPY
        - Apples  2 kg
        - Two words  2 * 30
        - Napkins
`,
    ]);
  });
  it("quotes a breakdown name only when it must", () => {
    const text = `2026-10-12 * "Dinner"
    Expenses:Food  200 NTD
        - "Rice; large"  = 50
        - "Two  spaces"
        - "\\"Quoted\\" at the start"
        - "Plain name"  = 10
`;
    expect(canonical(text)).toEqual([
      `2026-10-12 * "Dinner"
    Expenses:Food  200 NTD
        - "Rice; large"  = 50
        - "Two  spaces"
        - "\\"Quoted\\" at the start"
        - Plain name  = 10
`,
    ]);
  });
  it("puts declaration properties in order, comments moving with the line above", () => {
    const text = `commodity NTD
    alias NT$ prefix
    ; spoken as "kuai"
    ;; title: "\\"New Taiwan dollar\\""
    precision 0
`;
    const FORMATTED = `commodity NTD
    precision 0
    alias NT$ prefix
    ; spoken as "kuai"
    ;; title: "\\"New Taiwan dollar\\""
`;
    const h = ledger(text, { prelude: "" });
    const [record] = records(h, text);
    expect(record && serialize(h, record)).toBe(FORMATTED);
    expect(h.commodities.find((c) => c.id === "NTD")?.meta).toEqual({
      title: '"New Taiwan dollar"',
    });
    const again = ledger(FORMATTED, { prelude: "" });
    const [same] = records(again, FORMATTED);
    expect(same && serialize(again, same)).toBe(FORMATTED);
  });
  it("keeps a comment before the first property first", () => {
    expect(
      canonical("commodity MILE\n    ; frequent flyer\n    alias mi suffix\n    item\n"),
    ).toEqual(["commodity MILE\n    ; frequent flyer\n    item\n    alias mi suffix\n"]);
  });
  it("puts Metadata after the properties and keeps repeated properties in written order", () => {
    const text = `commodity MILE
    ;; source: airline
    alias mi suffix
    item
    alias mile suffix  ; long form
`;
    expect(canonical(text)).toEqual([
      `commodity MILE
    item
    alias mi suffix
    alias mile suffix  ; long form
    ;; source: airline
`,
    ]);
    expect(canonical("account Bank:Savings\n    ;; owner: NAT\n    primary NTD\n")).toEqual([
      "account Bank:Savings\n    primary NTD\n    ;; owner: NAT\n",
    ]);
  });
  it("quotes a value that starts with a quote", () => {
    const text = `2026-10-12 "Book"
    ;; title: "\\"Dune\\" by \\\\ Herbert"
    Expenses:Other  300 NTD
    Assets:Cash
`;
    expect(canonical(text)).toEqual([text]);
    const h = ledger(text, { prelude: PRELUDE });
    expect(h.transactions[0]?.meta).toEqual({ title: '"Dune" by \\ Herbert' });
  });

  it("quotes a value with leading or trailing whitespace", () => {
    const text = `2026-10-12 "Book"
    ;; memo: "  padded  "
    Expenses:Other  300 NTD
    Assets:Cash
`;
    expect(canonical(text)).toEqual([text]);
    expect(ledger(text, { prelude: PRELUDE }).transactions[0]?.meta).toEqual({
      memo: "  padded  ",
    });
  });
  it("writes a breakdown figure it cannot read as written, trimmed", () => {
    const text = `2026-10-12 * "Breakfast"
    Expenses:Food  200 NTD
        - Toast  =  15,00 \t
    Assets:Cash
`;
    expect(canonical(text)).toEqual([
      `2026-10-12 * "Breakfast"
    Expenses:Food  200 NTD
        - Toast  =  15,00
    Assets:Cash
`,
    ]);
  });
  it("throws on an edited record it cannot write", () => {
    // Text cannot hold these, so a parsed record is edited the way a platform edits Raw records.
    const text = `2026-10-12 "Lunch"\n    Expenses:Food  180 NTD  ;; receipt: 7\n        - Rice  = 50\n    Assets:Cash\n`;
    const h = ledger(text, { prelude: PRELUDE });
    const [record] = records(h, text);
    if (record?.kind !== "transaction") throw new Error("fixture");
    const [food, cash] = record.postings;
    if (!food || !cash) throw new Error("fixture");
    const withFood = (posting: typeof food): TransactionData => ({
      ...record,
      postings: [posting, cash],
    });
    expect(serialize(h, withFood(food))).toBe(
      `2026-10-12 "Lunch"\n    Expenses:Food  180 NTD  ;; receipt: 7\n        - Rice  = 50\n    Assets:Cash\n`,
    );
    const multiLine = withFood({
      ...food,
      trailer: { kind: "meta", key: "receipt", value: "7\n8" },
    });
    expect(() => serialize(h, multiLine)).toThrow("cannot serialize");
    const noName = withFood({
      ...food,
      lines: food.lines.map((l) => (l.kind === "breakdown" ? { ...l, name: "" } : l)),
    });
    expect(() => serialize(h, noName)).toThrow("cannot serialize");
  });
  it("throws on syntax not supported yet and on values it cannot read", () => {
    const text = `entity NAT
    type person
account Bank:Savings
    primary NTD
    active 2026-01
2026-10-12
    Expenses:Food  2 NTD
        split @NAT @AMY
    Assets:Cash
2026-10-12
    Expenses:Food  15,00 NTD
    Assets:Cash
`;
    const h = ledger(text, { prelude: PRELUDE });
    const [entity, account, split, comma] = records(h, text);
    for (const r of [entity, account, split]) {
      expect(r).toBeDefined();
      if (r) expect(() => serialize(h, r)).toThrow("cannot serialize");
    }
    expect(comma).toBeDefined();
    if (comma) expect(() => serialize(h, comma)).toThrow("15,00");
  });
  it("throws on a tag with a reserved scope or a period, and on a header anchor's period", () => {
    const text = `2026-10-12 "Card" #statement:card
    Expenses:Food  2 NTD
    Assets:Cash
2026-10-12 "Trip" #trip/2026-10
    Expenses:Food  2 NTD
    Assets:Cash
2026-11-01 %rent/2026-11 "Rent"
    Expenses:Rent  2 NTD
    Assets:Cash
`;
    const h = ledger(text, { prelude: PRELUDE });
    const all = records(h, text);
    expect(all).toHaveLength(3);
    for (const r of all) expect(() => serialize(h, r)).toThrow("cannot serialize");
  });
});

describe("serializing with the root module's declarations", () => {
  const files = {
    "main.hueke": `option decimal-mark ,
option group-mark .
commodity NTD
    precision 0
    alias NT$ prefix
include "sub.hueke"
`,
    "sub.hueke": `option decimal-mark .
option group-mark ,
commodity USD
    precision 2
    alias US$ prefix
2026-10-12
    Expenses:Food  NT$1200
    Assets:Cash  -1200,5 NTD
2026-10-13
    Expenses:Food  US$15
    Assets:Cash
`,
  };
  const h = modules(files);
  const own = h.data.get("sub.hueke")?.items ?? [];
  const [food, dollars] = own.filter((r) => r.kind === "transaction");

  it("reads amounts with the root's marks and aliases, not the included module's", () => {
    expect(food && serialize(h, food)).toBe(
      "2026-10-12\n    Expenses:Food   1.200 NTD\n    Assets:Cash  -1.200,5 NTD\n",
    );
  });
  it("does not know an alias declared only in an included module", () => {
    expect(dollars).toBeDefined();
    if (dollars) expect(() => serialize(h, dollars)).toThrow();
  });
});

describe("serializing arithmetic", () => {
  it("keeps an expression as written and aligns on it", () => {
    expect(
      canonical(`2026-10-12 * "Dinner"
    Expenses:Food  ((100 + 50) * 2)NTD
    Expenses:Drinks  (1000/3) NTD
    Assets:Cash  -1,000.5  NTD
`),
    ).toEqual([
      `2026-10-12 * "Dinner"
    Expenses:Food  ((100 + 50) * 2) NTD
    Expenses:Drinks        (1000/3) NTD
    Assets:Cash            -1,000.5 NTD
`,
    ]);
  });
});

describe("account, entity and Balance entity forms", () => {
  it("puts account properties in order: display-name, obligation, pad-account, primary", () => {
    const text = `account Assets:Receivable %receivable
    ;; owner: me
    primary NTD
    pad-account Expenses:WriteOff
    obligation receivable
    display-name Money owed to me
`;
    const FORMATTED = `account Assets:Receivable %receivable
    display-name Money owed to me
    obligation receivable
    pad-account Expenses:WriteOff
    primary NTD
    ;; owner: me
`;
    expect(canonical(text)).toEqual([FORMATTED]);
    expect(canonical(FORMATTED)).toEqual([FORMATTED]);
  });
  it("writes an entity with its display name before its metadata", () => {
    const text = `entity NAT\n    ;; phone: 0912\n    display-name Nat Chen\n`;
    const FORMATTED = `entity NAT\n    display-name Nat Chen\n    ;; phone: 0912\n`;
    expect(canonical(text)).toEqual([FORMATTED]);
    expect(canonical(FORMATTED)).toEqual([FORMATTED]);
  });
  it("writes a Balance's entity after the account, without the person role", () => {
    const text = `2026-10-31   balance  Bank:Checking   @person:acme  52000 NTD
2026-10-20 balance Assets:Receivable:lunch-1011 @NAT 0 NTD pad -50 NTD -> Expenses:Discount
`;
    expect(canonical(text)).toEqual([
      "2026-10-31 balance Bank:Checking @acme 52,000 NTD\n",
      "2026-10-20 balance Assets:Receivable:lunch-1011 @NAT 0 NTD pad -50 NTD -> Expenses:Discount\n",
    ]);
  });
  it("keeps the meaning of what it writes", () => {
    const text = `entity acme
    display-name ACME Corp
account Bank:Checking %main-bank
    primary NTD
    display-name Main checking account

2026-10-05 * "October salary" @acme
    Bank:Checking     52000 NTD
    Income:Salary    -52000 NTD

2026-10-31 balance Bank:Checking @acme 52000 NTD
`;
    const h = ledger(text, { prelude: PRELUDE });
    const again = ledger(canonical(text).join("\n"), { prelude: PRELUDE });
    expect(meaning(again)).toEqual(meaning(h));
    const strip = (x: unknown) =>
      JSON.parse(JSON.stringify(x, (k, v: unknown) => (k === "span" ? undefined : v))) as unknown;
    expect(strip(again.entities)).toEqual(strip(h.entities));
    expect(strip(again.accounts)).toEqual(strip(h.accounts));
  });
});
