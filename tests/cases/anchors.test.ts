// docs/core/anchors.md
import { describe, expect, it } from "vitest";
import {
  balance,
  check,
  Hueke,
  obligations,
  parse,
  position,
  query,
  refunds,
} from "../../srcs/index.js";
import type { AccountTreeRow } from "../../srcs/index.js";
import { balanceOf, codes, descriptions, diagnostics, ledger, modules, rows } from "./ledger.js";

/** Every account tree row, subtotals included, as "account [subtotal] value commodity". */
const allRows = (tree: readonly AccountTreeRow[]): string[] =>
  tree.flatMap((r) =>
    r.amounts.map(
      (a) => `${r.account}${r.subtotal ? " (subtotal)" : ""} ${a.value} ${a.commodity}`,
    ),
  );

const messages = (h: Hueke, code: string): string[] => diagnostics(h, code).map((d) => d.message);

const transaction = (h: Hueke, description: string) =>
  h.transactions.find((t) => t.description === description);

describe("a trip with a budget, primary tags and plain tags", () => {
  const h = ledger(`
2026-10-18 %tokyo-trip "Tokyo trip"
    ;; budget: 60000 NTD

2026-10-18 * "Flight" ^tokyo-trip #travel
    Expenses:Transport     12000 NTD
    Bank:Checking         -12000 NTD

2026-10-19 * "Hotel" ^tokyo-trip #travel #claim
    Expenses:Lodging     8000 NTD
    Bank:Checking       -8000 NTD

2026-10-20 * "Lunch" #claim
    Expenses:Food     300 NTD
    Assets:Cash      -300 NTD
`);
  const q = query(h).axis("accounting").within("2026-10");

  it("checks out", () => {
    expect(codes(h)).toEqual([]);
  });
  it("finds the anchor's record by its ID", () => {
    const found = [...query(h).ids("tokyo-trip")];
    expect(descriptions(found)).toEqual(["Tokyo trip"]);
    expect(found[0]?.meta).toEqual({ budget: "60000 NTD" });
  });
  it("lists the members of the primary tag, without the anchor's record", () => {
    expect(descriptions(query(h).primaryTag("tokyo-trip"))).toEqual(["Flight", "Hotel"]);
  });
  it("lists the members of a tag", () => {
    expect(descriptions(query(h).tags("tag:travel"))).toEqual(["Flight", "Hotel"]);
    expect(descriptions(query(h).tags("tag:claim"))).toEqual(["Hotel", "Lunch"]);
  });
  it("totals the expenses of the primary tag", () => {
    expect(allRows(balance(h, q.accounts("Expenses").primaryTag("tokyo-trip")))).toEqual([
      "Expenses (subtotal) 20000 NTD",
      "Expenses:Lodging 8000 NTD",
      "Expenses:Transport 12000 NTD",
    ]);
  });
  it("matches every posting with only transaction-level clauses", () => {
    expect(allRows(balance(h, q.primaryTag("tokyo-trip")))).toEqual([
      "Bank (subtotal) -20000 NTD",
      "Bank:Checking -20000 NTD",
      "Expenses (subtotal) 20000 NTD",
      "Expenses:Lodging 8000 NTD",
      "Expenses:Transport 12000 NTD",
    ]);
  });
  it("groups by primary tag, the none group first", () => {
    expect(
      q
        .accounts("Expenses")
        .groupBy("primaryTag")
        .sum()
        .map((g) => [g.key.primaryTag, g.value.map((a) => `${a.value} ${a.commodity}`)]),
    ).toEqual([
      [null, ["300 NTD"]],
      ["tokyo-trip", ["20000 NTD"]],
    ]);
  });
  it("totals the expenses of an overlapping tag", () => {
    expect(allRows(balance(h, q.accounts("Expenses").tags("tag:claim")))).toEqual([
      "Expenses (subtotal) 8300 NTD",
      "Expenses:Food 300 NTD",
      "Expenses:Lodging 8000 NTD",
    ]);
  });
  it("sets the primary target to the anchor's record, and leaves the plain tags without one", () => {
    for (const name of ["Flight", "Hotel"]) {
      const t = transaction(h, name);
      expect(t?.primaryTag).toBe("tokyo-trip");
      expect(t?.primaryTarget).toBe("tokyo-trip");
      expect(t?.tags.find((x) => x.ref.name === "travel")).toStrictEqual({
        scope: "tag",
        ref: { name: "travel" },
      });
    }
    expect(transaction(h, "Tokyo trip")?.id).toBe("tokyo-trip");
  });
  it("gives a primary tag no target when no record defines its anchor", () => {
    const g = ledger(`
2026-10-18 * "Flight" ^tokyo-trip
    Expenses:Transport     12000 NTD
    Bank:Checking         -12000 NTD
`);
    expect(codes(g)).toEqual([]);
    const [t] = g.transactions;
    expect(t?.primaryTag).toBe("tokyo-trip");
    expect(t).not.toHaveProperty("primaryTarget");
    expect(descriptions(query(g).primaryTag("tokyo-trip"))).toEqual(["Flight"]);
  });
});

