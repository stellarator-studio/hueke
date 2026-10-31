import { describe, expect, expectTypeOf, it } from "vitest";
import type { ModuleData, PostingData, TransactionData } from "../../../srcs/index.js";

// 2026-10-12 * "Lunch" #travel  ; with colleagues
//     ;; invoice_number: AB-12345678
//     Expenses:Food  180 NTD
//         - Lunch box  = 120
//         ; the drink was a treat
//         - Drink  = 60
//     Assets:Cash
const lunch: TransactionData = {
  kind: "transaction",
  effective: "2026-10-12",
  mark: "*",
  description: "Lunch",
  refs: [],
  tags: [{ ref: { name: "travel" } }],
  trailer: { kind: "comment", text: "with colleagues" },
  lines: [{ kind: "note", note: { kind: "meta", key: "invoice_number", value: "AB-12345678" } }],
  postings: [
    {
      cleared: false,
      account: "Expenses:Food",
      amount: "180 NTD",
      refs: [],
      tags: [],
      lines: [
        { kind: "breakdown", name: "Lunch box", figure: "= 120" },
        { kind: "note", note: { kind: "comment", text: "the drink was a treat" } },
        { kind: "breakdown", name: "Drink", figure: "= 60" },
      ],
    },
    { cleared: false, account: "Assets:Cash", refs: [], tags: [], lines: [] },
  ],
};

const file: ModuleData = { comments: [], items: [lunch], lineStarts: [0], diagnostics: [] };

describe("Raw model", () => {
  it("keeps whole-line notes in place among posting lines", () => {
    const [first] = lunch.postings;
    expect(first?.lines.map((l) => l.kind)).toEqual(["breakdown", "note", "breakdown"]);
  });

  it("is edited by copying, reusing unchanged objects", () => {
    const [first, second] = lunch.postings;
    if (!first || !second) throw new Error("fixture");
    const edited: TransactionData = { ...lunch, postings: [first, { ...second, cleared: true }] };
    const next: ModuleData = { ...file, items: [edited] };

    expect(next.items[0]).not.toBe(lunch);
    expect(edited.postings[0]).toBe(first);
  });

  it("is read-only", () => {
    expectTypeOf<PostingData["lines"]>().toExtend<readonly unknown[]>();
    // @ts-expect-error Raw nodes are immutable
    lunch.mark = "!";
  });
});
