// docs/core/modules.md
import { describe, expect, it } from "vitest";
import { check, parse, referencedSources } from "../../srcs/index.js";
import { balanceOf, codes, modules } from "./ledger.js";

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
const diagnostics = (h: ReturnType<typeof modules>, withInfo = true) =>
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
    expect(diagnostics(h)).toEqual([
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
  it("numbers IDs and orders ties in module order", () => {
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
    expect(diagnostics(h, false)).toEqual([
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
    expect(diagnostics(h, false)).toEqual([["module.duplicate", "b.hueke"]]);
    expect(balanceOf(h, "Assets:Cash", "2026-10-31")).toBe("-5");
  });
  it("lists the paths a module includes", () => {
    expect(
      referencedSources("2026/10.hueke", parse("2026/10.hueke", FILES["2026/10.hueke"])),
    ).toEqual({ paths: ["accounts.hueke"], errors: [] });
  });
});

describe("include lines", () => {
  it("takes a quoted path with whitespace or ;", () => {
    const h = modules({
      "main.hueke": 'option timezone UTC\ninclude "my files/a b.hueke"\ninclude "c;d.hueke"\n',
      "my files/a b.hueke": '2026-10-12 "A"\n',
      "c;d.hueke": '2026-10-12 "C"\n',
    });
    expect(h.modules).toEqual(["main.hueke", "my files/a b.hueke", "c;d.hueke"]);
    expect(codes(h)).toEqual([]);
  });
  it("is parse.syntax with an extra token, and the line is not loaded", () => {
    const h = modules({
      "main.hueke": "option timezone UTC\ninclude a.hueke b.hueke\n",
      "a.hueke": '2026-10-12 "A"\n',
      "b.hueke": '2026-10-12 "B"\n',
    });
    expect(codes(h)).toEqual(["parse.syntax"]);
    expect(h.modules).toEqual(["main.hueke"]);
    expect(h.transactions).toEqual([]);
  });
  it("is parse.syntax without a path", () => {
    const h = modules({ "main.hueke": "option timezone UTC\ninclude\n" });
    expect(codes(h)).toEqual(["parse.syntax"]);
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
    expect(ntd?.span).toBeUndefined();
    const ignored = check(h).find((d) => d.code === "module.ignored-declaration");
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
    expect(diagnostics(h, false)).toEqual([
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
    expect(diagnostics(h, false)).toEqual(Array(4).fill(["module.ignored-declaration", "b.hueke"]));
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
      "b.hueke": "commodity POINT\n    precision 1\naccount Assets:Cash\n",
    });
    expect(codes(h)).toEqual(Array(5).fill("module.ignored-declaration"));
    expect(h.settings.timezone).toBe("UTC");
    expect(h.commodities.find((c) => c.id === "POINT")?.precision).toBe(2);
  });
});

describe("option.duplicate", () => {
  it("applies within the root, and every writing is ignored", () => {
    const h = modules({
      "main.hueke": "option timezone Asia/Taipei\ninclude a.hueke\noption timezone Asia/Tokyo\n",
      "a.hueke": "",
    });
    expect(diagnostics(h, false)).toEqual([["option.duplicate", "main.hueke"]]);
    expect(h.settings.timezone).toBe("UTC");
  });
  it("does not apply between the root and an included module", () => {
    const h = modules({
      "main.hueke": "option timezone Asia/Taipei\ninclude a.hueke\n",
      "a.hueke": "option timezone Asia/Tokyo\n",
    });
    expect(codes(h)).toEqual(["module.ignored-declaration"]);
    expect(h.settings.timezone).toBe("Asia/Taipei");
  });
});