describe("resolving tags", () => {
  it("anchors a tag to a record written after it", () => {
    const h = ledger(`
2026-10-18 * "Flight" #trip-1018
    Expenses:Transport     12000 NTD
    Bank:Checking         -12000 NTD

2026-10-18 %trip-1018 "Tokyo trip"
`);
    expect(codes(h)).toEqual([]);
    expect(transaction(h, "Flight")?.tags).toEqual([
      { scope: "tag", ref: { name: "trip-1018" }, target: "trip-1018" },
    ]);
  });
  it("gives a posting's own tags and its transaction's, each with its target", () => {
    const h = ledger(`
2026-10-11 * "Hotel deposit"
    Expenses:Lodging     1000 NTD  %deposit-1011
    Bank:Checking       -1000 NTD

2026-10-12 * "Hotel" #deposit-1011
    Expenses:Lodging     3000 NTD  #trip
    Bank:Checking       -3000 NTD
`);
    expect(codes(h)).toEqual([]);
    const [lodging] = query(h).accounts("Expenses:Lodging").within("2026-10-12").postings();
    expect(lodging?.tags).toStrictEqual([
      { scope: "tag", ref: { name: "trip" } },
      { scope: "tag", ref: { name: "deposit-1011" }, target: "deposit-1011" },
    ]);
  });
  it("lets a posting carry its own transaction's anchor, and the other way round", () => {
    const h = ledger(`
2026-10-12 * %t_hotel "Hotel" #t_room
    Expenses:Lodging     3000 NTD  %t_room #t_hotel
    Bank:Checking       -3000 NTD
`);
    expect(codes(h)).toEqual([]);
    const [t] = h.transactions;
    expect(t?.tags).toEqual([{ scope: "tag", ref: { name: "t_room" }, target: "t_room" }]);
    expect(t?.postings[0]?.id).toBe("t_room");
  });
  it("skips a tag naming its own record", () => {
    const h = ledger(`
2026-10-12 * %t_hotel "Hotel" #t_hotel
    Expenses:Lodging     3000 NTD  %t_room #t_room
    Bank:Checking       -3000 NTD
`);
    expect(codes(h)).toEqual(["tag.self-reference", "tag.self-reference"]);
    const [t] = h.transactions;
    expect(t?.tags).toEqual([]);
    expect(t?.postings[0]?.tags).toEqual([]);
  });
  it("skips a primary tag naming its own transaction", () => {
    const h = ledger(`
2026-10-12 * %trip "Trip" ^trip
    Expenses:Lodging     3000 NTD
    Bank:Checking       -3000 NTD
`);
    expect(codes(h)).toEqual(["tag.self-reference"]);
    const [t] = h.transactions;
    expect(t).not.toHaveProperty("primaryTag");
    expect(t).not.toHaveProperty("primaryTarget");
    expect([...query(h).primaryTag("trip")]).toEqual([]);
  });
});

describe("anchors", () => {
  const BOOK = `
2026-10-03 * %t_book "Bookstore"
    Expenses:Other     500 NTD
    Assets:Cash       -500 NTD

2026-10-04 * %t_book "Bookstore again"
    Expenses:Other     300 NTD
    Assets:Cash       -300 NTD
`;
  it("defined twice: reported on the second, and neither defines it", () => {
    const h = ledger(BOOK);
    expect(codes(h)).toEqual(["anchor.duplicate"]);
    const [d] = diagnostics(h, "anchor.duplicate");
    expect(d?.severity).toBe("error");
    const data = h.data.get("main.hueke");
    const [first, second] = (data?.items ?? []).filter((i) => i.kind === "transaction");
    expect(first?.span && second?.span).toBeDefined();
    expect(d?.span?.start).toBe(second?.span?.start);
    if (data && first?.span)
      expect(d?.message).toContain(`main.hueke:${String(position(data, first.span.start).line)}`);
    expect(h.transactions.map((t) => t.id)).toEqual(["~1", "~2"]);
    expect([...query(h).ids("t_book")]).toEqual([]);
  });
  it("defined twice and by an account: two duplicates, and no record has it", () => {
    const h = ledger(`account Assets:Wallet %t_book\n${BOOK}\n2026-10-05 * "Tagged" #t_book\n`);
    expect(codes(h)).toEqual(["anchor.duplicate", "anchor.duplicate"]);
    expect(h.accounts.find((a) => a.id === "Assets:Wallet")).not.toHaveProperty("anchor");
    expect(h.transactions.some((t) => t.id === "t_book")).toBe(false);
    expect(transaction(h, "Tagged")?.tags).toStrictEqual([
      { scope: "tag", ref: { name: "t_book" } },
    ]);
  });
  it("defined twice: the result does not depend on which comes first", () => {
    const h = ledger(`
2026-10-03 * %x "First"
    Expenses:Other     500 NTD  %y
    Assets:Cash       -500 NTD

2026-10-04 * %y "Second"
`);
    expect(codes(h)).toEqual(["anchor.duplicate"]);
    expect(h.transactions.map((t) => t.id)).toEqual(["x", "~1"]);
    expect(h.transactions[0]?.postings.map((p) => p.id)).toEqual(["x.1", "x.2"]);
  });
  it("a block that could not be parsed defines no anchor", () => {
    const h = ledger(`
2026-10-03 * %t_book "Bookstore
    Expenses:Other     500 NTD
    Assets:Cash       -500 NTD

2026-10-04 * %t_book "Bookstore again"
    Expenses:Other     300 NTD
    Assets:Cash       -300 NTD
`);
    expect(codes(h)).toEqual(["parse.unterminated-string"]);
    expect(h.transactions.map((t) => t.id)).toEqual(["t_book"]);
  });
  it("compares anchors by text, case included", () => {
    const h = ledger(`
2026-10-03 * %Book "Bookstore"
    Expenses:Other     500 NTD
    Assets:Cash       -500 NTD

2026-10-04 * %book "Bookstore again"
    Expenses:Other     300 NTD
    Assets:Cash       -300 NTD
`);
    expect(codes(h)).toEqual([]);
    expect(h.transactions.map((t) => t.id)).toEqual(["Book", "book"]);
  });
  it("an invalid anchor name does not load the block", () => {
    const h = ledger(`
2026-10-05 * %lunch.1005 "Lunch"
    Expenses:Food     180 NTD
    Assets:Cash      -180 NTD
`);
    expect(codes(h)).toEqual(["anchor.invalid-name"]);
    expect(check(h)[0]?.severity).toBe("error");
    expect(h.transactions).toEqual([]);
  });
  it("a transaction not loaded still holds its anchor", () => {
    const h = ledger(`
2026-10-03 * %t_book "Bookstore"
    Expenses:Other
    Assets:Cash

2026-10-04 * %t_book "Bookstore again"
    Expenses:Other     300 NTD
    Assets:Cash       -300 NTD

2026-10-05 * "Tagged" #t_book

2026-10-06 * "Refund of a transaction not loaded" #refund:t_late
    Assets:Cash        30 NTD
    Expenses:Other    -30 NTD

2026-10-07 * %t_late "Late"
    Expenses:Other
    Assets:Cash
`);
    expect(codes(h).sort()).toEqual([
      "anchor.duplicate",
      "tag.wrong-target",
      "txn.amount-not-inferable",
      "txn.amount-not-inferable",
    ]);
    expect(transaction(h, "Bookstore again")?.id).toBe("~2");
    expect(transaction(h, "Tagged")?.tags).toStrictEqual([
      { scope: "tag", ref: { name: "t_book" } },
    ]);
    expect(transaction(h, "Refund of a transaction not loaded")?.tags).toEqual([]);
  });
});

