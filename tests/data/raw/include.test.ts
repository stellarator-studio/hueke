import { describe, expect, it } from "vitest";
import { parse, referencedSources } from "../../../srcs/index.js";

describe("referencedSources", () => {
  it("returns the resolved paths and the path errors", () => {
    const module = parse(
      "2026/main.hueke",
      'include a.hueke\ninclude ../../x.hueke\ninclude "b c.hueke"\n',
    );
    const { paths, errors } = referencedSources("2026/main.hueke", module);
    expect(paths).toEqual(["2026/a.hueke", "2026/b c.hueke"]);
    expect(errors.map((d) => [d.code, d.source, d.span?.start])).toEqual([
      ["path.outside-root", "2026/main.hueke", 16],
    ]);
  });
});
