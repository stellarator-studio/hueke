import { describe, expect, it } from "vitest";
import { position } from "../../../srcs/index.js";
import type { ModuleData } from "../../../srcs/index.js";

// "2026-10-12 \"Lunch\"\n    Expenses:Food  180 NTD\n    Assets:Cash\n"
const data: ModuleData = { comments: [], items: [], lineStarts: [0, 16, 35], diagnostics: [] };

describe("position", () => {
  it("counts lines and columns from 1", () => {
    expect(position(data, 0)).toEqual({ line: 1, column: 1 });
    expect(position(data, 20)).toEqual({ line: 2, column: 5 });
  });

  it("puts a line start on its own line", () => {
    expect(position(data, 35)).toEqual({ line: 3, column: 1 });
  });
});
