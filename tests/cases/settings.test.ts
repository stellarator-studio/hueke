// docs/core/settings.md
import { describe, expect, it } from "vitest";
import { check, position } from "../../srcs/index.js";
import { balanceOf, codes, ledger, modules } from "./ledger.js";

const messages = (h: ReturnType<typeof ledger>): string =>
  check(h)
    .map((d) => d.message)
    .join("\n");

describe("ledger settings", () => {
  it("uses the defaults when nothing is written", () => {
    const h = ledger("", { prelude: "" });
    expect(h.settings).toEqual({
      timezone: "UTC",
      weekStart: "monday",
      strict: [],
      decimalMark: ".",
      groupMark: ",",
    });
    expect("padAccount" in h.settings).toBe(false);
    expect("incomeExpenseRoot" in h.settings).toBe(false);
  });

  it("reads every setting written in the root module", () => {
    const h = ledger(
      [
        "option timezone Asia/Tokyo",
        "option pad-account Equity:Opening",
        "option week-start sunday",
        "option strict account,commodity",
        "option income-expense on Flow",
        "option decimal-mark ,",
        "option group-mark .",
        "",
      ].join("\n"),
      { prelude: "" },
    );
    expect(h.settings).toEqual({
      timezone: "Asia/Tokyo",
      padAccount: "Equity:Opening",
      weekStart: "sunday",
      strict: ["account", "commodity"],
      incomeExpenseRoot: "Flow",
      decimalMark: ",",
      groupMark: ".",
    });
    expect(codes(h, true)).not.toContain("option.missing-timezone");
  });

  it("names the merged income and expense root IncomeExpenses by default", () => {
    const h = ledger("option income-expense on\n");
    expect(codes(h, true)).toEqual([]);
    expect(h.settings.incomeExpenseRoot).toBe("IncomeExpenses");
  });

  it("accepts none as the group mark", () => {
    const h = ledger("option group-mark none\n");
    expect(h.settings.groupMark).toBeNull();
    expect(codes(h, true)).toEqual([]);
  });

  it("applies a setting wherever it stands in the root module", () => {
    const h = ledger("option week-start friday\n", {
      prelude: `commodity NTD\n    precision 0\n\noption timezone Asia/Tokyo\n`,
    });
    expect(h.settings.timezone).toBe("Asia/Tokyo");
    expect(h.settings.weekStart).toBe("friday");
  });

  it("allows spaces around the commas of strict", () => {
    const h = ledger("option strict account ,  commodity, entity\n");
    expect(codes(h, true)).toEqual([]);
    expect(h.settings.strict).toEqual(["account", "commodity", "entity"]);
  });

  it("turns on every strict kind when strict mode is given at creation", () => {
    const h = ledger("option strict account\n", { strict: true });
    expect(h.settings.strict).toEqual(["account", "commodity", "entity"]);
  });
});

describe("settings in included modules", () => {
  it("has no effect and warns, whether or not the root writes the same setting", () => {
    const h = modules({
      "main.hueke": "option timezone Asia/Taipei\ninclude extra.hueke\n",
      "extra.hueke": "option timezone Asia/Tokyo\noption week-start sunday\n",
    });
    expect(h.settings.timezone).toBe("Asia/Taipei");
    expect(h.settings.weekStart).toBe("monday");
    const ignored = check(h).filter((d) => d.code === "module.ignored-declaration");
    expect(ignored.map((d) => d.severity)).toEqual(["warning", "warning"]);
    expect(ignored.map((d) => d.source)).toEqual(["extra.hueke", "extra.hueke"]);
    expect(codes(h, true)).not.toContain("option.duplicate");
  });

  it("is ignored at any depth", () => {
    const h = modules({
      "main.hueke": "option timezone Asia/Taipei\ninclude a.hueke\n",
      "a.hueke": "include b.hueke\n",
      "b.hueke": "option decimal-mark ,\noption group-mark .\n",
    });
    expect(h.settings.decimalMark).toBe(".");
    expect(h.settings.groupMark).toBe(",");
    expect(codes(h, true)).toEqual(["module.ignored-declaration", "module.ignored-declaration"]);
  });

  it("does not give the ledger a time zone", () => {
    const h = modules({
      "main.hueke": "include extra.hueke\n",
      "extra.hueke": "option timezone Asia/Tokyo\n",
    });
    expect(h.settings.timezone).toBe("UTC");
    expect(codes(h, true).sort()).toEqual(
      ["module.ignored-declaration", "option.missing-timezone"].sort(),
    );
  });

  it("never makes a setting in two included modules a duplicate", () => {
    const h = modules({
      "main.hueke": "option timezone Asia/Taipei\ninclude a.hueke\ninclude b.hueke\n",
      "a.hueke": "option week-start sunday\n",
      "b.hueke": "option week-start friday\n",
    });
    expect(h.settings.weekStart).toBe("monday");
    expect(codes(h, true)).toEqual(["module.ignored-declaration", "module.ignored-declaration"]);
  });
});