describe("scopes", () => {
  const h = ledger(`
2026-10-11 ! "Hotel deposit"
    Expenses:Lodging     1000 NTD  %deposit-1011
    Bank:Checking       -1000 NTD

2026-10-12 * "Camera strap" #category:camera
    Expenses:Equipment     900 NTD
    Assets:Cash           -900 NTD

2026-10-15 * "Refund written on a posting"
    Assets:Cash        30 NTD  #refund:t_self
    Expenses:Food     -30 NTD

2026-10-16 * "Refund of the wrong record" #refund:deposit-1011
    Assets:Cash       100 NTD
    Expenses:Food    -100 NTD

2026-10-17 * %t_self "Refund of itself" #refund:t_self
    Assets:Cash        50 NTD
    Expenses:Food     -50 NTD

2026-10-25 * "Hand-written padding" #system:balance
    Bank:Checking              10 NTD
    Expenses:ReconcileDiff    -10 NTD
`);
  it("reports each faulty tag", () => {
    expect(codes(h)).toEqual([
      "tag.unknown-scope",
      "tag.wrong-level",
      "tag.wrong-target",
      "tag.self-reference",
      "tag.reserved-scope",
    ]);
    for (const d of check(h)) expect(d.severity).toBe("error");
  });
  it("reports each on the record the tag is written on", () => {
    const start = (description: string, posting?: number) => {
      const t = transaction(h, description);
      return posting === undefined ? t?.span?.start : t?.postings[posting]?.span?.start;
    };
    const starts = check(h).map((d) => d.span?.start);
    expect(starts.every((x) => x !== undefined)).toBe(true);
    expect(starts).toEqual([
      start("Camera strap"),
      start("Refund written on a posting", 0),
      start("Refund of the wrong record"),
      start("Refund of itself"),
      start("Hand-written padding"),
    ]);
  });
  it("loads every transaction without the faulty tag", () => {
    expect(h.transactions).toHaveLength(6);
    for (const t of h.transactions) {
      expect(t.tags).toEqual([]);
      for (const p of t.postings) expect(p.tags).toEqual([]);
    }
  });
  it("keeps the faulty tag in the Raw record", () => {
    expect(transaction(h, "Camera strap")?.origin?.tags).toEqual([
      { scope: "category", ref: { name: "camera" } },
    ]);
  });
  it("refund names a planned or cancelled transaction, an account or no record: wrong target", () => {
    const g = ledger(`
account Assets:Wallet %wallet

2026-10-03 ! %t_planned "Planned"
    Expenses:Other     500 NTD
    Assets:Cash       -500 NTD

2026-10-04 # %t_cancelled "Cancelled"
    Expenses:Other     500 NTD
    Assets:Cash       -500 NTD

2026-10-10 * "Refund" #refund:t_planned #refund:t_cancelled #refund:wallet #refund:nowhere
    Assets:Cash        30 NTD
    Expenses:Other    -30 NTD
`);
    expect(codes(g)).toEqual(Array(4).fill("tag.wrong-target"));
  });
  it("a transaction's tags on its postings are not checked again", () => {
    const g = ledger(`
2026-10-03 * %t_book "Bookstore"
    Expenses:Other     500 NTD
    Assets:Cash       -500 NTD

2026-10-20 * "Returned one book" #refund:t_book
    Assets:Cash        200 NTD
    Expenses:Other    -200 NTD
`);
    expect(codes(g)).toEqual([]);
    expect(query(g).tags("refund:t_book").postings()).toHaveLength(2);
  });
  it("a system tag on a posting is reserved as well", () => {
    const g = ledger(`
2026-10-25 * "Hand-written padding"
    Bank:Checking              10 NTD  #system:balance
    Expenses:ReconcileDiff    -10 NTD
`);
    expect(codes(g)).toEqual(["tag.reserved-scope"]);
    expect(g.transactions[0]?.postings[0]?.span).toBeDefined();
    expect(check(g)[0]?.span?.start).toBe(g.transactions[0]?.postings[0]?.span?.start);
    expect(g.transactions[0]?.postings[0]?.tags).toEqual([]);
    expect(g.transactions[0]?.postings[0]?.origin?.tags).toHaveLength(1);
  });
  it("tag on a posting", () => {
    const g = ledger(`
2026-10-12 * "Taxi"
    Expenses:Transport     300 NTD  #tag:travel
    Assets:Cash           -300 NTD
`);
    expect(codes(g)).toEqual([]);
    expect(
      query(g)
        .tags("tag:travel")
        .postings()
        .map((p) => p.account),
    ).toEqual(["Expenses:Transport"]);
  });
});

