// docs/core/settings.md
import { describe, expect, it } from "vitest";
import { check, Hueke, parse, position, query, setOption } from "../../srcs/index.js";
import type { TextPatch } from "../../srcs/index.js";
import { balanceOf, codes, diagnostics, ledger } from "./ledger.js";

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
    expect(h.settings).not.toHaveProperty("padAccount");
    expect(h.settings).not.toHaveProperty("incomeExpenseRoot");
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

  it("keeps pad-account as written without checking it", () => {
    const h = ledger("option pad-account nothing here\n");
    expect(codes(h, true)).toEqual([]);
    expect(h.settings.padAccount).toBe("nothing here");
  });

  it("reads a quoted value as a string", () => {
    const h = ledger('option timezone "Asia/Taipei"\n', { prelude: "" });
    expect(codes(h, true)).toEqual([]);
    expect(h.settings.timezone).toBe("Asia/Taipei");
  });

  it("trims the spaces around a value", () => {
    const h = ledger("option week-start   sunday  \n");
    expect(codes(h, true)).toEqual([]);
    expect(h.settings.weekStart).toBe("sunday");
  });

  it("keeps the spacing inside a value as written", () => {
    const h = ledger("option pad-account nothing   here\n");
    expect(h.settings.padAccount).toBe("nothing   here");
  });

  it("lets a pad use a pad-account with an unknown root, reported only on the posting", () => {
    const h = ledger(`option pad-account Nowhere:Else

2026-10-12 * "Lunch"
    Expenses:Food     180 NTD
    Assets:Cash      -180 NTD

2026-10-31 balance Assets:Cash 0 NTD pad
`);
    expect(codes(h, true)).toEqual(["name.unknown-root"]);
    expect(
      query(h)
        .tags("system:balance")
        .postings()
        .map((p) => `${p.account} ${p.amount.value}`),
    ).toEqual(["Assets:Cash 180", "Nowhere:Else -180"]);
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

  it("leaves the kinds strict does not name in normal mode", () => {
    const h = ledger(`option strict account, entity

account Expenses:Food
account Assets:Cash

2026-10-12 * "Lunch"
    Expenses:Food     180 TWD
    Assets:Cash      -180 TWD
`);
    expect(h.settings.strict).toEqual(["account", "entity"]);
    expect(codes(h, true)).toEqual(["name.inferred-commodity"]);
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
    expect(diagnostics(h, "option.unknown")[0]?.severity).toBe("error");
    expect(h.settings.timezone).toBe("Asia/Taipei");
  });

  describe("a setting written more than once in the root module", () => {
    it("falls back to UTC for a repeated timezone", () => {
      const h = ledger("option timezone Asia/Tokyo\n");
      expect(h.settings.timezone).toBe("UTC");
      expect(diagnostics(h, "option.duplicate")[0]?.severity).toBe("error");
    });

    it("falls back to the creation option for a repeated timezone", () => {
      const h = ledger("option timezone Asia/Tokyo\n", { timezone: "Europe/Paris" });
      expect(h.settings.timezone).toBe("Europe/Paris");
      expect(codes(h, true)).toEqual(["option.duplicate"]);
    });

    it("is reported on each writing after the first", () => {
      const text = "option week-start sunday\noption week-start friday\noption week-start sunday\n";
      const h = ledger(text, { prelude: "" });
      const duplicates = diagnostics(h, "option.duplicate");
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
      expect(h.settings).not.toHaveProperty("padAccount");
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
        expect(h.settings).not.toHaveProperty("incomeExpenseRoot");
      },
    );
    it("rejects a merged root name with ;", () => {
      const h = ledger('option income-expense "on Flo;w"\n');
      expect(codes(h, true)).toEqual(["option.invalid-value"]);
    });

    it.each(["Flow", "yes"])(
      "leaves income and expense apart when income-expense does not start with on: %s",
      (value) => {
        const h = ledger(`option income-expense ${value}\n`);
        expect(codes(h, true)).toEqual(["option.invalid-value"]);
        expect(h.settings).not.toHaveProperty("incomeExpenseRoot");
      },
    );

    it("uses no strict kinds for an empty value", () => {
      const h = ledger("option strict\n");
      expect(codes(h, true)).toEqual(["option.invalid-value"]);
      expect(h.settings.strict).toEqual([]);
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

    it("rejects a group mark in a number when the group mark is none", () => {
      const h = ledger(`option group-mark none

2026-10-12 * "Rent"
    Expenses:Housing     1,000 NTD
    Bank:Checking

2026-10-13 * "Deposit"
    Expenses:Housing     1000 NTD
    Bank:Checking       -1000 NTD
`);
      expect(codes(h)).toEqual(["parse.invalid-number"]);
      expect(h.transactions.map((t) => t.description)).toEqual(["Deposit"]);
      expect(balanceOf(h, "Expenses:Housing", "2026-10-31")).toBe("1000");
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
      const invalid = diagnostics(h, "option.invalid-value")[0];
      const data = h.data.get("main.hueke");
      expect(data && invalid?.span && position(data, invalid.span.start).line).toBe(1);
      expect(h.settings.decimalMark).toBe(",");
      expect(h.settings.groupMark).toBe(".");
      expect(balanceOf(h, "Expenses:Housing", "2026-10-13", "EUR")).toBe("1500.25");
    });

    it("treats a decimal mark written twice as not written", () => {
      const h = ledger("option decimal-mark .\noption decimal-mark .\noption group-mark .\n");
      expect(codes(h, true)).toEqual(["option.duplicate"]);
      expect(h.settings.decimalMark).toBe(",");
      expect(h.settings.groupMark).toBe(".");
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

describe("changing settings", () => {
  /** A ledger of main.hueke alone, or with the other files given, without the shared declarations. */
  const open = (text: string, others: Record<string, string> = {}): Hueke => {
    const h = new Hueke();
    h.load("main.hueke", parse("main.hueke", text));
    for (const [path, other] of Object.entries(others)) h.load(path, parse(path, other));
    h.init("main.hueke");
    return h;
  };

  /** The text after the patches, checking each `expect` and applying them from the last to the first. */
  const apply = (text: string, patches: readonly TextPatch[]): string => {
    let out = text;
    for (const p of [...patches].reverse()) {
      expect(p.source).toBe("main.hueke");
      expect(text.slice(p.start, p.end)).toBe(p.expect);
      out = out.slice(0, p.start) + p.text + out.slice(p.end);
    }
    return out;
  };

  const changed = (text: string, name: string, value?: string): string =>
    apply(text, setOption(open(text), name, value));

  it("writes a setting written once again with the new value, in one patch", () => {
    const text = "option week-start monday\n";
    const patches = setOption(open(text), "week-start", "sunday");
    expect(patches).toHaveLength(1);
    expect(patches[0]?.expect).toBe("option week-start monday");
    expect(apply(text, patches)).toBe("option week-start sunday\n");
  });

  it("keeps the comment on the line of the setting", () => {
    expect(changed("option timezone Asia/Tokyo  ; office\n", "timezone", "Asia/Taipei")).toBe(
      "option timezone Asia/Taipei  ; office\n",
    );
  });

  it("gives the first writing the new value and removes the others", () => {
    expect(
      changed("option timezone UTC\noption timezone Asia/Tokyo\n", "timezone", "Asia/Taipei"),
    ).toBe("option timezone Asia/Taipei\n");
  });

  it("inserts a setting not written right after the last option block", () => {
    const text = "option timezone Asia/Taipei\ncommodity NTD\n";
    const patches = setOption(open(text), "week-start", "sunday");
    expect(patches).toHaveLength(1);
    expect(patches[0]?.start).toBe(patches[0]?.end);
    expect(patches[0]?.expect).toBe("");
    expect(apply(text, patches)).toBe(
      "option timezone Asia/Taipei\noption week-start sunday\ncommodity NTD\n",
    );
  });

  it("inserts it before the first block, after the comments at the top, when no option is written", () => {
    expect(changed("; my ledger\n\ncommodity NTD\n", "week-start", "sunday")).toBe(
      "; my ledger\n\noption week-start sunday\n\ncommodity NTD\n",
    );
  });

  it("inserts it at the end of a module with no block", () => {
    expect(changed("", "week-start", "sunday")).toBe("option week-start sunday\n");
    expect(changed("; only a comment\n", "week-start", "sunday")).toBe(
      "; only a comment\noption week-start sunday\n",
    );
  });

  it("removes a setting with its line break, so the default takes effect again", () => {
    const text = "option week-start sunday\ncommodity NTD\n";
    const result = changed(text, "week-start");
    expect(result).toBe("commodity NTD\n");
    expect(open(result).settings.weekStart).toBe("monday");
  });

  it("removes every writing of a setting written twice", () => {
    const text = "option week-start sunday\ncommodity NTD\noption week-start friday\n";
    const patches = setOption(open(text), "week-start");
    expect(patches).toHaveLength(2);
    expect(apply(text, patches)).toBe("commodity NTD\n");
  });

  it("gives no patch to remove a setting not written", () => {
    expect(setOption(open("commodity NTD\n"), "week-start")).toEqual([]);
  });

  it("gives no patch when the module already reads as it would after the change", () => {
    expect(setOption(open("option week-start sunday\n"), "week-start", "sunday")).toEqual([]);
  });

  it("changes only the root module, even when an included module writes the setting", () => {
    const text = "include accounts.hueke\n";
    const h = open(text, { "accounts.hueke": "option week-start sunday\n" });
    const patches = setOption(h, "week-start", "friday");
    expect(patches.every((p) => p.source === "main.hueke")).toBe(true);
    expect(apply(text, patches)).toBe("option week-start friday\n\ninclude accounts.hueke\n");
  });

  it("returns patches sorted by start that do not overlap", () => {
    const text =
      "option timezone UTC\noption week-start sunday\noption timezone Asia/Tokyo\ncommodity NTD\noption timezone Europe/Paris\n";
    const patches = setOption(open(text), "timezone", "Asia/Taipei");
    expect(patches).toHaveLength(3);
    for (let i = 1; i < patches.length; i++) {
      const [before, after] = [patches[i - 1], patches[i]];
      expect(before && after && before.end <= after.start).toBe(true);
    }
    expect(apply(text, patches)).toBe(
      "option timezone Asia/Taipei\noption week-start sunday\ncommodity NTD\n",
    );
  });

  it("gives the new value once the changed module is loaded again", () => {
    const text = "option week-start monday\ncommodity NTD\n";
    const h = open(changed(text, "week-start", "sunday"));
    expect(h.settings.weekStart).toBe("sunday");
    expect(check(h).map((d) => d.code)).toEqual(["option.missing-timezone"]);
  });

  it("writes the value as given", () => {
    expect(changed("commodity NTD\n", "strict", "account, entity")).toBe(
      "option strict account, entity\n\ncommodity NTD\n",
    );
  });

  it.each([
    ["a name that is not a setting", "currency", "NTD"],
    ["an invalid value", "week-start", "funday"],
    ["a value with a comment", "pad-account", "Expenses:Fees ; fees"],
    ["an empty value", "timezone", ""],
    ["a value with a line break", "pad-account", "Expenses:Fees\nExpenses:Food"],
    ["a value with a carriage return", "pad-account", "Expenses:Fees\rExpenses:Food"],
    ["a value with leading whitespace", "week-start", " sunday"],
    ["a value with trailing whitespace", "week-start", "sunday "],
  ])("throws on %s", (_, name, value) => {
    const h = open("option week-start monday\n");
    expect(() => setOption(h, name, value)).toThrow();
  });

  it("throws before initialization and when the root module was never loaded", () => {
    const h = new Hueke();
    h.load("main.hueke", parse("main.hueke", "option week-start monday\n"));
    expect(() => setOption(h, "week-start", "sunday")).toThrow();
    const missing = new Hueke();
    missing.init("main.hueke");
    expect(() => setOption(missing, "week-start", "sunday")).toThrow();
  });

  it("writes an income-expense root already taken, reported by check once loaded again", () => {
    const text = "account-root Flow asset\n";
    const result = changed(text, "income-expense", "on Flow");
    expect(result).toBe("option income-expense on Flow\n\naccount-root Flow asset\n");
    expect(check(open(result)).map((d) => d.code)).toContain("option.invalid-root");
  });

  it("writes a decimal-mark equal to the group-mark, reported by check once loaded again", () => {
    const text = "option group-mark .\n";
    const result = changed(text, "decimal-mark", ".");
    expect(result).toBe("option group-mark .\noption decimal-mark .\n");
    expect(check(open(result)).map((d) => d.code)).toContain("option.invalid-number-format");
  });

  it("keeps the comments on lines the block owns", () => {
    expect(
      changed("option timezone UTC\n    ; office\ncommodity NTD\n", "timezone", "Asia/Taipei"),
    ).toBe("option timezone Asia/Taipei\n    ; office\ncommodity NTD\n");
  });

  it("rewrites a writing with the same value that is not in canonical form", () => {
    const text = "option  week-start   sunday\n";
    const patches = setOption(open(text), "week-start", "sunday");
    expect(patches).toHaveLength(1);
    expect(apply(text, patches)).toBe("option week-start sunday\n");
  });

  it("throws on a value with a tab", () => {
    const h = open("option week-start monday\n");
    expect(() => setOption(h, "pad-account", "Expenses:A\tB")).toThrow();
  });

  it.each([
    ["pad-account", "Expenses:A  B", "padAccount"],
    ["income-expense", "on  Flow", "incomeExpenseRoot"],
  ] as const)("writes %s %s with its spaces in a row as given", (name, value, field) => {
    const result = changed("commodity NTD\n", name, value);
    expect(result).toBe(`option ${name} ${value}\n\ncommodity NTD\n`);
    const again = open(result);
    expect(check(again).map((d) => d.code)).not.toContain("option.invalid-value");
    expect(again.settings[field]).toBe(name === "income-expense" ? "Flow" : value);
  });

  describe("in a file whose line breaks are all \\r\\n", () => {
    it("inserts after the last option block with \\r\\n", () => {
      expect(changed("option timezone UTC\r\ncommodity NTD\r\n", "week-start", "sunday")).toBe(
        "option timezone UTC\r\noption week-start sunday\r\ncommodity NTD\r\n",
      );
    });

    it("inserts before the first block, followed by a blank line, with \\r\\n", () => {
      expect(changed("; my ledger\r\n\r\ncommodity NTD\r\n", "week-start", "sunday")).toBe(
        "; my ledger\r\n\r\noption week-start sunday\r\n\r\ncommodity NTD\r\n",
      );
    });

    it("keeps a comment line the block owns and its \\r\\n when the value changes", () => {
      expect(
        changed(
          "option timezone UTC\r\n    ; office\r\ncommodity NTD\r\n",
          "timezone",
          "Asia/Taipei",
        ),
      ).toBe("option timezone Asia/Taipei\r\n    ; office\r\ncommodity NTD\r\n");
    });

    it("removes a block with its \\r\\n", () => {
      expect(
        changed(
          "option timezone UTC\r\noption week-start sunday\r\ncommodity NTD\r\n",
          "week-start",
        ),
      ).toBe("option timezone UTC\r\ncommodity NTD\r\n");
    });
  });

  it("uses \\n in a file that mixes \\n and \\r\\n", () => {
    expect(changed("commodity NTD\r\naccount Assets:Cash\n", "week-start", "sunday")).toBe(
      "option week-start sunday\n\ncommodity NTD\r\naccount Assets:Cash\n",
    );
  });

  describe("in a file without a final line break", () => {
    it("changes the last line", () => {
      expect(changed("option week-start monday", "week-start", "sunday")).toBe(
        "option week-start sunday",
      );
    });

    it("removes the last line", () => {
      const result = changed("commodity NTD\noption week-start sunday", "week-start");
      expect(result).toBe("commodity NTD\n");
      expect(open(result).settings.weekStart).toBe("monday");
    });

    it("inserts after the last option block", () => {
      expect(changed("option timezone UTC", "week-start", "sunday")).toBe(
        "option timezone UTC\noption week-start sunday",
      );
    });
  });

  it("leaves the ledger the patches came from unchanged", () => {
    const h = open("option week-start monday\n");
    setOption(h, "week-start", "sunday");
    expect(h.settings.weekStart).toBe("monday");
  });
});