describe("wrong ledger settings", () => {
  it("reports an unknown and a repeated option", () => {
    const h = ledger(`option currency NTD\noption timezone Asia/Tokyo\n`);
    expect(codes(h, true)).toEqual(["option.unknown", "option.duplicate"]);
    expect(messages(h)).toContain("currency");
  });

  it("ignores an unknown setting's line", () => {
    const h = ledger("option currency NTD\n");
    expect(check(h).find((d) => d.code === "option.unknown")?.severity).toBe("error");
    expect(h.settings.timezone).toBe("Asia/Taipei");
  });

  describe("a setting written more than once in the root module", () => {
    it("falls back to UTC for a repeated timezone", () => {
      const h = ledger("option timezone Asia/Tokyo\n");
      expect(h.settings.timezone).toBe("UTC");
      expect(check(h).find((d) => d.code === "option.duplicate")?.severity).toBe("error");
    });

    it("falls back to the creation option for a repeated timezone", () => {
      const h = ledger("option timezone Asia/Tokyo\n", { timezone: "Europe/Paris" });
      expect(h.settings.timezone).toBe("Europe/Paris");
      expect(codes(h, true)).toEqual(["option.duplicate"]);
    });

    it("is reported on each writing after the first", () => {
      const text = "option week-start sunday\noption week-start friday\noption week-start sunday\n";
      const h = ledger(text, { prelude: "" });
      const duplicates = check(h).filter((d) => d.code === "option.duplicate");
      expect(duplicates.map((d) => d.span?.start)).toEqual([
        text.indexOf("option week-start friday"),
        text.lastIndexOf("option week-start sunday"),
      ]);
      expect(h.settings.weekStart).toBe("monday");
    });

    it("ignores every writing, so the result does not depend on order", () => {
      const a = ledger("option week-start sunday\noption week-start friday\n");
      const b = ledger("option week-start friday\noption week-start sunday\n");
      expect(a.settings.weekStart).toBe("monday");
      expect(b.settings.weekStart).toBe("monday");
    });

    it("ignores even identical writings", () => {
      const h = ledger("option pad-account Equity:Opening\noption pad-account Equity:Opening\n");
      expect("padAccount" in h.settings).toBe(false);
      expect(codes(h, true)).toEqual(["option.duplicate"]);
    });
  });

  describe("an invalid value", () => {
    it.each([
      ["week-start", "funday", "weekStart", "monday"],
      ["decimal-mark", ";", "decimalMark", "."],
      ["group-mark", "_", "groupMark", ","],
    ] as const)("uses the default for %s %s", (name, value, field, fallback) => {
      const h = ledger(`option ${name} ${value}\n`);
      expect(codes(h, true)).toEqual(["option.invalid-value"]);
      expect(check(h)[0]?.severity).toBe("error");
      expect(h.settings[field]).toBe(fallback);
    });

    it.each(["1Flow", "Flow:Food", 'Fl"ow', "Flow,X", "Flow X"])(
      "rejects the merged root name %s",
      (name) => {
        const h = ledger(`option income-expense on ${name}\n`);
        expect(codes(h, true)).toEqual(["option.invalid-value"]);
        expect("incomeExpenseRoot" in h.settings).toBe(false);
      },
    );
    it("rejects a merged root name with ;", () => {
      const h = ledger('option income-expense "on Flo;w"\n');
      expect(codes(h, true)).toEqual(["option.invalid-value"]);
    });

    it("leaves income and expense apart when income-expense does not start with on", () => {
      const h = ledger("option income-expense Flow\n");
      expect(codes(h, true)).toEqual(["option.invalid-value"]);
      expect("incomeExpenseRoot" in h.settings).toBe(false);
    });

    it.each(["account,", "account,,commodity"])(
      "uses no strict kinds for an empty kind: %s",
      (value) => {
        const h = ledger(`option strict ${value}\n`);
        expect(codes(h, true)).toEqual(["option.invalid-value"]);
        expect(h.settings.strict).toEqual([]);
      },
    );

    it("uses no strict kinds for an unknown kind", () => {
      const h = ledger("option strict account,payee\n");
      expect(codes(h, true)).toEqual(["option.invalid-value"]);
      expect(h.settings.strict).toEqual([]);
    });

    it("uses UTC for an unknown time zone, without reporting a missing one", () => {
      const h = ledger("option timezone Mars/Olympus\n", { prelude: "" });
      expect(codes(h, true)).toEqual(["option.invalid-value"]);
      expect(h.settings.timezone).toBe("UTC");
    });

    it("uses the creation option for an unknown time zone", () => {
      const h = ledger("option timezone Mars/Olympus\n", {
        prelude: "",
        timezone: "Europe/Paris",
      });
      expect(codes(h, true)).toEqual(["option.invalid-value"]);
      expect(h.settings.timezone).toBe("Europe/Paris");
    });
  });

  describe("only one of decimal and group mark written", () => {
    it("makes the group mark a period when the decimal mark is a comma", () => {
      const h = ledger("option decimal-mark ,\n");
      expect(codes(h, true)).toEqual([]);
      expect(h.settings.decimalMark).toBe(",");
      expect(h.settings.groupMark).toBe(".");
    });

    it("makes the decimal mark a comma when the group mark is a period", () => {
      const h = ledger("option group-mark .\n");
      expect(codes(h, true)).toEqual([]);
      expect(h.settings.decimalMark).toBe(",");
      expect(h.settings.groupMark).toBe(".");
    });

    it("keeps the other default when it already differs", () => {
      const h = ledger("option group-mark '\n");
      expect(h.settings.decimalMark).toBe(".");
      expect(h.settings.groupMark).toBe("'");
    });

    it("keeps the decimal mark a period when the group mark is none", () => {
      const h = ledger("option group-mark none\n");
      expect(codes(h, true)).toEqual([]);
      expect(h.settings.decimalMark).toBe(".");
      expect(h.settings.groupMark).toBeNull();
    });

    it("treats an invalid decimal mark as not written", () => {
      const h = ledger(
        [
          "option decimal-mark x",
          "option group-mark .",
          "",
          "commodity EUR",
          "    precision 2",
          "",
          '2026-10-13 * "Rent in Berlin"',
          "    Expenses:Housing    1.500,25 EUR",
          "    Bank:EURAccount    -1.500,25 EUR",
          "",
        ].join("\n"),
        { prelude: "", timezone: "UTC" },
      );
      expect(codes(h)).toEqual(["option.invalid-value"]);
      const invalid = check(h).find((d) => d.code === "option.invalid-value");
      const data = h.data.get("main.hueke");
      expect(data && invalid?.span && position(data, invalid.span.start).line).toBe(1);
      expect(h.settings.decimalMark).toBe(",");
      expect(h.settings.groupMark).toBe(".");
      expect(balanceOf(h, "Expenses:Housing", "2026-10-13", "EUR")).toBe("1500.25");
    });

    it("treats a decimal mark written twice as not written", () => {
      const h = ledger("option decimal-mark ,\noption decimal-mark ,\noption group-mark ,\n");
      const found = codes(h, true);
      expect(found).toContain("option.duplicate");
      expect(found).not.toContain("option.invalid-number-format");
      expect(h.settings.decimalMark).toBe(".");
      expect(h.settings.groupMark).toBe(",");
    });
  });

  describe("the same mark for decimal and group", () => {
    it("falls back to both defaults", () => {
      const h = ledger("option group-mark ,\noption decimal-mark ,\n", {
        prelude: "",
        timezone: "UTC",
      });
      expect(codes(h)).toEqual(["option.invalid-number-format"]);
      const [invalid] = check(h);
      expect(invalid?.severity).toBe("error");
      const data = h.data.get("main.hueke");
      expect(data && invalid?.span && position(data, invalid.span.start).line).toBe(2);
      expect(h.settings.decimalMark).toBe(".");
      expect(h.settings.groupMark).toBe(",");
    });

    it("falls back to both defaults when the marks are swapped onto one", () => {
      const h = ledger("option decimal-mark .\noption group-mark .\n");
      expect(codes(h, true)).toEqual(["option.invalid-number-format"]);
      expect(h.settings.decimalMark).toBe(".");
      expect(h.settings.groupMark).toBe(",");
    });
  });
});

describe("the default time zone", () => {
  it("warns and uses UTC when the ledger writes no timezone and no creation option gives one", () => {
    const h = ledger("", { prelude: "" });
    const missing = check(h).filter((d) => d.code === "option.missing-timezone");
    expect(missing.map((d) => d.severity)).toEqual(["warning"]);
    expect(h.settings.timezone).toBe("UTC");
  });

  it("uses the creation option when the ledger writes none", () => {
    const h = ledger("", { prelude: "", timezone: "Europe/Paris" });
    expect(codes(h, true)).toEqual([]);
    expect(h.settings.timezone).toBe("Europe/Paris");
  });

  it("prefers the ledger's timezone to the creation option", () => {
    const h = ledger("", { timezone: "Europe/Paris" });
    expect(h.settings.timezone).toBe("Asia/Taipei");
  });

  it("does not report a missing time zone for a repeated timezone", () => {
    const h = ledger("option timezone Asia/Tokyo\n");
    expect(codes(h, true)).not.toContain("option.missing-timezone");
  });

  it("does not report a missing time zone for an invalid timezone", () => {
    const h = ledger("option timezone Nowhere\n", { prelude: "" });
    expect(codes(h, true)).not.toContain("option.missing-timezone");
  });
});