describe("primary tags", () => {
  it("a second ^ on a header does not load the block, found by the parser", () => {
    const text = `
2026-10-12 * "Taxi" ^trip ^work
    Expenses:Transport     300 NTD
    Assets:Cash           -300 NTD
`;
    expect(parse("main.hueke", text).diagnostics.map((d) => d.code)).toEqual([
      "txn.multiple-primary-tag",
    ]);
    const h = ledger(text);
    expect(codes(h)).toEqual(["txn.multiple-primary-tag"]);
    expect(check(h)[0]?.severity).toBe("error");
    expect(h.transactions).toEqual([]);
  });
  it("group, filter and total the same whether a record defines the anchor or not", () => {
    const FLIGHTS = `
2026-10-18 * "Flight" ^tokyo-trip
    Expenses:Transport     12000 NTD
    Bank:Checking         -12000 NTD

2026-10-19 * "Hotel" ^tokyo-trip
    Expenses:Lodging     8000 NTD
    Bank:Checking       -8000 NTD

2026-10-20 * "Lunch"
    Expenses:Food     300 NTD
    Assets:Cash      -300 NTD
`;
    const plain = ledger(FLIGHTS);
    const anchored = ledger(`2026-10-18 %tokyo-trip "Tokyo trip"\n${FLIGHTS}`);
    expect(codes(plain)).toEqual([]);
    expect(codes(anchored)).toEqual([]);
    const views = (h: Hueke) => ({
      members: descriptions(query(h).primaryTag("tokyo-trip")),
      groups: query(h).accounts("Expenses").groupBy("primaryTag").sum(),
      totals: balance(h, query(h).primaryTag("tokyo-trip")),
    });
    expect(views(anchored)).toEqual(views(plain));
    expect(views(plain).members).toEqual(["Flight", "Hotel"]);
  });
  it("never overlap, unlike tags", () => {
    const h = ledger(`
2026-10-12 * "Taxi" ^trip #a #b
    Expenses:Transport     300 NTD
    Assets:Cash           -300 NTD

2026-10-13 * "Lunch"
    Expenses:Food     100 NTD
    Assets:Cash      -100 NTD
`);
    const sum = (key: "primaryTag" | "tag") =>
      query(h)
        .accounts("Expenses")
        .groupBy(key)
        .sum()
        .map((g) => g.value[0]?.value);
    expect(sum("primaryTag")).toEqual(["100", "300"]);
    expect(sum("tag")).toEqual(["100", "300", "300"]);
  });
});

