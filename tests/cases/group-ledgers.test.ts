// docs/core/group-ledgers.md
import { describe, expect, it } from "vitest";
import { balance, query } from "../../srcs/index.js";
import type { Hueke, Transaction } from "../../srcs/index.js";
import { balanceOf, codes, descriptions, diagnostics, modules, rows } from "./ledger.js";

const GROUP = `module shared "Tokyo trip"
    share @SUBANG 1
    share @AMY 1
    share @BOB 1

option timezone Asia/Taipei
commodity NTD
    precision 0
account-root Pay asset

2026-10-18 * %hotel "Hotel"
    Expenses:Lodging   10000 NTD
    Pay:Card          -10000 NTD @SUBANG

2026-10-19 * %dinner "Dinner, BOB was not there"
    Expenses:Food   3000 NTD
        split @SUBANG @AMY
    Pay:Cash       -3000 NTD @SUBANG

2026-10-20 * %taxi "Taxi"
    Expenses:Transport   600 NTD
    Pay:Cash            -600 NTD @AMY

2026-10-30 * %pay-amy "AMY pays SUBANG"
    Pay:Transfer    4430 NTD @SUBANG
    Pay:Transfer   -4430 NTD @AMY

2026-10-30 * %pay-bob "BOB pays SUBANG"
    Pay:Transfer    3540 NTD @SUBANG
    Pay:Transfer   -3540 NTD @BOB
`;

const MAPS = `    map Expenses -> Expenses:Travel
    map Pay:Cash -> Assets:Cash
    map Pay:Transfer -> Bank:Checking
    map Pay:Card -> Liabilities:Card
`;

/** SUBANG's ledger, without the Balance that closes the shared account. */
const OPEN = `option timezone Asia/Taipei
commodity NTD
    precision 0
account-root Bank asset
account-root Shared shared

account Shared:tokyo-trip
    source trips/tokyo.hueke as ^tokyo-trip
    self @SUBANG
${MAPS}    pad-account Expenses:Rounding
`;
/** The trip as an event of SUBANG's ledger, which the group tags link to. */
const EVENT = '2026-10-18..2026-10-20 %shared:tokyo-trip "Tokyo trip" #travel\n';
const CLOSE = "2026-11-01 balance Shared:tokyo-trip 0 NTD pad 3 NTD\n";
const MAIN = `${OPEN}\n${EVENT}\n${CLOSE}`;

const trip = (main = OPEN, group = GROUP, more: Record<string, string> = {}): Hueke =>
  modules({ "main.hueke": main, "trips/tokyo.hueke": group, ...more });

/** Each transaction as "id: account value, …". */
const postings = (ts: Iterable<Transaction>): string[] =>
  [...ts].map(
    (t) => `${t.id}: ${t.postings.map((p) => `${p.account} ${p.amount.value}`).join(", ")}`,
  );
const converted = (h: Hueke): string[] =>
  postings(
    h.transactions.filter((t) =>
      t.tags.some((g) => g.scope === "system" && g.ref.name === "shared"),
    ),
  );

describe("the example", () => {
  it("converts each group transaction", () => {
    const h = trip(MAIN);
    expect(codes(h)).toEqual([]);
    expect(converted(h)).toEqual([
      "shared:tokyo-trip:hotel: Expenses:Travel:Lodging 10000/3, Liabilities:Card -10000, Shared:tokyo-trip 20000/3",
      "shared:tokyo-trip:dinner: Expenses:Travel:Food 1500, Assets:Cash -3000, Shared:tokyo-trip 1500",
      "shared:tokyo-trip:taxi: Expenses:Travel:Transport 200, Shared:tokyo-trip -200",
      "shared:tokyo-trip:pay-amy: Bank:Checking 4430, Shared:tokyo-trip -4430",
      "shared:tokyo-trip:pay-bob: Bank:Checking 3540, Shared:tokyo-trip -3540",
    ]);
  });
  it("gives the position, closed by a pad with written padding", () => {
    const h = trip(MAIN);
    expect(balanceOf(h, "Shared:tokyo-trip", "2026-10-20")).toBe("23900/3");
    expect(balanceOf(h, "Shared:tokyo-trip", "2026-10-31")).toBe("-10/3");
    expect(balanceOf(h, "Shared:tokyo-trip", "2026-11-01")).toBe("0");
    const pad = h.transactions.find((t) => t.id === "~balance.1");
    expect(pad?.postings.map((p) => `${p.account} ${p.amount.value}`)).toEqual([
      "Shared:tokyo-trip 10/3",
      "Expenses:Rounding -10/3",
    ]);
  });
  it("books the owner's share and money", () => {
    const h = trip();
    expect(
      rows(balance(h, query(h).accounts("Expenses:Travel").within("2026-10").axis("accounting"))),
    ).toEqual([
      "Expenses:Travel:Food 1500 NTD",
      "Expenses:Travel:Lodging 10000/3 NTD",
      "Expenses:Travel:Transport 200 NTD",
    ]);
    expect(
      rows(
        balance(
          h,
          query(h).accounts("Liabilities:Card", "Assets:Cash", "Bank:Checking").until("2026-10-31"),
        ),
      ),
    ).toEqual(["Assets:Cash -3000 NTD", "Bank:Checking 7970 NTD", "Liabilities:Card -10000 NTD"]);
  });
  it("keeps times, description and source, with system:shared", () => {
    const h = trip(MAIN);
    const hotel = h.transactions.find((t) => t.id === "shared:tokyo-trip:hotel");
    expect(hotel?.description).toBe("Hotel");
    expect(hotel?.source).toBe("trips/tokyo.hueke");
    expect(hotel?.status).toBe("none");
    expect(hotel?.occurrence).toBe("occurred");
    expect(hotel?.effective.start).toBe("2026-10-17T16:00Z");
    expect(hotel?.origin).toBeUndefined();
    expect(hotel?.tags).toEqual([{ scope: "system", ref: { name: "shared" } }]);
    expect(hotel?.postings.map((p) => p.id)).toEqual([
      "shared:tokyo-trip:hotel.1",
      "shared:tokyo-trip:hotel.2",
      "shared:tokyo-trip:hotel.3",
    ]);
    const ids = [...query(h).accounts("Shared:tokyo-trip")].map((t) => t.id);
    expect(ids).toEqual([
      "shared:tokyo-trip:hotel",
      "shared:tokyo-trip:dinner",
      "shared:tokyo-trip:taxi",
      "shared:tokyo-trip:pay-amy",
      "shared:tokyo-trip:pay-bob",
      "~balance.1",
    ]);
  });
  it("lists the group ledger", () => {
    expect(trip().groups).toEqual([
      {
        path: "trips/tokyo.hueke",
        name: "tokyo-trip",
        description: "Tokyo trip",
        shares: [
          { entity: "SUBANG", ratio: "1" },
          { entity: "AMY", ratio: "1" },
          { entity: "BOB", ratio: "1" },
        ],
        account: "Shared:tokyo-trip",
      },
    ]);
  });
  it("holds the shared account's settings", () => {
    const a = trip().accounts.find((x) => x.id === "Shared:tokyo-trip");
    expect(a?.type).toBe("shared");
    expect(a?.shared).toEqual({
      source: "trips/tokyo.hueke",
      as: "tokyo-trip",
      primary: true,
      self: "SUBANG",
      accountMap: [
        ["Expenses", "Expenses:Travel"],
        ["Pay:Cash", "Assets:Cash"],
        ["Pay:Transfer", "Bank:Checking"],
        ["Pay:Card", "Liabilities:Card"],
      ],
      entityMap: {},
      commodityMap: {},
    });
  });
});

