// docs/core/settings.md
import { describe, expect, it } from "vitest";
import { check } from "../../srcs/index.js";
import { codes, ledger } from "./ledger.js";

describe("wrong ledger settings", () => {
  it("reports an unknown and a repeated option", () => {
    const h = ledger(`option currency NTD\noption timezone Asia/Tokyo\n`);
    expect(codes(h, true)).toEqual(["option.unknown", "option.duplicate"]);
    expect(
      check(h)
        .map((d) => d.message)
        .join(),
    ).toContain("currency");
  });
});