describe("refunds", () => {
  it("a partial refund", () => {
    const h = ledger(`
2026-10-03 * %t_book "Bookstore"
    Expenses:Other     500 NTD
    Assets:Cash       -500 NTD

2026-10-20 * "Returned one book" #refund:t_book
    Assets:Cash        200 NTD
    Expenses:Other    -200 NTD
`);
    expect(codes(h)).toEqual([]);
    expect(rows(balance(h, query(h).accounts("Expenses:Other").within("2026-10")))).toEqual([
      "Expenses:Other 300 NTD",
    ]);
    expect(descriptions(query(h).tags("refund:t_book"))).toEqual(["Returned one book"]);
    expect(descriptions(query(h).ids("t_book"))).toEqual(["Bookstore"]);
  });
  it("a full refund, the money back later", () => {
    const h = ledger(`
2026-10-12 * %t_hp "Headphones"
    Expenses:Equipment     1500 NTD
    Bank:Checking         -1500 NTD

2026-10-18 * "Headphones returned, full refund" #refund:t_hp
    Expenses:Equipment    -1500 NTD
    Bank:Checking          1500 NTD [2026-10-21]
`);
    expect(codes(h)).toEqual([]);
    expect(
      rows(balance(h, query(h).axis("accounting").accounts("Expenses").within("2026-10"))),
    ).toEqual(["Expenses:Equipment 0 NTD"]);
    expect(balanceOf(h, "Bank:Checking", "2026-10-20")).toBe("-1500");
    expect(balanceOf(h, "Bank:Checking", "2026-10-21")).toBe("0");
  });
  it("a fee kept by the shop is not counted as short", () => {
    const h = ledger(`
2026-10-10 * %t_sofa "Sofa"
    Expenses:Furniture     5000 NTD
    Bank:Checking         -5000 NTD

2026-10-20 * "Sofa returned, 10% restocking fee" #refund:t_sofa
    Bank:Checking          4500 NTD
    Expenses:Fees           500 NTD
    Expenses:Furniture    -5000 NTD
`);
    expect(codes(h)).toEqual([]);
    expect(rows(balance(h, query(h).accounts("Expenses").within("2026-10")))).toEqual([
      "Expenses:Fees 500 NTD",
      "Expenses:Furniture 0 NTD",
    ]);
    expect(balanceOf(h, "Bank:Checking", "2026-10-20")).toBe("-500");
  });
  it("refunds beyond the original: one warning, on the refund that first exceeds", () => {
    const h = ledger(`
2026-10-03 * %t_gift "Gift"
    Expenses:Other     500 NTD
    Assets:Cash       -500 NTD

2026-10-10 * "Partly refunded" #refund:t_gift
    Assets:Cash        300 NTD
    Expenses:Other    -300 NTD

2026-10-20 * "Shop added compensation" #refund:t_gift
    Assets:Cash        300 NTD
    Expenses:Other    -300 NTD
`);
    expect(codes(h)).toEqual(["refund.exceeds"]);
    const [d] = diagnostics(h, "refund.exceeds");
    expect(d?.severity).toBe("warning");
    const shop = transaction(h, "Shop added compensation");
    expect(shop?.span).toBeDefined();
    expect(d?.span?.start).toBe(shop?.span?.start);
    for (const part of ["t_gift", "Expenses:Other", "500 NTD", "600 NTD"])
      expect(d?.message).toContain(part);
    expect(rows(balance(h, query(h).accounts("Expenses:Other").within("2026-10")))).toEqual([
      "Expenses:Other -100 NTD",
    ]);
  });
  it("reports once however many accounts exceed, and counts only occurred refunds", () => {
    const h = ledger(`
2026-10-03 * %t_trip "Trip"
    Expenses:Food        500 NTD
    Expenses:Lodging     500 NTD
    Assets:Cash        -1000 NTD

2026-10-10 * "Refund beyond both" #refund:t_trip
    Assets:Cash          1400 NTD
    Expenses:Food        -700 NTD
    Expenses:Lodging     -700 NTD

2026-10-11 ! "Planned refund" #refund:t_trip
    Assets:Cash          1000 NTD
    Expenses:Food       -1000 NTD
`);
    expect(codes(h)).toEqual(["refund.exceeds"]);
    const [text] = messages(h, "refund.exceeds");
    for (const part of ["Expenses:Food", "Expenses:Lodging", "original 500 NTD"])
      expect(text).toContain(part);
    // The planned refund is not counted: each account shows 700 NTD refunded.
    expect(text?.match(/refunded \d+ NTD/g)).toEqual(["refunded 700 NTD", "refunded 700 NTD"]);
  });
  it("a refund within the tolerance does not exceed", () => {
    const h = ledger(`
2026-10-03 * %t_usd "Online order"
    Expenses:Other     10.00 USD
    Bank:Checking     -10.00 USD

2026-10-10 * "Refund" #refund:t_usd
    Bank:Checking      10.004 USD
    Expenses:Other    -10.004 USD
`);
    expect(diagnostics(h, "refund.exceeds")).toEqual([]);
  });
  it("a refund beyond the tolerance exceeds", () => {
    const h = ledger(`
2026-10-03 * %t_usd "Online order"
    Expenses:Other     10.00 USD
    Bank:Checking     -10.00 USD

2026-10-10 * "Refund" #refund:t_usd
    Bank:Checking      10.006 USD
    Expenses:Other    -10.006 USD
`);
    expect(diagnostics(h, "refund.exceeds")).toHaveLength(1);
  });
  it("measures income accounts too", () => {
    const h = ledger(`
2026-10-03 * %t_sale "Sold a lamp"
    Assets:Cash        500 NTD
    Income:Sales      -500 NTD

2026-10-10 * "Took the lamp back, paid more" #refund:t_sale
    Income:Sales       600 NTD
    Assets:Cash       -600 NTD
`);
    expect(codes(h)).toEqual(["refund.exceeds"]);
    const [text] = messages(h, "refund.exceeds");
    for (const part of ["Income:Sales", "500 NTD", "600 NTD"]) expect(text).toContain(part);
  });
  it("measures only the original's accounts and commodities", () => {
    const h = ledger(`
2026-10-03 * %t_book "Bookstore"
    Expenses:Other     500 NTD
    Assets:Cash       -500 NTD

2026-10-10 * "Refunded on another account" #refund:t_book
    Assets:Cash        800 NTD
    Expenses:Food     -800 NTD

2026-10-11 * "Refunded in another commodity" #refund:t_book
    Assets:Cash        30 USD
    Expenses:Other    -30 USD
`);
    expect(codes(h)).toEqual([]);
  });
  it("names in the message every refund in the ledger, not only those up to the report", () => {
    const h = ledger(`
2026-10-03 * %t_gift "Gift"
    Expenses:Other     500 NTD
    Assets:Cash       -500 NTD

2026-10-10 * "Refunded too much" #refund:t_gift
    Assets:Cash        600 NTD
    Expenses:Other    -600 NTD

2026-10-20 * "Refunded again" #refund:t_gift
    Assets:Cash        100 NTD
    Expenses:Other    -100 NTD
`);
    expect(codes(h)).toEqual(["refund.exceeds"]);
    const [d] = diagnostics(h, "refund.exceeds");
    expect(transaction(h, "Refunded too much")?.span).toBeDefined();
    expect(d?.span?.start).toBe(transaction(h, "Refunded too much")?.span?.start);
    expect(d?.message).toContain("refunded 700 NTD");
  });

  describe("a refund naming a posting", () => {
    const LOTTERY = `
account Assets:Receivable
    obligation receivable

2026-10-05 * %t_lottery "Stock lottery" @broker
    Assets:Receivable:lottery-1005    50000 NTD  %p_subscription @broker
    Expenses:Fees                        20 NTD
    Bank:Checking                    -50020 NTD

2026-10-08 * "Lottery not won" #refund:p_subscription
    Assets:Receivable:lottery-1005   -50000 NTD
    Bank:Checking                     50000 NTD
`;
    const h = ledger(LOTTERY);

    it("is measured on that posting alone, whatever its account type", () => {
      expect(codes(h)).toEqual([]);
    });
    it("naming the transaction instead measures only its expense postings", () => {
      const whole = ledger(LOTTERY.replace("#refund:p_subscription", "#refund:t_lottery"));
      expect(codes(whole)).toEqual([]);
      expect(
        refunds(whole).map(
          (r) => `${r.account} ${r.original.value}/${r.refunded.value}/${r.remaining.value}`,
        ),
      ).toEqual(["Expenses:Fees 20/0/20"]);
    });
    it("settles the receivable it refunds", () => {
      const [r] = obligations(h, { all: true });
      expect(r?.account).toBe("Assets:Receivable:lottery-1005");
      expect(r?.settled).toBe(true);
      expect(r?.remaining).toEqual({ value: "0", commodity: "NTD" });
    });
    it("is a member of the posting's refund tag", () => {
      expect(descriptions(query(h).tags("refund:p_subscription"))).toEqual(["Lottery not won"]);
    });
    it("refunded twice: one warning, and the obligation is over-repaid", () => {
      const g = ledger(`${LOTTERY}
2026-10-09 * "Refunded twice" #refund:p_subscription
    Assets:Receivable:lottery-1005   -50000 NTD
    Bank:Checking                     50000 NTD
`);
      expect(codes(g)).toEqual(["refund.exceeds"]);
      const [d] = diagnostics(g, "refund.exceeds");
      expect(transaction(g, "Refunded twice")?.span).toBeDefined();
      expect(d?.span?.start).toBe(transaction(g, "Refunded twice")?.span?.start);
      for (const part of [
        "p_subscription",
        "Assets:Receivable:lottery-1005",
        "original 50000 NTD",
        "refunded 100000 NTD",
      ])
        expect(d?.message).toContain(part);
      const [r] = obligations(g, { all: true });
      expect(r?.remaining).toEqual({ value: "-50000", commodity: "NTD" });
    });
    it("does not measure the other postings of the original transaction", () => {
      const g = ledger(`${LOTTERY}
2026-10-09 * "Fee refunded with compensation" #refund:p_subscription
    Expenses:Fees     -100 NTD
    Bank:Checking      100 NTD
`);
      expect(codes(g)).toEqual([]);
    });
    it("a posting of the transaction the tag is written on: wrong target", () => {
      const g = ledger(`
2026-10-06 * "Own posting" #refund:p_own
    Assets:Cash        30 NTD  %p_own
    Expenses:Food     -30 NTD
`);
      expect(codes(g)).toEqual(["tag.wrong-target"]);
      expect(transaction(g, "Own posting")?.tags).toEqual([]);
    });
    it("a posting of a planned transaction: wrong target", () => {
      const g = ledger(`
2026-10-03 ! "Planned deposit"
    Expenses:Lodging     1000 NTD  %p_planned
    Bank:Checking       -1000 NTD

2026-10-10 * "Refund" #refund:p_planned
    Bank:Checking        1000 NTD
    Expenses:Lodging    -1000 NTD
`);
      expect(codes(g)).toEqual(["tag.wrong-target"]);
    });
  });
});