describe("the example's changes", () => {
  it("without the transfer mapping, the payments do not convert", () => {
    const h = trip(OPEN.replace("    map Pay:Transfer -> Bank:Checking\n", ""));
    const found = diagnostics(h, "shared.unmapped-account");
    expect(found.map((d) => d.source)).toEqual(["trips/tokyo.hueke", "trips/tokyo.hueke"]);
    expect(found.map((d) => d.message.split(":")[0])).toEqual(["pay-amy", "pay-bob"]);
    expect(h.transactions.map((t) => t.id)).not.toContain("shared:tokyo-trip:pay-amy");
  });
  it("a pad on the shared account must write its padding", () => {
    const h = trip(
      MAIN.replace(
        "balance Shared:tokyo-trip 0 NTD pad 3 NTD",
        "balance Shared:tokyo-trip 0 NTD pad -> Expenses:Rounding",
      ),
    );
    expect(codes(h)).toEqual(["balance.pad-needs-amount"]);
  });
  it("self must be a member", () => {
    const h = trip(OPEN.replace("self @SUBANG", "self @CAROL"));
    expect(codes(h)).toEqual(["shared.unknown-module"]);
    expect(converted(h)).toEqual([]);
    expect(h.groups).toEqual([]);
  });
});

describe("actual payments", () => {
  const PAID = `
2026-10-18 * "Hotel" #shared:tokyo-trip:hotel
    Shared:tokyo-trip    10000 NTD
    Liabilities:Card    -10000 NTD [2026-10-20]
`;
  it("replaces the owner's money", () => {
    const h = trip(`${OPEN}${PAID}`);
    expect(codes(h)).toEqual([]);
    expect(converted(h)[0]).toBe(
      "shared:tokyo-trip:hotel: Expenses:Travel:Lodging 10000/3, Shared:tokyo-trip -10000/3",
    );
    expect(balanceOf(h, "Liabilities:Card", "2026-10-19")).toBe("0");
    expect(balanceOf(h, "Liabilities:Card", "2026-10-20")).toBe("-10000");
    expect(balanceOf(h, "Shared:tokyo-trip", "2026-10-20")).toBe("23900/3");
    const payment = h.transactions.find((t) => t.description === "Hotel" && t.origin);
    expect(payment?.tags).toEqual([
      {
        scope: "shared",
        ref: { scope: "shared", module: "tokyo-trip", name: "hotel" },
        target: "shared:tokyo-trip:hotel",
      },
    ]);
  });
  it("pairs the converted transaction with its payment", () => {
    const h = trip(`${OPEN}${PAID}${PAID.replace('"Hotel"', '"Hotel again"')}`);
    expect(codes(h)).toEqual(["shared.multiple-replacement"]);
    const of = (id: string): Transaction | undefined => h.transactions.find((t) => t.id === id);
    expect(of("shared:tokyo-trip:hotel")?.payment).toBe("~1");
    expect(of("~1")?.pays).toBe("shared:tokyo-trip:hotel");
    expect(of("~2")).not.toHaveProperty("pays");
    expect(of("shared:tokyo-trip:dinner")).not.toHaveProperty("payment");
  });
  it("leaves a payment unpaired when nothing of its group transaction converts", () => {
    const h = trip(
      `${OPEN}\n2026-10-30 * "From BOB" #shared:tokyo-trip:pay-bob\n    Bank:Checking  3540 NTD\n    Shared:tokyo-trip  -3540 NTD\n`,
    );
    expect(codes(h)).toEqual([]);
    expect(h.transactions.some((t) => t.id === "shared:tokyo-trip:pay-bob")).toBe(false);
    expect(h.transactions.find((t) => t.id === "~1")).not.toHaveProperty("pays");
  });
  it("must match the owner's money", () => {
    const h = trip(`${OPEN}${PAID.replaceAll("10000 NTD", "9000 NTD")}`);
    expect(codes(h)).toEqual(["shared.payment-mismatch"]);
    expect(diagnostics(h, "shared.payment-mismatch")[0]?.message).toBe(
      "~1 pays 9000 NTD on Shared:tokyo-trip; it should pay 10000 NTD, the owner's money in shared:tokyo-trip:hotel",
    );
    expect(converted(h)[0]).toBe(
      "shared:tokyo-trip:hotel: Expenses:Travel:Lodging 10000/3, Shared:tokyo-trip -10000/3",
    );
  });
  it.each([
    ["a total price", "-1500000 KRW @@ 10000 NTD", 10000, []],
    ["a unit price, within the tolerance", "-1500000 KRW @ 0.0066667 NTD", 10000, []],
    ["a unit cost", "-100 USD {100 NTD}", 10000, []],
    [
      "a unit price, beyond the tolerance",
      "-1500000 KRW @ 0.0067 NTD",
      10050,
      ["shared.payment-mismatch"],
    ],
  ])("is measured by the weight of money written with %s", (_, money, spent, expected) => {
    const group = GROUP.replace(
      "Pay:Card          -10000 NTD @SUBANG",
      `Pay:Card  ${money} @SUBANG`,
    ).replace("Expenses:Lodging   10000 NTD", `Expenses:Lodging   ${String(spent)} NTD`);
    const h = trip(`${OPEN}${PAID}`, group);
    expect(codes(h)).toEqual(expected);
  });
  it("allows half a unit for each priced weight", () => {
    const group = GROUP.replace(
      "Pay:Card          -10000 NTD @SUBANG",
      "Pay:Card  -750000 KRW @ 0.0066672 NTD @SUBANG\n    Pay:Card  -750000 KRW @ 0.0066672 NTD @SUBANG",
    );
    // Two weights of 5000.4 NTD: 0.8 NTD off, within 2 × 0.5.
    expect(codes(trip(`${OPEN}${PAID}`, group))).toEqual([]);
  });
  it("maps the commodity of the money's price", () => {
    const group = GROUP.replace(
      "Expenses:Lodging   10000 NTD",
      "Expenses:Lodging   10000 TWD",
    ).replace(
      "Pay:Card          -10000 NTD @SUBANG",
      "Pay:Card  -1500000 KRW @@ 10000 TWD @SUBANG",
    );
    const main = OPEN.replace("    pad-account", "    map commodity TWD -> NTD\n    pad-account");
    expect(codes(trip(`${main}${PAID}`, group))).toEqual([]);
  });
  it("is not measured by the money's own amount when it has a price", () => {
    const group = GROUP.replace(
      "Pay:Card          -10000 NTD @SUBANG",
      "Pay:Card  -1500000 KRW @@ 10000 NTD @SUBANG",
    );
    const h = trip(`${OPEN}${PAID.replaceAll("10000 NTD", "1500000 KRW")}`, group);
    expect(diagnostics(h, "shared.payment-mismatch")[0]?.message).toBe(
      "~1 pays 0 NTD, 1500000 KRW on Shared:tokyo-trip; it should pay 10000 NTD, 0 KRW, the owner's money in shared:tokyo-trip:hotel",
    );
  });
  it("needs no mapping for the money it replaces", () => {
    const h = trip(`${OPEN.replace("    map Pay:Card -> Liabilities:Card\n", "")}${PAID}`);
    expect(codes(h)).toEqual([]);
    expect(converted(h)[0]).toBe(
      "shared:tokyo-trip:hotel: Expenses:Travel:Lodging 10000/3, Shared:tokyo-trip -10000/3",
    );
  });
  it("is checked when nothing converts", () => {
    const taxi = (n: string) =>
      `\n2026-10-20 * "Taxi" #shared:tokyo-trip:taxi\n    Shared:tokyo-trip  ${n} NTD\n    Assets:Cash\n`;
    const group = GROUP.replace(
      "Expenses:Transport   600 NTD",
      "Expenses:Transport   600 NTD\n        split @AMY",
    );
    const h = trip(`${OPEN}${taxi("999")}${taxi("1")}`, group);
    expect(codes(h)).toEqual([
      "shared.payment-mismatch",
      "shared.payment-mismatch",
      "shared.multiple-replacement",
    ]);
  });
  it.each([
    ["a group ledger it does not have", "#shared:osaka-trip:hotel"],
    ["an anchor its group ledger does not define", "#shared:tokyo-trip:museum"],
  ])("cannot name %s", (_, tag) => {
    const h = trip(`${OPEN}${PAID.replace("#shared:tokyo-trip:hotel", tag)}`);
    expect(codes(h)).toContain("tag.wrong-target");
  });
  it("stands on a transaction header only", () => {
    const h = trip(
      `${OPEN}\n2026-10-18 * "Hotel"\n    Shared:tokyo-trip  10000 NTD  #shared:tokyo-trip:hotel\n    Liabilities:Card\n`,
    );
    expect(codes(h)).toContain("tag.wrong-level");
  });
});

