// docs/core/entities.md
import { describe, expect, it } from "vitest";
import { balance, check, query } from "../../srcs/index.js";
import { codes, descriptions, ledger } from "./ledger.js";

const SALARY = `
2026-10-05 * "October salary" @acme
    Bank:Checking              52000 NTD
    Expenses:HealthInsurance    1500 NTD
    Expenses:IncomeTax          1500 NTD
    Income:Salary             -55000 NTD
`;

describe("entities and references", () => {
  const h = ledger(`
entity KEN
    display-name Ken Chen
${SALARY}`);

  it("checks out", () => {
    expect(codes(h, true)).toEqual([]);
  });
  it("lists declared entities first, then those used without a declaration", () => {
    expect(h.entities.map((e) => e.id)).toEqual(["KEN", "acme"]);
    const [ken, acme] = h.entities;
    expect(ken?.displayName).toBe("Ken Chen");
    expect(ken?.span).toBeDefined();
    expect(ken?.meta).toEqual({});
    expect(acme).toEqual({ id: "acme", meta: {} });
  });
  it("filters by the transaction's references when the postings have none", () => {
    expect(descriptions(query(h).entities("acme"))).toEqual(["October salary"]);
    const postings = query(h).entities("acme").postings();
    expect(postings).toHaveLength(4);
    for (const p of postings) expect(p.refs).toEqual([]);
  });
  it("keeps the reference with the default role", () => {
    expect(h.transactions[0]?.refs).toEqual([{ role: "person", entity: "acme" }]);
  });
  it("never changes balances", () => {
    expect(query(h).entities("KEN").postings()).toEqual([]);
    const plain = ledger(SALARY.replace(" @acme", ""));
    expect(balance(h)).toEqual(balance(plain));
  });
});

describe("strict mode for entities", () => {
  it("reports an undeclared entity and computes as in normal mode", () => {
    const h = ledger(`option strict entity\n${SALARY}`);
    expect(codes(h)).toEqual(["strict.undeclared"]);
    expect(check(h)[0]?.message).toContain("acme");
    expect(h.entities.map((e) => e.id)).toEqual(["acme"]);
    expect(query(h).entities("acme").postings()).toHaveLength(4);
  });
  it("reports an undeclared entity on a posting", () => {
    const h = ledger(`option strict entity

entity acme

2026-10-13 * "Dinner" @acme
    Expenses:Food     300 NTD  @AMY
    Assets:Cash      -300 NTD
`);
    expect(codes(h)).toEqual(["strict.undeclared"]);
    expect(check(h)[0]?.message).toContain("AMY");
  });
  it("accepts a declared entity", () => {
    expect(codes(ledger(`option strict entity\n\nentity acme\n${SALARY}`))).toEqual([]);
  });
});

describe("entity declarations", () => {
  it("keeps the display name and the metadata", () => {
    const h = ledger(`
entity NAT
    display-name Nat Chen
    ;; phone: 0912
`);
    expect(codes(h)).toEqual([]);
    expect(h.entities).toHaveLength(1);
    expect(h.entities[0]?.id).toBe("NAT");
    expect(h.entities[0]?.displayName).toBe("Nat Chen");
    expect(h.entities[0]?.meta).toEqual({ phone: "0912" });
  });
  it("leaves out the display name when none is declared", () => {
    const h = ledger(`entity NAT\n`);
    expect(h.entities[0]).not.toHaveProperty("displayName");
  });
  it("never identifies anything by the display name", () => {
    const h = ledger(`
entity NAT
    display-name Nat Chen

2026-10-13 * "Dinner" @NAT
    Expenses:Food     300 NTD
    Assets:Cash      -300 NTD
`);
    expect(codes(h)).toEqual([]);
    expect(query(h).entities("Nat Chen").postings()).toEqual([]);
    expect(query(h).entities("NAT").postings()).toHaveLength(2);
    expect(h.transactions[0]?.refs).toEqual([{ role: "person", entity: "NAT" }]);
  });
  it("type is reserved, and the declaration is not loaded", () => {
    const h = ledger(`entity NAT\n    type person\n`);
    expect(codes(h)).toEqual(["syntax.unsupported"]);
    expect(h.entities).toEqual([]);
  });
});

describe("references and roles", () => {
  it("an unknown role skips the reference; the transaction loads", () => {
    const h = ledger(`
2026-10-13 * "Dinner" @payee:xx_breakfast
    Expenses:Food     300 NTD
    Assets:Cash      -300 NTD
`);
    expect(codes(h)).toEqual(["name.unknown-role"]);
    expect(check(h)[0]?.severity).toBe("error");
    expect(h.transactions).toHaveLength(1);
    expect(h.transactions[0]?.refs).toEqual([]);
    expect(h.transactions[0]?.origin?.refs).toEqual(["payee:xx_breakfast"]);
    expect(h.entities).toEqual([]);
  });
  it("an unknown role on a posting is skipped as well", () => {
    const h = ledger(`
2026-10-13 * "Dinner" @NAT
    Expenses:Food     300 NTD  @payer:KEN @AMY
    Assets:Cash      -300 NTD
`);
    expect(codes(h)).toEqual(["name.unknown-role"]);
    expect(h.transactions[0]?.postings[0]?.refs).toEqual([{ role: "person", entity: "AMY" }]);
  });
  it("@person:x is the same as @x", () => {
    const h = ledger(`
2026-10-13 * "Dinner" @person:NAT
    Expenses:Food     300 NTD
    Assets:Cash      -300 NTD
`);
    expect(codes(h)).toEqual([]);
    expect(h.transactions[0]?.refs).toEqual([{ role: "person", entity: "NAT" }]);
  });
});