describe("the refunds function", () => {
  const h = ledger(`
2026-10-03 * %t_gift "Gift"
    Expenses:Other     500 NTD
    Assets:Cash       -500 NTD

2026-10-04 * %t_trip "Trip" #travel
    Expenses:Lodging     1000 NTD
    Expenses:Food         400 NTD  %p_food
    Bank:Checking       -1400 NTD

2026-10-05 * %t_sale "Sold a lamp"
    Assets:Cash        500 NTD
    Income:Sales      -500 NTD

2026-10-10 * %r_gift1 "Partly refunded" #refund:t_gift
    Assets:Cash        300 NTD
    Expenses:Other    -300 NTD

2026-10-11 * %r_trip "Lodging back" #refund:t_trip
    Bank:Checking      1000 NTD
    Expenses:Lodging  -1000 NTD

2026-10-12 * %r_sale "Lamp returned" #refund:t_sale
    Assets:Cash       -200 NTD
    Income:Sales       200 NTD

2026-10-13 ! "Planned refund" #refund:t_gift
    Assets:Cash        200 NTD
    Expenses:Other    -200 NTD

2026-10-14 * %r_food "Food back" #refund:p_food
    Bank:Checking        50 NTD
    Expenses:Food       -50 NTD

2026-10-20 * %r_gift2 "Shop added compensation" #refund:t_gift
    Assets:Cash        300 NTD
    Expenses:Other    -300 NTD
`);
  const line = (r: ReturnType<typeof refunds>[number]): string =>
    `${r.target} ${r.account} ${r.original.value}/${r.refunded.value}/${r.remaining.value}` +
    `${r.full ? " full" : ""}${r.exceeds ? " exceeds" : ""} [${r.refunds.join(",")}]`;

  it("lists every refunded record in transaction order, a posting after its transaction", () => {
    expect(codes(h)).toEqual(["refund.exceeds"]);
    expect(refunds(h).map(line)).toEqual([
      "t_gift Expenses:Other 500/600/-100 exceeds [r_gift1,r_gift2]",
      "t_trip Expenses:Lodging 1000/1000/0 full [r_trip]",
      "t_trip Expenses:Food 400/0/400 [r_trip]",
      "p_food Expenses:Food 400/50/350 [r_food]",
      "t_sale Income:Sales 500/200/300 [r_sale]",
    ]);
  });
  it("gives amounts in the record's commodity", () => {
    const [r] = refunds(h, { ids: ["t_gift"] });
    expect(r?.original).toEqual({ value: "500", commodity: "NTD" });
    expect(r?.remaining).toEqual({ value: "-100", commodity: "NTD" });
  });
  it("takes the IDs of refunded records; other IDs give no rows", () => {
    expect(refunds(h, { ids: ["p_food", "t_sale"] }).map((r) => r.target)).toEqual([
      "p_food",
      "t_sale",
    ]);
    expect(refunds(h, { ids: ["r_gift1", "nowhere"] })).toEqual([]);
  });
  it("lists every refunded record when given an empty list of IDs", () => {
    expect(refunds(h, { ids: [] }).map(line)).toEqual(refunds(h).map(line));
    expect(refunds(h, { ids: [] })).toHaveLength(5);
  });
  it("a record named only by a planned refund is listed with nothing refunded", () => {
    const g = ledger(`
2026-10-03 * %t_book "Bookstore"
    Expenses:Other     500 NTD
    Assets:Cash       -500 NTD

2026-10-20 ! "Refund to come" #refund:t_book
    Assets:Cash        500 NTD
    Expenses:Other    -500 NTD
`);
    expect(refunds(g).map(line)).toEqual(["t_book Expenses:Other 500/0/500 []"]);
  });
  it("full and exceeds follow the tolerance", () => {
    const within = ledger(`
2026-10-03 * %t_usd "Online order"
    Expenses:Other     10.00 USD
    Bank:Checking     -10.00 USD

2026-10-10 * "Refund" #refund:t_usd
    Bank:Checking      10.004 USD
    Expenses:Other    -10.004 USD
`);
    expect(refunds(within).map((r) => [r.full, r.exceeds])).toEqual([[true, false]]);
  });
  it("throws before initialization", () => {
    expect(() => refunds(new Hueke())).toThrow();
  });
});

