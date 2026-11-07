import { describe, expect, expectTypeOf, it } from "vitest";
import { parse } from "../../../srcs/index.js";
import type { ModuleData, PostingData, TransactionData } from "../../../srcs/index.js";

const file = parse(
  "main.hueke",
  `2026-10-12 * "Lunch" #travel  ; with colleagues
    ;; invoice_number: AB-12345678
    Expenses:Food  180 NTD
        - Lunch box  = 120
        ; the drink was a treat
        - Drink  = 60
    Assets:Cash
`,
);
const [lunch] = file.items.filter((i): i is TransactionData => i.kind === "transaction");

describe("Raw model", () => {
  it("keeps whole-line notes in place among posting lines", () => {
    expect(file.diagnostics).toEqual([]);
    const [first] = lunch?.postings ?? [];
    expect(first?.lines.map((l) => l.kind)).toEqual(["breakdown", "note", "breakdown"]);
  });

  it("is edited by copying, reusing unchanged objects", () => {
    const [first, second] = lunch?.postings ?? [];
    if (!lunch || !first || !second) throw new Error("fixture");
    const edited: TransactionData = { ...lunch, postings: [first, { ...second, cleared: true }] };
    const next: ModuleData = { ...file, items: [edited] };

    expect(next.items[0]).not.toBe(lunch);
    expect(edited.postings[0]).toBe(first);
    expect(lunch.postings[1]?.cleared).toBe(false);
  });

  it("is read-only", () => {
    expectTypeOf<PostingData["lines"]>().toExtend<readonly unknown[]>();
    // Only compiled, never called: the assignment must not type-check.
    const mutate = (t: TransactionData): void => {
      // @ts-expect-error Raw nodes are immutable
      t.mark = "!";
    };
    expectTypeOf(mutate).toBeFunction();
  });
});