describe("group ledgers", () => {
  it("rejects records a group ledger cannot hold", () => {
    const h = trip(
      OPEN,
      `${GROUP}
include other.hueke
account Pay:Cash
    obligation receivable
account-root Other shared

2026-10-31 balance Pay:Cash 0 NTD
`,
    );
    expect(codes(h)).toEqual(Array(4).fill("module.forbidden-record"));
    expect(diagnostics(h, "module.forbidden-record").map((d) => d.source)).toEqual(
      Array(4).fill("trips/tokyo.hueke"),
    );
  });
  it("must start with exactly one module declaration", () => {
    const late = trip(OPEN, `option timezone UTC\n${GROUP}`);
    expect(codes(late)).toEqual(["module.missing-declaration"]);
    expect(converted(late)).toEqual([]);
    const twice = trip(OPEN, `${GROUP}\nmodule shared "Other"\n`);
    expect(codes(twice)).toEqual(["module.missing-declaration"]);
  });
  it("takes the ledger's settings it does not write", () => {
    const h = trip(OPEN, GROUP.replace("option timezone Asia/Taipei\n", ""));
    expect(codes(h)).toEqual([]);
    expect(h.transactions.find((t) => t.id === "shared:tokyo-trip:hotel")?.effective.start).toBe(
      "2026-10-17T16:00Z",
    );
  });
  it("reads times in its own time zone", () => {
    const h = trip(OPEN, GROUP.replace("option timezone Asia/Taipei", "option timezone UTC"));
    expect(h.transactions.find((t) => t.id === "shared:tokyo-trip:hotel")?.effective.start).toBe(
      "2026-10-18T00:00Z",
    );
  });
  it("balances in its commodities' precisions, inferred from its own amounts", () => {
    const h = trip(
      OPEN,
      `${GROUP}commodity USD\n\n2026-10-22 * "Snack"\n    Expenses:Food   10.25 USD\n    Pay:Cash       -10.2 USD @AMY\n`,
    );
    expect(codes(h)).toEqual(["txn.unbalanced"]);
  });
  it("must balance each group transaction", () => {
    const h = trip(OPEN, GROUP.replace("Pay:Card          -10000 NTD", "Pay:Card -9000 NTD"));
    const found = diagnostics(h, "txn.unbalanced");
    expect(found.map((d) => d.source)).toEqual(["trips/tokyo.hueke"]);
  });
  it.each([
    ["no entity", "Pay:Cash            -600 NTD", "shared.missing-member"],
    ["two entities", "Pay:Cash            -600 NTD @AMY @BOB", "shared.missing-member"],
    ["someone not a member", "Pay:Cash            -600 NTD @CAROL", "shared.unknown-member"],
  ])("does not convert member money with %s, reported in the group ledger", (_, line, code) => {
    const h = trip(OPEN, GROUP.replace("Pay:Cash            -600 NTD @AMY", line));
    expect(codes(h)).toEqual([code]);
    expect(diagnostics(h, code).map((d) => d.source)).toEqual(["trips/tokyo.hueke"]);
    expect(h.transactions.map((t) => t.id)).not.toContain("shared:tokyo-trip:taxi");
  });
  it("says someone is not a member of the group, whatever this ledger names it", () => {
    const h = trip(OPEN, GROUP.replace("-600 NTD @AMY", "-600 NTD @CAROL"));
    expect(diagnostics(h, "shared.unknown-member").map((d) => d.message)).toEqual([
      "taxi: @CAROL is not a member of the group",
    ]);
  });
  it("converts nothing when the owner has no share and paid nothing", () => {
    const noShare = trip(
      OPEN,
      GROUP.replace(
        "Expenses:Transport   600 NTD",
        "Expenses:Transport   600 NTD\n        split @AMY",
      ),
    );
    expect(noShare.transactions.map((t) => t.id)).not.toContain("shared:tokyo-trip:taxi");
  });
  it("shares by amounts and ratios in a split", () => {
    const h = trip(OPEN, GROUP.replace("split @SUBANG @AMY", "split @AMY 1000 @SUBANG *3 @BOB"));
    expect(codes(h)).toEqual([]);
    expect(converted(h)[1]).toBe(
      "shared:tokyo-trip:dinner: Expenses:Travel:Food 1500, Assets:Cash -3000, Shared:tokyo-trip 1500",
    );
  });
  it.each([
    ["amounts beyond the posting", "split @AMY 4000 @SUBANG", "split.exceeds"],
    ["ratios of zero", "split @AMY *0 @SUBANG *0", "split.zero-ratio"],
    ["self", "split self @AMY", "shared.invalid-split"],
  ])("falls back to the default ratios on %s", (_, split, code) => {
    const h = trip(OPEN, GROUP.replace("split @SUBANG @AMY", split));
    expect(codes(h)).toEqual([code]);
    expect(converted(h)[1]).toBe(
      "shared:tokyo-trip:dinner: Expenses:Travel:Food 1000, Assets:Cash -3000, Shared:tokyo-trip 2000",
    );
  });
  it("does not convert a split naming someone not a member", () => {
    const h = trip(OPEN, GROUP.replace("split @SUBANG @AMY", "split @SUBANG @CAROL"));
    expect(codes(h)).toEqual(["shared.unknown-member"]);
    expect(h.transactions.map((t) => t.id)).not.toContain("shared:tokyo-trip:dinner");
  });
  it("converts nothing when the default ratios add up to zero", () => {
    const group = GROUP.replace(/share @(\w+) 1/g, "share @$1 0");
    const h = trip(OPEN, group);
    expect(codes(h)).toContain("split.zero-ratio");
    expect(converted(h)).toEqual([]);
    expect(h.groups).toEqual([]);
  });
  it("numbers group transactions without an anchor", () => {
    const h = trip(OPEN, GROUP.replace("%taxi ", ""));
    expect(h.transactions.map((t) => t.id)).toContain("shared:tokyo-trip:~1");
  });
  it("defines no shared anchor of its own", () => {
    const h = trip(OPEN, GROUP.replace('%taxi "Taxi"', '%shared:taxi "Taxi"'));
    expect(codes(h)).toEqual(["shared.unknown-module"]);
    expect(diagnostics(h, "shared.unknown-module").map((d) => d.source)).toEqual([
      "trips/tokyo.hueke",
    ]);
    const ids = h.transactions.map((t) => t.id);
    expect(ids).toContain("shared:tokyo-trip:~1");
    expect(ids.filter((id) => id.includes("taxi"))).toEqual([]);
  });
  it.each([
    ["a tag", '"Taxi" #shared:tokyo-trip'],
    ["a primary tag", '"Taxi" ^shared:tokyo-trip'],
  ])("cannot name a group ledger with %s", (_, header) => {
    const h = trip(OPEN, GROUP.replace('"Taxi"', header));
    expect(codes(h)).toEqual(["tag.wrong-target"]);
    expect(diagnostics(h, "tag.wrong-target").map((d) => d.source)).toEqual(["trips/tokyo.hueke"]);
    const taxi = h.transactions.find((t) => t.id === "shared:tokyo-trip:taxi");
    expect(taxi?.primaryTag).toBe("shared:tokyo-trip");
    expect(taxi?.tags).toEqual([{ scope: "system", ref: { name: "shared" } }]);
  });
  it("keeps its anchors in a namespace of its own", () => {
    const h = trip(
      `${MAIN}\n2026-10-01 * %hotel "Booking"\n    Expenses:Travel  1 NTD\n    Assets:Cash\n`,
    );
    expect(codes(h)).toEqual([]);
  });
});

