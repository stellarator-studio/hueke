import { describe, expect, it } from "vitest";
import { parse, referencedSources } from "../../../srcs/index.js";

describe("referencedSources", () => {
  it("returns the resolved paths, repeats kept, and the path errors", () => {
    const text =
      'include a.hueke\ninclude ../../x.hueke\ninclude "b c.hueke"\ninclude x/\ninclude a.hueke\n';
    const { paths, errors } = referencedSources("2026/main.hueke", parse("2026/main.hueke", text));
    expect(paths).toEqual(["2026/a.hueke", "2026/b c.hueke", "2026/a.hueke"]);
    expect(errors.map((d) => [d.code, d.source, d.span?.start])).toEqual([
      ["path.outside-root", "2026/main.hueke", text.indexOf("include ../")],
      ["path.invalid", "2026/main.hueke", text.indexOf("include x/")],
    ]);
  });
  it("accepts a path with parentheses written without quotes", () => {
    const data = parse("main.hueke", "include a(b).hueke\n");
    expect(data.diagnostics).toEqual([]);
    expect(referencedSources("main.hueke", data)).toEqual({ paths: ["a(b).hueke"], errors: [] });
  });
});
