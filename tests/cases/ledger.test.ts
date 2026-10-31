// docs/core/ledger.md
import { describe, expect, it } from "vitest";
import { check, position } from "../../srcs/index.js";
import type { Diagnostic, Hueke } from "../../srcs/index.js";
import { balanceOf, codes, ledger, modules } from "./ledger.js";

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
    ["balance @entity", "2026-10-12 balance Assets:Cash @NAT -180 NTD\n"],
    ["a shared root", "account-root Trip shared\n"],
    ["an obligation account", "account Assets:Receivables\n    obligation receivable\n"],
    [
      "a statement cycle",
      "account Liabilities:Card\n    statement\n        from 2026-01-25\n        every 1 month\n",
    ],
    ["entity", "entity NAT\n    type person\n"],
    ["share", '2026-10-12 "x"\n    share @NAT @AMY\n    Expenses:Food  2 NTD\n    Assets:Cash\n'],
    [
      "into",
      '2026-10-12 "x"\n    into Assets:Receivables\n    Expenses:Food  2 NTD\n    Assets:Cash\n',
    ],
    ["schedule", 'schedule %rent "Rent"\n'],
    ["installment", 'installment %phone "Phone"\n'],
    ["rule", "rule %tax\n"],
    ["cap-group", "cap-group %food 3000 NTD\n"],
    ["module", 'module trip shared "trip.hueke"\n'],
    ["an account name", 'account Assets:Wallet\n    name "Wallet"\n'],
    ["an account pad-account", "account Assets:Wallet\n    pad-account Equity:Opening\n"],
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
  it("names what is not supported", () => {
    const h = ledger("entity NAT\n");
    expect(check(h)[0]?.message).toBe("entity is not supported yet");
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
    expect(h.settings).toEqual({
      timezone: "UTC",
      weekStart: "monday",
      strict: [],
      decimalMark: ".",
      groupMark: ",",
    });
  });
});

describe("UNDECLARED strict mode", () => {
  const UNDECLARED = `
2026-10-12 * "Lunch" @NAT
    Expenses:Food     180 NTD
    Assets:Cash      -180 NTD

2026-10-13 * "Gave points to a friend" @KEN
    Expenses:Other     1 POINT
    Assets:Points     -1 POINT
`;
  const undeclared = (h: ReturnType<typeof ledger>): string[] =>
    check(h)
      .filter((d) => d.code === "strict.undeclared")
      .map((d) => d.message);

  it("general mode", () => {
    expect(codes(ledger(UNDECLARED), true)).toEqual(["name.inferred-commodity"]);
  });
  it("every kind", () => {
    const h = ledger(`option strict account, commodity, entity\n${UNDECLARED}`);
    expect(codes(h, true).every((c) => c === "strict.undeclared")).toBe(true);
    const messages = undeclared(h).join("\n");
    for (const name of ["Expenses:Food", "Expenses:Other", "Assets:Points", "POINT"])
      expect(messages).toContain(name);
    expect(messages).not.toContain("Assets:Cash");
  });
  it("Hueke(strict) is strict mode for every kind", () => {
    const h = ledger(UNDECLARED, { strict: true });
    expect(undeclared(h)).toEqual(
      undeclared(ledger(`option strict account, commodity, entity\n${UNDECLARED}`)),
    );
  });
  it("commodities only", () => {
    const h = ledger(`option strict commodity\n${UNDECLARED}`);
    expect(codes(h, true)).toEqual(["strict.undeclared"]);
    expect(undeclared(h)[0]).toContain("POINT");
  });
});

