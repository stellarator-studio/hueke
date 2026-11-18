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
    expect(t?.tags.map((tag) => anchorKey(tag.ref))).toEqual(["shared:trip:n1", "trip/n1"]);
  });

  it("puts shared anchors under shared:, apart from the anchor of the same name", () => {
    const [event, member, own] = transactions(
      '2026-10-12 %shared:trip "Trip"\n2026-10-13 "x" ^shared:trip #shared:trip\n2026-10-14 %trip "Own"\n',
    );
    expect(event?.anchor && anchorKey(event.anchor)).toBe("shared:trip");
    expect(member?.primaryTag && anchorKey(member.primaryTag.ref)).toBe("shared:trip");
    expect(member?.tags.map((tag) => anchorKey(tag.ref))).toEqual(["shared:trip"]);
    expect(own?.anchor && anchorKey(own.anchor)).toBe("trip");
  });

  it("gives %tag:x the key of %x", () => {
    const [t] = transactions('2026-10-12 %tag:lunch "Lunch"\n');
    expect(t?.anchor && anchorKey(t.anchor)).toBe("lunch");
  });

  it("gives a plain anchor its name", () => {
    const [t] = transactions('2026-10-12 %lunch "Lunch"\n');
    expect(t?.anchor && anchorKey(t.anchor)).toBe("lunch");
  });
});