describe("shared accounts", () => {
  it("needs source and self", () => {
    const h = trip(OPEN.replace("    self @SUBANG\n", ""));
    expect(codes(h)).toEqual(["shared.missing-source"]);
    expect(converted(h)).toEqual([]);
    expect(h.accounts.find((a) => a.id === "Shared:tokyo-trip")?.shared).toBeUndefined();
  });
  it("reports source, self and map on other accounts", () => {
    const h = trip(`${OPEN}\naccount Assets:Wallet\n    self @SUBANG\n    map A -> B\n`);
    expect(codes(h)).toEqual(["shared.wrong-account"]);
  });
  it("needs a loaded group ledger", () => {
    const h = modules({ "main.hueke": OPEN });
    expect(codes(h)).toEqual(["shared.unknown-module"]);
  });
  it("maps by the longest entry, segment by segment", () => {
    const h = trip(
      OPEN.replace(
        "    map Pay:Cash -> Assets:Cash\n",
        "    map Pay -> Assets:Other\n    map Pay:Cash -> Assets:Cash\n    map Pay:Ca -> Assets:Wrong\n",
      ),
    );
    expect(converted(h)[1]).toBe(
      "shared:tokyo-trip:dinner: Expenses:Travel:Food 1500, Assets:Cash -3000, Shared:tokyo-trip 1500",
    );
  });
  it("carries over the rest of the group account's name", () => {
    const h = trip(
      OPEN.replace(MAPS, "    map Expenses -> Expenses:Travel\n    map Pay -> Assets:Pay\n"),
    );
    expect(codes(h)).toEqual([]);
    expect(converted(h)).toEqual([
      "shared:tokyo-trip:hotel: Expenses:Travel:Lodging 10000/3, Assets:Pay:Card -10000, Shared:tokyo-trip 20000/3",
      "shared:tokyo-trip:dinner: Expenses:Travel:Food 1500, Assets:Pay:Cash -3000, Shared:tokyo-trip 1500",
      "shared:tokyo-trip:taxi: Expenses:Travel:Transport 200, Shared:tokyo-trip -200",
      "shared:tokyo-trip:pay-amy: Assets:Pay:Transfer 4430, Shared:tokyo-trip -4430",
      "shared:tokyo-trip:pay-bob: Assets:Pay:Transfer 3540, Shared:tokyo-trip -3540",
    ]);
  });
  it("maps entities and commodities", () => {
    const h = trip(
      MAIN.replace(
        "    self @SUBANG\n",
        "    self @SUBANG\n    map @SUBANG -> @ME\n    map commodity NTD -> TWD\n",
      ).replace(
        "balance Shared:tokyo-trip 0 NTD pad 3 NTD",
        "balance Shared:tokyo-trip 0 TWD pad 3 TWD",
      ),
    );
    expect(codes(h)).toEqual([]);
    const hotel = h.transactions.find((t) => t.id === "shared:tokyo-trip:hotel");
    expect(hotel?.postings.map((p) => p.amount.commodity)).toEqual(["TWD", "TWD", "TWD"]);
    expect(hotel?.postings[1]?.refs).toEqual([{ role: "person", entity: "ME" }]);
  });
  it("names the group ledger with as", () => {
    const h = trip(OPEN.replace("as ^tokyo-trip", "as ^tokyo"), GROUP);
    expect(codes(h)).toEqual([]);
    expect(h.transactions.map((t) => t.id)).toContain("shared:tokyo:hotel");
    expect(h.transactions.map((t) => t.id)).not.toContain("shared:tokyo-trip:hotel");
    expect(h.groups[0]?.name).toBe("tokyo");
  });
  it("lets each ledger name the same group ledger its own way", () => {
    const amy = trip(
      OPEN.replace("as ^tokyo-trip", "as ^japan").replace("self @SUBANG", "self @AMY"),
    );
    expect(amy.groups.map((g) => g.name)).toEqual(["japan"]);
    expect(amy.transactions.map((t) => t.id)).toContain("shared:japan:taxi");
    expect(trip(OPEN).groups.map((g) => g.name)).toEqual(["tokyo-trip"]);
  });
  it("needs as after the source path", () => {
    const h = trip(OPEN.replace(" as ^tokyo-trip", ""));
    expect(codes(h)).toEqual(["parse.syntax"]);
    expect(diagnostics(h, "parse.syntax").map((d) => d.source)).toEqual(["main.hueke"]);
    expect(converted(h)).toEqual([]);
  });
  it("does not take a name from the module declaration", () => {
    const h = trip(
      OPEN,
      GROUP.replace('module shared "Tokyo trip"', 'module shared tokyo-trip "Tokyo trip"'),
    );
    expect(codes(h)).toEqual(["parse.syntax", "module.missing-declaration"]);
    expect(diagnostics(h, "parse.syntax").map((d) => d.source)).toEqual(["trips/tokyo.hueke"]);
    expect(converted(h)).toEqual([]);
  });
  it("reports two group ledgers of one name", () => {
    const h = trip(
      `${OPEN}\naccount Shared:other\n    source other.hueke as tokyo-trip\n    self @SUBANG\n${MAPS}`,
      GROUP,
      { "other.hueke": GROUP },
    );
    expect(codes(h)).toEqual(["module.name-conflict"]);
    expect(converted(h)).toEqual([]);
  });
  it("reports a group ledger referred to twice", () => {
    const h = trip(
      `${OPEN}\naccount Shared:again\n    source trips/tokyo.hueke as again\n    self @SUBANG\n${MAPS}`,
    );
    expect(codes(h)).toEqual(["module.duplicate"]);
    expect(converted(h)).toEqual([]);
  });
  it("reports a group ledger both included and referred to", () => {
    const h = trip(`${OPEN}\ninclude trips/tokyo.hueke\n`);
    expect(codes(h)).toEqual(["module.duplicate"]);
    expect(converted(h)).toEqual([]);
  });
  it("creates the entities a converted transaction names", () => {
    const h = trip(OPEN, GROUP.replace('%hotel "Hotel"', '%hotel "Hotel" @HOTEL'));
    expect(h.entities.map((e) => e.id)).toContain("HOTEL");
  });
  it("keeps only the tags that resolved in the group ledger", () => {
    const h = trip(
      OPEN,
      GROUP.replace(
        "Pay:Card          -10000 NTD @SUBANG",
        "Pay:Card  -10000 NTD @SUBANG #refund:x #card",
      ),
    );
    expect(codes(h)).toEqual(["tag.wrong-level"]);
    const card = h.transactions
      .find((t) => t.id === "shared:tokyo-trip:hotel")
      ?.postings.find((p) => p.account === "Liabilities:Card");
    expect(card?.tags.map((t) => `${t.scope}:${t.ref.name}`)).toEqual([
      "tag:card",
      "system:shared",
    ]);
  });
  it("keeps the converted posting's own effective time", () => {
    const h = trip(
      OPEN,
      GROUP.replace(
        "Pay:Card          -10000 NTD @SUBANG",
        "Pay:Card  -10000 NTD [2026-10-25] @SUBANG",
      ),
    );
    const card = h.transactions
      .find((t) => t.id === "shared:tokyo-trip:hotel")
      ?.postings.find((p) => p.account === "Liabilities:Card");
    expect(card?.effective.localDate).toBe("2026-10-25");
  });
});