describe("looking up by ID", () => {
  const h = ledger(`
2026-10-11 * %t_dinner "Dinner"
    Expenses:Food     600 NTD  %p_food
    Assets:Cash      -600 NTD

2026-10-12 * "Taxi"
    Expenses:Transport     300 NTD
    Assets:Cash           -300 NTD

2026-10-13 ! %t_plan "Planned"
    Expenses:Other     100 NTD
    Assets:Cash       -100 NTD
`);
  const ids = (q: ReturnType<typeof query>) => q.postings().map((p) => p.id);

  it("a transaction's ID matches every posting of it", () => {
    expect(codes(h)).toEqual([]);
    expect(ids(query(h).ids("t_dinner"))).toEqual(["p_food", "t_dinner.2"]);
    expect(ids(query(h).ids("t_dinner").accounts("Assets"))).toEqual(["t_dinner.2"]);
  });
  it("a posting's ID matches its transaction and only that posting", () => {
    expect(descriptions(query(h).ids("p_food"))).toEqual(["Dinner"]);
    expect(ids(query(h).ids("p_food"))).toEqual(["p_food"]);
    expect(ids(query(h).ids("p_food").accounts("Assets"))).toEqual([]);
  });
  it("takes generated IDs and several values", () => {
    expect(descriptions(query(h).ids("~1"))).toEqual(["Taxi"]);
    expect(
      query(h)
        .ids("~1.1")
        .postings()
        .map((p) => p.account),
    ).toEqual(["Expenses:Transport"]);
    expect(descriptions(query(h).ids("~1", "t_dinner"))).toEqual(["Dinner", "Taxi"]);
  });
  it("follows the query's occurrence", () => {
    expect([...query(h).ids("t_plan")]).toEqual([]);
    expect(descriptions(query(h).ids("t_plan").occurrence("planned"))).toEqual(["Planned"]);
    const g = ledger(
      `2026-10-13 # %t_gone "Cancelled"\n    Expenses:Other  100 NTD\n    Assets:Cash\n`,
    );
    expect([...query(g).ids("t_gone")]).toEqual([]);
    expect(descriptions(query(g).ids("t_gone").occurrence("cancelled"))).toEqual(["Cancelled"]);
  });
  it("an ID no record has matches nothing", () => {
    expect([...query(h).ids("nowhere")]).toEqual([]);
    expect(codes(h)).toEqual([]);
  });
  it("finds an account by its anchor in the ledger's accounts, not in a query", () => {
    const g = ledger(`
account Bank:Checking %main-bank

2026-10-12 * "Deposit"
    Bank:Checking     100 NTD
    Assets:Cash      -100 NTD
`);
    expect([...query(g).ids("main-bank")]).toEqual([]);
    expect(g.accounts.find((a) => a.anchor === "main-bank")?.id).toBe("Bank:Checking");
  });
});

