// docs/core/modules.md
import { describe, expect, it } from "vitest";
import { check, parse, referencedSources } from "../../srcs/index.js";
import { balanceOf, codes, diagnostics, modules } from "./ledger.js";

const FILES = {
  "main.hueke": "option timezone Asia/Taipei\ninclude accounts.hueke\ninclude 2026/10.hueke\n",
  "accounts.hueke": "commodity NTD\n    precision 0\n",
  "2026/10.hueke": `include ../accounts.hueke

2026-10-12 * "Lunch"
    Expenses:Food     180 NTD
    Assets:Cash      -180 NTD
`,
};
const withMain = (extra: string, files: Record<string, string> = {}) =>
  modules({ ...FILES, ...files, "main.hueke": `${FILES["main.hueke"]}${extra}\n` });
/** Diagnostics as [code, source], sorted, with info-level hints unless left out. */
const located = (h: ReturnType<typeof modules>, withInfo = true) =>
  check(h)
    .filter((d) => withInfo || d.severity !== "info")
    .map((d) => [d.code, d.source])
    .sort();

describe("modules and include", () => {
  it("joins the modules depth-first and reports a module included twice", () => {
    const h = modules(FILES);
    expect(h.modules).toEqual(["main.hueke", "accounts.hueke", "2026/10.hueke"]);
    expect(h.transactions[0]?.effective.start).toBe("2026-10-11T16:00Z");
    expect(h.transactions[0]?.source).toBe("2026/10.hueke");
    expect(located(h)).toEqual([
      ["module.duplicate", "2026/10.hueke"],
      ["module.ignored-declaration", "accounts.hueke"],
      ["name.inferred-commodity", "2026/10.hueke"],
    ]);
  });
  it.each([
    ["include 2026/", "path.invalid"],
    ["include https://example.com/x.hueke", "path.invalid"],
    ["include ../other.hueke", "path.outside-root"],
    ["include 2026/11.hueke", "module.missing"],
  ])("%s is %s and the rest loads", (line, code) => {
    const h = withMain(line);
    expect(codes(h).sort()).toEqual(
      ["module.duplicate", "module.ignored-declaration", code].sort(),
    );
    expect(balanceOf(h, "Assets:Cash", "2026-10-31")).toBe("-180");
  });
  it("puts an included module's records at its include line", () => {
    const h = modules({
      "main.hueke": `option timezone UTC
2026-10-12 "A"
include b.hueke
2026-10-12 "C"
`,
      "b.hueke": '2026-10-12 "B"\n',
    });
    expect(h.transactions.map((t) => `${t.id} ${t.description ?? ""}`)).toEqual([
      "~1 A",
      "~2 B",
      "~3 C",
    ]);
  });
  it("loads records and include lines from included modules at any depth", () => {
    const h = modules({
      "main.hueke": "option timezone UTC\ninclude a.hueke\n",
      "a.hueke": "include b.hueke\n",
      "b.hueke": '2026-10-12 "B"\n    Expenses:Food  5 NTD\n    Assets:Cash   -5 NTD\n',
    });
    expect(h.modules).toEqual(["main.hueke", "a.hueke", "b.hueke"]);
    expect(balanceOf(h, "Assets:Cash", "2026-10-31")).toBe("-5");
  });
  it("leaves out loaded modules the root does not reach", () => {
    const h = modules({ ...FILES, "other.hueke": "option nonsense 1\ncommodity X\n" });
    expect(h.modules).not.toContain("other.hueke");
    expect(located(h, false)).toEqual([
      ["module.duplicate", "2026/10.hueke"],
      ["module.ignored-declaration", "accounts.hueke"],
    ]);
  });
  it("reports an include that closes a cycle, and loads each module once", () => {
    const h = modules({
      "main.hueke": "option timezone UTC\ninclude a.hueke\n",
      "a.hueke": "include b.hueke\n",
      "b.hueke":
        'include main.hueke\n2026-10-12 "B"\n    Expenses:Food  5 NTD\n    Assets:Cash   -5 NTD\n',
    });
    expect(h.modules).toEqual(["main.hueke", "a.hueke", "b.hueke"]);
    expect(located(h, false)).toEqual([["module.duplicate", "b.hueke"]]);
    expect(balanceOf(h, "Assets:Cash", "2026-10-31")).toBe("-5");
  });
  it("reports module.missing and module.duplicate on the include line", () => {
    const main = "option timezone UTC\ninclude a.hueke\ninclude a.hueke\ninclude b.hueke\n";
    const h = modules({ "main.hueke": main, "a.hueke": "" });
    expect(check(h).map((d) => [d.code, d.source, d.span?.start])).toEqual([
      ["module.duplicate", "main.hueke", main.lastIndexOf("include a.hueke")],
      ["module.missing", "main.hueke", main.indexOf("include b.hueke")],
    ]);
    expect(h.modules).toEqual(["main.hueke", "a.hueke"]);
  });
  it("normalizes the paths given to load and init to NFC", () => {
    const decomposed = "cafe\u0301.hueke";
    const h = modules(
      { [decomposed]: `option timezone UTC\ninclude b.hueke\n`, "b.hueke": '2026-10-12 "B"\n' },
      "caf\u00e9.hueke",
    );
    expect(h.root).toBe("caf\u00e9.hueke");
    expect(h.modules).toEqual(["caf\u00e9.hueke", "b.hueke"]);
    expect(codes(h)).toEqual([]);
  });
  it("does not check the extension", () => {
    const h = modules(
      { "main.txt": "option timezone UTC\ninclude b\n", b: '2026-10-12 "B"\n' },
      "main.txt",
    );
    expect(codes(h)).toEqual([]);
    expect(h.modules).toEqual(["main.txt", "b"]);
  });
  it("lists the paths a module includes", () => {
    expect(
      referencedSources("2026/10.hueke", parse("2026/10.hueke", FILES["2026/10.hueke"])),
    ).toEqual({ paths: ["accounts.hueke"], errors: [] });
  });
});

