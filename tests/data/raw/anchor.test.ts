import { describe, expect, it } from "vitest";
import { anchorKey, parse } from "../../../srcs/index.js";
import type { ItemData, TransactionData } from "../../../srcs/index.js";

const transactions = (text: string): TransactionData[] =>
  parse("main.hueke", text).items.filter(
    (i: ItemData): i is TransactionData => i.kind === "transaction",
  );

describe("anchorKey", () => {
  it("gives a definition and its references the same key", () => {
    const [closing, payment] = transactions(
      '2026-10-25 %esun-card/2026-10 "Statement"\n2026-11-10 "Payment" #statement:esun-card/2026-10\n',
    );
    const ref = payment?.tags[0]?.ref;
    expect(closing?.anchor && anchorKey(closing.anchor)).toBe("esun-card/2026-10");
    expect(ref && anchorKey(ref)).toBe("esun-card/2026-10");
  });

  it("keeps module anchors apart from period anchors", () => {
    const [t] = transactions('2026-10-12 "x" #shared:trip:n1 #trip/n1\n');
    expect(t?.tags.map((tag) => anchorKey(tag.ref))).toEqual(["trip:n1", "trip/n1"]);
  });

  it("gives a plain anchor its name", () => {
    const [t] = transactions('2026-10-12 %lunch "Lunch"\n');
    expect(t?.anchor && anchorKey(t.anchor)).toBe("lunch");
  });
});