describe("group tags", () => {
  /** SUBANG's ledger naming the group ledger without `^`. */
  const PLAIN = OPEN.replace("as ^tokyo-trip", "as tokyo-trip");
  const of = (h: Hueke, id: string): Transaction | undefined =>
    h.transactions.find((t) => t.id === id);
  const conversions = (h: Hueke): Transaction[] =>
    h.transactions.filter((t) => t.tags.some((g) => g.scope === "system"));
  const GROUP_TAG = {
    scope: "shared",
    ref: { scope: "shared", name: "tokyo-trip" },
    target: "shared:tokyo-trip",
  };

  it("gives the event the ID shared:<name>", () => {
    const h = trip(MAIN);
    expect([...query(h).ids("shared:tokyo-trip")].map((t) => t.description)).toEqual([
      "Tokyo trip",
    ]);
  });
  it("gives each converted transaction the primary tag of the group with as ^", () => {
    const h = trip(MAIN);
    const members = [...query(h).primaryTag("shared:tokyo-trip")];
    expect(members.map((t) => t.id)).toEqual([
      "shared:tokyo-trip:hotel",
      "shared:tokyo-trip:dinner",
      "shared:tokyo-trip:taxi",
      "shared:tokyo-trip:pay-amy",
      "shared:tokyo-trip:pay-bob",
    ]);
    expect(members.every((t) => t.primaryTarget === "shared:tokyo-trip")).toBe(true);
    expect(members.every((t) => t.tags.every((g) => g.scope !== "shared"))).toBe(true);
  });
  it("leaves the primary tag plain when no transaction defines the group's anchor", () => {
    const h = trip(OPEN);
    const hotel = of(h, "shared:tokyo-trip:hotel");
    expect(hotel?.primaryTag).toBe("shared:tokyo-trip");
    expect(hotel).not.toHaveProperty("primaryTarget");
  });
  it("gives each converted transaction and its postings the tag of the group without ^", () => {
    const h = trip(`${PLAIN}\n${EVENT}`);
    expect(codes(h)).toEqual([]);
    const hotel = of(h, "shared:tokyo-trip:hotel");
    expect(hotel).not.toHaveProperty("primaryTag");
    expect(hotel?.tags).toEqual([GROUP_TAG, { scope: "system", ref: { name: "shared" } }]);
    expect(hotel?.postings.every((p) => p.tags.some((g) => g.scope === "shared"))).toBe(true);
    expect([...query(h).tags("#shared:tokyo-trip")].map((t) => t.id)).toEqual(
      conversions(h).map((t) => t.id),
    );
  });
  it("leaves the tag of the group plain when no transaction defines its anchor", () => {
    const hotel = of(trip(PLAIN), "shared:tokyo-trip:hotel");
    expect(hotel?.tags[0]).toEqual({
      scope: "shared",
      ref: { scope: "shared", name: "tokyo-trip" },
    });
  });
  it("turns the group transaction's own primary tag into a plain tag with as ^", () => {
    const group = GROUP.replace(
      '%dinner "Dinner, BOB was not there"',
      '%dinner "Dinner, BOB was not there" ^food',
    );
    const dinner = of(trip(MAIN, group), "shared:tokyo-trip:dinner");
    expect(dinner?.primaryTag).toBe("shared:tokyo-trip");
    expect(dinner?.tags).toEqual([
      { scope: "tag", ref: { name: "food" } },
      { scope: "system", ref: { name: "shared" } },
    ]);
  });
  it("keeps one plain tag when the group transaction has it as both primary tag and tag", () => {
    const group = GROUP.replace(
      '%dinner "Dinner, BOB was not there"',
      '%dinner "Dinner, BOB was not there" ^food #food',
    );
    const dinner = of(trip(MAIN, group), "shared:tokyo-trip:dinner");
    expect(dinner?.tags).toEqual([
      { scope: "tag", ref: { name: "food" } },
      { scope: "system", ref: { name: "shared" } },
    ]);
  });
  it("keeps the group transaction's own primary tag without ^", () => {
    const group = GROUP.replace(
      '%dinner "Dinner, BOB was not there"',
      '%dinner "Dinner, BOB was not there" ^food',
    );
    const dinner = of(trip(PLAIN, group), "shared:tokyo-trip:dinner");
    expect(dinner?.primaryTag).toBe("food");
    expect(dinner?.tags.map((g) => g.scope)).toEqual(["shared", "system"]);
  });
  it("reports an event naming a group ledger this ledger does not have, and still defines it", () => {
    const h = trip(MAIN.replace("%shared:tokyo-trip", "%shared:kyoto-trip"));
    expect(codes(h)).toEqual(["shared.unknown-module"]);
    expect(diagnostics(h, "shared.unknown-module").map((d) => d.source)).toEqual(["main.hueke"]);
    expect(of(h, "shared:kyoto-trip")?.description).toBe("Tokyo trip");
    expect(of(h, "shared:tokyo-trip:hotel")).not.toHaveProperty("primaryTarget");
  });
  it("cannot define a group transaction's anchor in the owner's ledger", () => {
    const h = trip(`${MAIN}\n2026-10-18 %shared:tokyo-trip:hotel "Hotel"\n`);
    expect(codes(h)).toEqual(["parse.syntax"]);
    expect(h.transactions.filter((t) => t.description === "Hotel")).toHaveLength(1);
  });
  it("defines the group's anchor once", () => {
    const h = trip(`${MAIN}\n2026-10-19 %shared:tokyo-trip "Again"\n`);
    expect(codes(h)).toEqual(["anchor.duplicate"]);
    expect(of(trip(MAIN), "shared:tokyo-trip:hotel")?.primaryTarget).toBe("shared:tokyo-trip");
  });
  it("keeps the group's anchor apart from the anchor of the same name", () => {
    const h = trip(`${MAIN}\n2026-10-19 %tokyo-trip "Own"\n`);
    expect(codes(h)).toEqual([]);
    expect(of(h, "tokyo-trip")?.description).toBe("Own");
    expect(of(h, "shared:tokyo-trip")?.description).toBe("Tokyo trip");
  });
  const OWN = `
2026-10-19 * "Souvenirs" TAG
    Expenses:Travel:Gifts   500 NTD
    Assets:Cash
`;
  it("takes the owner's own transactions tagged with the group's primary tag", () => {
    const h = trip(`${MAIN}${OWN.replace("TAG", "^shared:tokyo-trip")}`);
    expect(codes(h)).toEqual([]);
    const own = h.transactions.find((t) => t.description === "Souvenirs");
    expect(own?.primaryTag).toBe("shared:tokyo-trip");
    expect(own?.primaryTarget).toBe("shared:tokyo-trip");
    expect(descriptions(query(h).primaryTag("shared:tokyo-trip"))).toContain("Souvenirs");
  });
  it("takes the owner's own transactions tagged with the group's tag", () => {
    const h = trip(`${PLAIN}\n${EVENT}${OWN.replace("TAG", "#shared:tokyo-trip")}`);
    expect(codes(h)).toEqual([]);
    expect(h.transactions.find((t) => t.description === "Souvenirs")?.tags).toEqual([GROUP_TAG]);
    expect(descriptions(query(h).tags("#shared:tokyo-trip"))).toContain("Souvenirs");
  });
  it.each([
    ["a tag", "#shared:osaka-trip"],
    ["a primary tag", "^shared:osaka-trip"],
  ])("skips %s naming a group ledger this ledger does not have", (_, tag) => {
    const h = trip(`${MAIN}${OWN.replace("TAG", tag)}`);
    expect(codes(h)).toEqual(["tag.wrong-target"]);
    const own = h.transactions.find((t) => t.description === "Souvenirs");
    expect(own?.tags).toEqual([]);
    expect(own).not.toHaveProperty("primaryTag");
    expect(own).not.toHaveProperty("primaryTarget");
  });
  it("skips the group's primary tag on the event itself", () => {
    const h = trip(MAIN.replace('"Tokyo trip" #travel', '"Tokyo trip" ^shared:tokyo-trip'));
    expect(codes(h)).toEqual(["tag.self-reference"]);
    expect(of(h, "shared:tokyo-trip")).not.toHaveProperty("primaryTag");
  });
  it("counts the name of a group ledger that does not convert", () => {
    const h = trip(
      `${OPEN}\naccount Shared:other\n    source other.hueke as tokyo-trip\n    self @SUBANG\n${MAPS}\n${EVENT}${OWN.replace("TAG", "#shared:tokyo-trip")}`,
      GROUP,
      { "other.hueke": GROUP },
    );
    expect(codes(h)).toEqual(["module.name-conflict"]);
    expect(conversions(h)).toEqual([]);
  });
  it("groups by the tags of the group and of an actual payment, keyed as written", () => {
    const paid = `\n2026-10-18 * "Hotel" #shared:tokyo-trip:hotel\n    Shared:tokyo-trip    10000 NTD\n    Liabilities:Card\n`;
    const h = trip(`${PLAIN}\n${EVENT}${paid}`);
    expect(codes(h)).toEqual([]);
    const keys = query(h)
      .accounts("Shared:tokyo-trip")
      .groupBy("tag")
      .count()
      .map((g) => g.key.tag);
    expect(keys).toEqual(["shared:tokyo-trip", "shared:tokyo-trip:hotel", "system:shared"]);
  });
  it("does not take an actual payment into the group unless it is tagged so", () => {
    const paid = `\n2026-10-18 * "Hotel" #shared:tokyo-trip:hotel\n    Shared:tokyo-trip    10000 NTD\n    Liabilities:Card\n`;
    const h = trip(`${PLAIN}\n${EVENT}${paid}`);
    expect(codes(h)).toEqual([]);
    expect([...query(h).tags("#shared:tokyo-trip")].map((t) => t.id)).not.toContain("~1");
    expect([...query(h).tags("#shared:tokyo-trip:hotel")].map((t) => t.id)).toEqual(["~1"]);
    expect([...query(h).tags("shared:tokyo-trip:hotel")].map((t) => t.id)).toEqual(["~1"]);
    expect([...query(h).tags("shared:tokyo-trip")].map((t) => t.id)).toEqual(
      conversions(h).map((t) => t.id),
    );
    expect(
      [...query(h).tags({ scope: "shared", ref: { name: "tokyo-trip" } })].map((t) => t.id),
    ).toEqual(conversions(h).map((t) => t.id));
  });
});