describe("declarations in included modules", () => {
  it("keeps a commodity declared in an included module in its Raw model, without effect", () => {
    const h = modules(FILES);
    expect(h.data.get("accounts.hueke")?.items).toEqual([
      expect.objectContaining({ kind: "commodity", args: ["NTD"] }),
    ]);
    const ntd = h.commodities.find((c) => c.id === "NTD");
    expect(ntd).toMatchObject({ precision: 0, precisionWritten: false });
    expect(ntd).not.toHaveProperty("span");
    const [ignored] = diagnostics(h, "module.ignored-declaration");
    expect(ignored).toMatchObject({ severity: "warning", source: "accounts.hueke" });
    expect(ignored?.message).toMatch(/root/);
  });
  it("does not take a setting from an included module", () => {
    const h = modules({
      ...FILES,
      "accounts.hueke": `option timezone UTC\n${FILES["accounts.hueke"]}`,
    });
    expect(h.settings.timezone).toBe("Asia/Taipei");
    expect(h.transactions[0]?.effective.start).toBe("2026-10-11T16:00Z");
    expect(located(h, false)).toEqual([
      ["module.duplicate", "2026/10.hueke"],
      ["module.ignored-declaration", "accounts.hueke"],
      ["module.ignored-declaration", "accounts.hueke"],
    ]);
  });
  it("takes the commodity when main.hueke holds the declaration", () => {
    const h = modules({
      ...FILES,
      "main.hueke": `${FILES["main.hueke"]}commodity NTD\n    precision 0\n`,
      "accounts.hueke": "",
    });
    const ntd = h.commodities.find((c) => c.id === "NTD");
    expect(ntd).toMatchObject({ precision: 0, precisionWritten: true });
    expect(ntd?.span).toBeDefined();
    expect(codes(h, true)).toEqual(["module.duplicate"]);
  });
  it("takes the root's declarations wherever they stand in the root", () => {
    const h = modules({
      "main.hueke": `include a.hueke
2026-10-12 "A"
    Expenses:Food  5 POINT
    Assets:Cash   -5 POINT
option timezone Asia/Taipei
commodity POINT
    precision 2
`,
      "a.hueke": "",
    });
    expect(h.settings.timezone).toBe("Asia/Taipei");
    expect(h.commodities.find((c) => c.id === "POINT")).toMatchObject({
      precision: 2,
      precisionWritten: true,
    });
    expect(codes(h)).toEqual([]);
  });
  it("ignores every kind of declaration at any depth, and keeps them in the Raw model", () => {
    const h = modules({
      "main.hueke": "option timezone UTC\ninclude a.hueke\n",
      "a.hueke": "include b.hueke\n",
      "b.hueke": `option week-start sunday
account-root Bank asset
commodity POINT
    precision 2
account Bank:Savings
    primary POINT
`,
    });
    expect(located(h, false)).toEqual(Array(4).fill(["module.ignored-declaration", "b.hueke"]));
    expect(h.settings.weekStart).toBe("monday");
    expect(h.roots.map((r) => r.name)).not.toContain("Bank");
    expect(h.commodities.map((c) => c.id)).not.toContain("POINT");
    expect(h.accounts.map((a) => a.id)).not.toContain("Bank:Savings");
    expect(h.data.get("b.hueke")?.items.map((i) => i.kind)).toEqual([
      "option",
      "account-root",
      "commodity",
      "account",
    ]);
  });
  it("never counts an included declaration as a duplicate", () => {
    const h = modules({
      "main.hueke": `option timezone UTC
include a.hueke
include b.hueke
commodity POINT
    precision 2
account Assets:Cash
`,
      "a.hueke":
        "option timezone Asia/Tokyo\ncommodity POINT\n    precision 0\naccount Assets:Cash\n",
      "b.hueke":
        "option timezone Asia/Seoul\ncommodity POINT\n    precision 1\naccount Assets:Cash\n",
    });
    expect(codes(h)).toEqual(Array(6).fill("module.ignored-declaration"));
    expect(h.settings.timezone).toBe("UTC");
    expect(h.commodities.find((c) => c.id === "POINT")?.precision).toBe(2);
  });
});

