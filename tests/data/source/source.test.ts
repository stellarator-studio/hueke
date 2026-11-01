import { describe, expect, it } from "vitest";
import { parse, position } from "../../../srcs/index.js";

const text = '2026-10-12 "Lunch"\n    Expenses:Food  180 NTD\n    Assets:Cash\n';
const data = parse("main.hueke", text);

describe("position", () => {
  it("counts lines and columns from 1", () => {
    expect(position(data, 0)).toEqual({ line: 1, column: 1 });
    expect(position(data, text.indexOf("Expenses"))).toEqual({ line: 2, column: 5 });
  });

  it("puts a line start on its own line", () => {
    expect(position(data, text.indexOf("    Assets"))).toEqual({ line: 3, column: 1 });
  });
});