describe("closing a shared account", () => {
  it("asserts the position with a hard Balance, within one unit for fractions", () => {
    const h = trip(`${OPEN}\n2026-10-20 balance Shared:tokyo-trip 7967 NTD\n`);
    expect(codes(h)).toEqual([]);
    const off = trip(`${OPEN}\n2026-10-20 balance Shared:tokyo-trip 7965 NTD\n`);
    expect(codes(off)).toEqual(["balance.mismatch"]);
  });
});

describe("pads with written padding", () => {
  it("names the written padding when it is off", () => {
    const h = trip(`${OPEN}\n2026-11-01 balance Shared:tokyo-trip 0 NTD pad 10 NTD\n`);
    expect(diagnostics(h, "balance.mismatch")[0]?.message).toContain("plus pad 10 NTD");
  });
});

describe("modules", () => {
  it("an included module with a module declaration is not included", () => {
    const h = modules({
      "main.hueke": "option timezone UTC\ninclude trip.hueke\n",
      "trip.hueke": GROUP,
    });
    expect(codes(h)).toEqual(["include.module-file"]);
    expect(h.modules).toEqual(["main.hueke"]);
  });
});

describe("a group ledger on its own", () => {
  const PATH = "trips/tokyo.hueke";
  const alone = (group = GROUP): Hueke => modules({ [PATH]: group }, PATH);
  const sources = (h: Hueke, code: string): (string | undefined)[] =>
    diagnostics(h, code).map((d) => d.source);

  it("loads its transactions as written", () => {
    const h = alone();
    expect(codes(h)).toEqual([]);
    expect(postings(h.transactions)).toEqual([
      "hotel: Expenses:Lodging 10000, Pay:Card -10000",
      "dinner: Expenses:Food 3000, Pay:Cash -3000",
      "taxi: Expenses:Transport 600, Pay:Cash -600",
      "pay-amy: Pay:Transfer 4430, Pay:Transfer -4430",
      "pay-bob: Pay:Transfer 3540, Pay:Transfer -3540",
    ]);
    expect(h.groups).toEqual([]);
    expect(h.modules).toEqual([PATH]);
  });
  it("generates nothing: every transaction and posting is the one written", () => {
    const h = alone();
    expect(h.transactions.every((t) => t.origin !== undefined)).toBe(true);
    expect(h.transactions.flatMap((t) => t.postings).every((p) => p.origin !== undefined)).toBe(
      true,
    );
  });
  it("gives what the group spent and who paid it", () => {
    const h = alone();
    const tree = balance(h, query(h).accounts("Expenses").until("2026-10-31"));
    expect(tree.find((r) => r.account === "Expenses")?.amounts).toEqual([
      { value: "13600", commodity: "NTD" },
    ]);
    expect(balanceOf(h, "Pay:Card", "2026-10-31")).toBe("-10000");
    expect(balanceOf(h, "Pay:Cash", "2026-10-31")).toBe("-3600");
  });
  it("creates the accounts it uses without declaring them", () => {
    const ids = alone().accounts.map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(["Expenses:Lodging", "Pay:Card", "Pay:Transfer"]));
  });
  it("can also be referred to by another ledger", () => {
    const files = { "main.hueke": MAIN, [PATH]: GROUP };
    const referred = modules(files);
    const own = modules(files, PATH);
    expect(codes(referred)).toEqual([]);
    expect(codes(own)).toEqual([]);
    expect(referred.groups).toHaveLength(1);
    expect(own.groups).toEqual([]);
  });
  it("rejects records a group ledger cannot hold", () => {
    const h = alone(`${GROUP}
2026-10-31 balance Pay:Cash 0 NTD
include other.hueke
account Pay:Cash
    obligation receivable
account-root Other shared
`);
    expect(codes(h)).toEqual([
      "module.forbidden-record",
      "module.forbidden-record",
      "module.forbidden-record",
      "module.forbidden-record",
    ]);
    expect(sources(h, "module.forbidden-record")).toEqual([PATH, PATH, PATH, PATH]);
    expect(h.modules).toEqual([PATH]);
    expect(h.accounts.map((a) => a.id)).not.toContain("Other");
  });
  it("carries no group tags", () => {
    const h = alone(
      GROUP.replace(
        '%dinner "Dinner, BOB was not there"',
        '%dinner "Dinner, BOB was not there" ^food',
      ),
    );
    expect(codes(h)).toEqual([]);
    expect(h.transactions.flatMap((t) => t.tags)).toEqual([]);
    expect(h.transactions.map((t) => t.primaryTag)).toEqual([
      undefined,
      "food",
      undefined,
      undefined,
      undefined,
    ]);
  });
  it("ignores a second module declaration", () => {
    const h = alone(`${GROUP}\nmodule shared "Other"\n`);
    expect(codes(h)).toEqual(["module.forbidden-record"]);
    expect(h.transactions).toHaveLength(5);
  });
  it("checks the share ratios", () => {
    const h = alone(GROUP.replace("share @BOB 1", "share @BOB x"));
    // The unreadable ratio leaves BOB out, so his payment names someone not a member.
    expect(codes(h)).toEqual(["parse.invalid-number", "shared.unknown-member"]);
    expect(sources(h, "parse.invalid-number")).toEqual([PATH]);
    expect(h.transactions).toHaveLength(5);
  });
  it("checks that the share ratios do not add up to zero", () => {
    const h = alone(GROUP.replace(/share @(\w+) 1/g, "share @$1 0"));
    expect(codes(h)).toContain("split.zero-ratio");
    expect(h.transactions).toHaveLength(5);
  });
  it.each([
    ["amounts beyond the posting", "split @AMY 4000 @SUBANG", "split.exceeds"],
    ["ratios of zero", "split @AMY *0 @SUBANG *0", "split.zero-ratio"],
    ["self", "split self @AMY", "shared.invalid-split"],
    ["someone not a member", "split @SUBANG @CAROL", "shared.unknown-member"],
  ])("checks a split with %s", (_, split, code) => {
    const h = alone(GROUP.replace("split @SUBANG @AMY", split));
    expect(codes(h)).toEqual([code]);
    expect(sources(h, code)).toEqual([PATH]);
    expect(postings(h.transactions)[1]).toBe("dinner: Expenses:Food 3000, Pay:Cash -3000");
  });
  it.each([
    ["no entity", "Pay:Cash            -600 NTD", "shared.missing-member"],
    ["two entities", "Pay:Cash            -600 NTD @AMY @BOB", "shared.missing-member"],
    ["someone not a member", "Pay:Cash            -600 NTD @CAROL", "shared.unknown-member"],
  ])("checks member money with %s and still loads it", (_, line, code) => {
    const h = alone(GROUP.replace("Pay:Cash            -600 NTD @AMY", line));
    expect(codes(h)).toEqual([code]);
    expect(sources(h, code)).toEqual([PATH]);
    expect(postings(h.transactions)[2]).toBe("taxi: Expenses:Transport 600, Pay:Cash -600");
  });
});
