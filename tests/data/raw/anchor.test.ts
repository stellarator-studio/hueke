import { describe, expect, it } from "vitest";
import { anchorKey } from "../../../srcs/index.js";
import type { TagData, TransactionData } from "../../../srcs/index.js";

describe("anchorKey", () => {
  it("gives a definition and its references the same key", () => {
    // 2026-10-25 %esun-card/2026-10 "Statement"
    const closing: Pick<TransactionData, "anchor"> = {
      anchor: { name: "esun-card", period: "2026-10" },
    };
    // #statement:esun-card/2026-10
    const payment: TagData = { scope: "statement", ref: { name: "esun-card", period: "2026-10" } };

    expect(closing.anchor && anchorKey(closing.anchor)).toBe(anchorKey(payment.ref));
    expect(anchorKey(payment.ref)).toBe("esun-card/2026-10");
  });

  it("keeps module anchors apart from period anchors", () => {
    // #shared:trip:n1 and #trip/n1
    expect(anchorKey({ module: "trip", name: "n1" })).toBe("trip:n1");
    expect(anchorKey({ name: "trip", period: "n1" })).toBe("trip/n1");
  });
});