describe("duplicate declarations", () => {
  /** The 1-based line of the n-th item of the root module, as the message names it. */
  const lineOf = (h: Hueke, index: number): string => {
    const data = h.data.get("main.hueke");
    const start = data?.items.at(index)?.span?.start ?? -1;
    return `main.hueke:${String(data ? position(data, start).line : 0)}`;
  };
  const duplicates = (h: Hueke): Diagnostic[] =>
    check(h).filter((d) => d.code === "declaration.duplicate");

  it.each([
    ["normal mode", ""],
    ["strict account", "option strict account\n"],
    ["strict commodity", "option strict commodity\n"],
  ])("keeps the first account root and reports the later one in %s", (_, strict) => {
    const h = ledger(`${strict}account-root Card asset\naccount-root Card liability\n`);
    expect(codes(h, true)).toEqual(["declaration.duplicate"]);
    expect(h.roots.find((r) => r.name === "Card")?.type).toBe("asset");
    const [d] = duplicates(h);
    expect(d?.severity).toBe("error");
    expect(d?.source).toBe("main.hueke");
    expect(d?.span?.start).toBe(h.data.get("main.hueke")?.items.at(-1)?.span?.start);
    expect(d?.message).toContain(lineOf(h, -2));
  });
  it("redeclares a built-in root once without a diagnostic", () => {
    const h = ledger("option strict account\naccount-root Assets liability\n");
    expect(codes(h, true)).toEqual([]);
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
    const h = ledger(`${strict}commodity MILE\n    precision 0\ncommodity MILE\n    precision 2\n`);
    expect(codes(h, true)).toEqual(["declaration.duplicate"]);
    expect(h.commodities.filter((c) => c.id === "MILE")).toHaveLength(1);
    expect(h.commodities.find((c) => c.id === "MILE")?.precision).toBe(0);
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

  describe("examples", () => {
    it("account-root Bank asset, then account-root Bank liability", () => {
      const h = ledger("account-root Bank asset\naccount-root Bank liability\n");
      expect(h.roots.find((r) => r.name === "Bank")?.type).toBe("asset");
      expect(codes(h, true)).toEqual(["declaration.duplicate"]);
      const [d] = duplicates(h);
      expect(d?.span?.start).toBe(h.data.get("main.hueke")?.items.at(-1)?.span?.start);
      expect(d?.message).toContain(lineOf(h, -2));
    });
    it("commodity NTD with precision 0, then commodity NTD with precision 2", () => {
      const h = ledger("commodity NTD\n    precision 0\ncommodity NTD\n    precision 2\n");
      expect(h.commodities.find((c) => c.id === "NTD")?.precision).toBe(0);
      expect(codes(h, true)).toEqual(["declaration.duplicate"]);
      const [d] = duplicates(h);
      expect(d?.span?.start).toBe(h.data.get("main.hueke")?.items.at(-1)?.span?.start);
      expect(d?.message).toContain(lineOf(h, -2));
    });
  });
});

describe("declarations in included modules", () => {
  const TZ = "option timezone Asia/Taipei\n";
  const ignored = (h: Hueke): Diagnostic[] =>
    check(h).filter((d) => d.code === "module.ignored-declaration");

  it("are kept in the Raw model, never take effect, and are each reported", () => {
    const h = modules({
      "main.hueke": `${TZ}include sub.hueke\n`,
      "sub.hueke":
        "option timezone Asia/Tokyo\naccount-root Card liability\ncommodity MILE\n    precision 2\naccount Card:Visa\n    primary USD\n",
    });
    expect(codes(h)).toEqual(Array(4).fill("module.ignored-declaration"));
    for (const d of ignored(h)) {
      expect(d.severity).toBe("warning");
      expect(d.source).toBe("sub.hueke");
    }
    expect(h.data.get("sub.hueke")?.items.map((i) => i.kind)).toEqual([
      "option",
      "account-root",
      "commodity",
      "account",
    ]);
    expect(h.roots.some((r) => r.name === "Card")).toBe(false);
    expect(h.commodities.some((c) => c.id === "MILE")).toBe(false);
    expect(h.accounts.some((a) => a.id === "Card:Visa")).toBe(false);
    expect(h.settings.timezone).toBe("Asia/Taipei");
  });
  it("are never duplicates of the root's or of each other", () => {
    const h = modules({
      "main.hueke": `${TZ}commodity MILE\n    precision 0\ninclude a.hueke\ninclude b.hueke\n`,
      "a.hueke": "commodity MILE\n    precision 2\ninclude c.hueke\n",
      "b.hueke": "commodity MILE\n    precision 3\n",
      "c.hueke": "commodity MILE\n    precision 4\n",
    });
    expect(codes(h)).toEqual(Array(3).fill("module.ignored-declaration"));
    expect(ignored(h).map((d) => d.source)).toEqual(["a.hueke", "c.hueke", "b.hueke"]);
    expect(h.commodities.find((c) => c.id === "MILE")?.precision).toBe(0);
  });
  it("where a declaration stands in the root does not matter", () => {
    const h = modules({
      "main.hueke": `${TZ}include sub.hueke\n${LUNCH}\ncommodity NTD\n    precision 0\n`,
      "sub.hueke": "commodity NTD\n    precision 2\n",
    });
    expect(codes(h)).toEqual(["module.ignored-declaration"]);
    expect(h.commodities.find((c) => c.id === "NTD")?.precision).toBe(0);
  });
  it("records in included modules still load", () => {
    const h = modules({
      "main.hueke": `${TZ}account Assets:Cash\n    primary NTD\ninclude sub.hueke\n`,
      "sub.hueke": `commodity NTD\n    precision 0\n${LUNCH}`,
    });
    expect(codes(h)).toEqual(["module.ignored-declaration"]);
    expect(h.transactions).toHaveLength(1);
  });
});

describe("objects used without a declaration", () => {
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