describe("refunds in order and across modules", () => {
  it("reports each refunded transaction in the order of the refund that first exceeds", () => {
    const h = ledger(`
2026-10-01 * %t_a "Shop A"
    Expenses:Other     500 NTD
    Assets:Cash       -500 NTD

2026-10-02 * %t_b "Shop B"
    Expenses:Other     500 NTD
    Assets:Cash       -500 NTD

2026-10-10 * "A refunds part" #refund:t_a
    Assets:Cash        100 NTD
    Expenses:Other    -100 NTD

2026-10-11 * "B refunds too much" #refund:t_b
    Assets:Cash        600 NTD
    Expenses:Other    -600 NTD

2026-10-12 * "A refunds the rest and more" #refund:t_a
    Assets:Cash        500 NTD
    Expenses:Other    -500 NTD
`);
    const exceeds = diagnostics(h, "refund.exceeds");
    expect(codes(h)).toEqual(["refund.exceeds", "refund.exceeds"]);
    const at = (description: string) =>
      h.transactions.find((t) => t.description === description)?.span?.start;
    expect([at("B refunds too much"), at("A refunds the rest and more")]).not.toContain(undefined);
    expect(exceeds.map((d) => d.span?.start)).toEqual([
      at("B refunds too much"),
      at("A refunds the rest and more"),
    ]);
    expect(exceeds[0]?.message).toContain("t_b");
    expect(exceeds[1]?.message).toContain("t_a");
    expect(exceeds[1]?.message).toContain("600 NTD");
  });

  const ROOT = "option timezone Asia/Taipei\ninclude 2026/10.hueke\n";
  const GIFT = `
2026-10-03 * %t_gift "Gift"
    Expenses:Other     500 NTD
    Assets:Cash       -500 NTD
`;
  const REFUNDS = `
2026-10-10 * "Partly refunded" #refund:t_gift
    Assets:Cash        300 NTD
    Expenses:Other    -300 NTD

2026-10-20 * "Shop added compensation" #refund:t_gift
    Assets:Cash        300 NTD
    Expenses:Other    -300 NTD
`;
  it("an original in an included module, refunded in the root", () => {
    const h = modules({ "main.hueke": `${ROOT}${REFUNDS}`, "2026/10.hueke": GIFT });
    expect(codes(h)).toEqual(["refund.exceeds"]);
    const [d] = diagnostics(h, "refund.exceeds");
    expect(d?.source).toBe("main.hueke");
    expect(descriptions(query(h).tags("refund:t_gift"))).toEqual([
      "Partly refunded",
      "Shop added compensation",
    ]);
    expect(descriptions(query(h).ids("t_gift"))).toEqual(["Gift"]);
  });
  it("an original in the root, refunded in an included module", () => {
    const h = modules({ "main.hueke": `${ROOT}${GIFT}`, "2026/10.hueke": REFUNDS });
    expect(codes(h)).toEqual(["refund.exceeds"]);
    const [d] = diagnostics(h, "refund.exceeds");
    expect(d?.source).toBe("2026/10.hueke");
    const [refund] = h.transactions.filter((t) => t.description === "Partly refunded");
    expect(refund?.tags).toEqual([{ scope: "refund", ref: { name: "t_gift" }, target: "t_gift" }]);
  });
});

describe("anchors of a transaction dropped for unsupported syntax", () => {
  const DROPPED = `
2026-10-01 * %t_card "Card payment" #statement:card
    Liabilities:Card     900 NTD  %p_card
    Bank:Checking       -900 NTD

2026-10-02 * %rent/2026-10 "Rent"
    Expenses:Rent      20000 NTD
    Bank:Checking     -20000 NTD
`;
  it("its anchors count for anchor.duplicate when it comes first", () => {
    const h = ledger(`${DROPPED}
2026-10-05 * %t_card "Card payment again"
    Liabilities:Card     100 NTD  %p_card
    Bank:Checking       -100 NTD
`);
    expect(codes(h)).toEqual([
      "syntax.unsupported",
      "syntax.unsupported",
      "anchor.duplicate",
      "anchor.duplicate",
    ]);
    const [again] = h.transactions;
    // Neither definition defines t_card, so the dropped one is ~1 and this one ~2.
    expect(again?.id).toBe("~2");
    expect(again?.postings.map((p) => p.id)).toEqual(["~2.1", "~2.2"]);
  });
  it("its anchors count for anchor.duplicate when it comes second", () => {
    const h = ledger(`
2026-09-30 * %t_card "Card payment first"
    Liabilities:Card     100 NTD
    Bank:Checking       -100 NTD
${DROPPED}`);
    expect(codes(h).filter((c) => c === "anchor.duplicate")).toHaveLength(1);
    expect(h.transactions.map((t) => t.id)).toEqual(["~1"]);
  });
  it("a tag naming its anchor is plain, and a refund to it is a wrong target", () => {
    const h = ledger(`${DROPPED}
2026-10-05 * "Tagged" #t_card
    Liabilities:Card     100 NTD  #p_card
    Bank:Checking       -100 NTD

2026-10-06 * "Refund" #refund:t_card
    Bank:Checking       100 NTD
    Expenses:Other     -100 NTD
`);
    expect(codes(h)).toEqual(["syntax.unsupported", "syntax.unsupported", "tag.wrong-target"]);
    const tagged = transaction(h, "Tagged");
    expect(tagged?.tags).toStrictEqual([{ scope: "tag", ref: { name: "t_card" } }]);
    expect(tagged?.postings[0]?.tags).toStrictEqual([
      { scope: "tag", ref: { name: "p_card" } },
      { scope: "tag", ref: { name: "t_card" } },
    ]);
    expect(transaction(h, "Refund")?.tags).toEqual([]);
    expect([...query(h).ids("t_card")]).toEqual([]);
  });
  it("an account anchor taken by a dropped transaction is a duplicate", () => {
    const h = ledger(`account Bank:Checking %t_card\n${DROPPED}`);
    expect(codes(h)).toContain("anchor.duplicate");
    expect(h.accounts.find((a) => a.id === "Bank:Checking")).not.toHaveProperty("anchor");
  });
});