describe("entities and anchors across modules", () => {
  const ROOT = "option timezone Asia/Taipei\ninclude people.hueke\ninclude 2026/10.hueke\n";

  it("an entity declared in an included module does not take effect", () => {
    const h = modules({
      "main.hueke": `${ROOT}entity KEN\n`,
      "people.hueke": "entity NAT\n    display-name Nat Chen\nentity KEN\n",
      "2026/10.hueke": "",
    });
    expect(located(h, false)).toEqual([
      ["module.ignored-declaration", "people.hueke"],
      ["module.ignored-declaration", "people.hueke"],
    ]);
    expect(h.entities.map((e) => e.id)).toEqual(["KEN"]);
  });
  it("records of every module share one namespace of anchors", () => {
    const h = modules({
      "main.hueke": `${ROOT}\n2026-10-18 %tokyo-trip "Tokyo trip"\n`,
      "people.hueke": "",
      "2026/10.hueke": `
2026-10-18 * "Flight" ^tokyo-trip #tokyo-trip
    Expenses:Transport     12000 NTD
    Bank:Checking         -12000 NTD
`,
    });
    expect(located(h, false)).toEqual([]);
    const flight = h.transactions.find((t) => t.description === "Flight");
    expect(flight?.primaryTarget).toBe("tokyo-trip");
    expect(flight?.tags[0]?.target).toBe("tokyo-trip");
  });
  it("an anchor defined in two modules is a duplicate, and neither defines it", () => {
    const h = modules({
      "main.hueke": `${ROOT}\n2026-10-03 * %t_book "Bookstore"\n    Expenses:Other  500 NTD\n    Assets:Cash\n`,
      "people.hueke": "",
      "2026/10.hueke": `2026-10-04 * %t_book "Bookstore again"\n    Expenses:Other  300 NTD\n    Assets:Cash\n`,
    });
    const duplicates = diagnostics(h, "anchor.duplicate");
    // The included module stands at its include line, before the root's record.
    expect(duplicates.map((d) => d.source)).toEqual(["main.hueke"]);
    expect(duplicates[0]?.message).toMatch(/2026\/10\.hueke:\d+/);
    expect(h.transactions.map((t) => t.id).sort()).toEqual(["~1", "~2"]);
  });
});
