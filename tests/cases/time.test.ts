// docs/core/time.md
import { describe, expect, it } from "vitest";
import { balance, check, query, reconcile } from "../../srcs/index.js";
import { balanceOf, codes, descriptions, ledger, rows, SHARED } from "./ledger.js";

const pnl = (h: ReturnType<typeof ledger>, period: string): string[] =>
  rows(balance(h, query(h).axis("accounting").within(period).accounts("Income", "Expenses")));

const LUNCH = (time: string): string =>
  `${time} * "Lunch"\n    Expenses:Food  180 NTD\n    Assets:Cash  -180 NTD\n`;

const at = (time: string): ReturnType<typeof ledger> => ledger(LUNCH(time));

describe("time values", () => {
  it.each([
    ["2026", "year", "2026-01-01", "2026-12-31"],
    ["2026-10", "month", "2026-10-01", "2026-10-31"],
    ["2026-W05", "week", "2026-01-26", "2026-02-01"],
    ["2026-10-12", "day", "2026-10-12", "2026-10-12"],
    ["2026-10-12T09:30", "time", "2026-10-12", "2026-10-12"],
    ["2026-10-10..2026-10-13", "day", "2026-10-10", "2026-10-13"],
    ["2026-10-12T09:00..2026-10-13", "time", "2026-10-12", "2026-10-13"],
  ])("reads %s as precision %s", (written, precision, localDate, localEnd) => {
    const h = ledger(`2026-10-12=${written} * "Note"\n`);
    expect(codes(h)).toEqual([]);
    const accounting = h.transactions[0]?.accounting;
    expect(accounting).toMatchObject({ literal: written, precision, localDate, localEnd });
    expect(accounting).not.toHaveProperty("exact");
  });
  it("reads a time of day as a point", () => {
    const time = at("2026-10-12T09:30").transactions[0]?.effective;
    expect(time).toMatchObject({ start: "2026-10-12T01:30Z", end: "2026-10-12T01:30Z" });
  });
  it.each([
    ["2026-10-12T09:30:15"],
    ["2026-02-30"],
    ["2026-13"],
    ["2026-10-12T25:00"],
    ["2026-W00"],
    ["2026-W54"],
    ["2026-10-12[Mars/Base]"],
    ["2026-10-14..2026-10-12"],
  ])("rejects %s in a ledger", (written) => {
    const h = at(written);
    expect(codes(h)).toEqual(["parse.invalid-time"]);
    expect(h.transactions).toEqual([]);
  });
  it("drops the whole transaction for an error in a posting's time", () => {
    const h = ledger(`
2026-10-12 * "Transfer"
    Bank:Checking  -100 NTD [2026-02-30]
    Assets:Cash     100 NTD
`);
    expect(codes(h)).toEqual(["parse.invalid-time"]);
    expect(h.transactions).toEqual([]);
  });
});

describe("examples of time values", () => {
  const noTimezone = SHARED.replace("option timezone Asia/Taipei\n", "");

  it.each([
    ["2026-10-12", "2026-10-12", "2026-10-11T16:00Z", "2026-10-12T16:00Z"],
    ["2026-10", "2026-10-01", "2026-09-30T16:00Z", "2026-10-31T16:00Z"],
    ["2026-10-21T00:30[Asia/Tokyo]", "2026-10-21", "2026-10-20T15:30Z", "2026-10-20T15:30Z"],
  ])("Asia/Taipei: %s", (written, localDate, start, end) => {
    const h = ledger(`${written} * "Note"\n`);
    expect(codes(h)).toEqual([]);
    expect(h.transactions[0]?.effective).toMatchObject({ localDate, start, end });
  });
  it("no time zone at all", () => {
    const h = ledger(LUNCH("2026-10-12"), { prelude: noTimezone });
    expect(codes(h)).toEqual(["option.missing-timezone"]);
    expect(h.transactions[0]?.effective).toMatchObject({
      localDate: "2026-10-12",
      timezone: "UTC",
      start: "2026-10-12T00:00Z",
      end: "2026-10-13T00:00Z",
    });
  });
  it("Asia/Tokyo given when creating the ledger", () => {
    const h = ledger(LUNCH("2026-10-12"), { prelude: noTimezone, timezone: "Asia/Tokyo" });
    expect(codes(h)).toEqual([]);
    expect(h.transactions[0]?.effective).toMatchObject({
      localDate: "2026-10-12",
      start: "2026-10-11T15:00Z",
      end: "2026-10-12T15:00Z",
    });
  });
  it("the ledger's setting wins over the option", () => {
    const h = ledger(LUNCH("2026-10-12"), { timezone: "Asia/Tokyo" });
    expect(codes(h)).toEqual([]);
    expect(h.transactions[0]?.effective.start).toBe("2026-10-11T16:00Z");
  });
});

describe("prepaid across periods", () => {
  const h = ledger(`
2026-11-30=2026-12 * "Prepaid December rent"
    Expenses:Housing     15000 NTD
    Bank:Checking       -15000 NTD [2026-12-02]
`);
  it("books by accounting time and moves the bank by its own date", () => {
    expect(codes(h)).toEqual([]);
    expect(pnl(h, "2026-12")).toEqual(["Expenses:Housing 15000 NTD"]);
    expect(pnl(h, "2026-11")).toEqual([]);
    expect(balanceOf(h, "Bank:Checking", "2026-12-01")).toBe("0");
    expect(balanceOf(h, "Bank:Checking", "2026-12-02")).toBe("-15000");
    expect(balanceOf(h, "Expenses:Housing", "2026-11-30")).toBe("15000");
  });
});

describe("across time zones", () => {
  const h = ledger(`
2026-10-21T00:30[Asia/Tokyo] * "Ramen"
    Expenses:Food     1200 JPY
    Assets:Cash      -1200 JPY
`);
  it("keeps the written time", () => {
    expect(codes(h)).toEqual([]);
    expect(h.transactions[0]?.effective).toEqual({
      literal: "2026-10-21T00:30[Asia/Tokyo]",
      precision: "time",
      timezone: "Asia/Tokyo",
      localDate: "2026-10-21",
      localEnd: "2026-10-21",
      start: "2026-10-20T15:30Z",
      end: "2026-10-20T15:30Z",
    });
  });
  it("compares dates by the record's own local date", () => {
    expect(descriptions(query(h).accounts("Expenses:Food").within("2026-10-21"))).toEqual([
      "Ramen",
    ]);
    expect(descriptions(query(h).accounts("Expenses:Food").within("2026-10-20"))).toEqual([]);
    expect(descriptions(query(h).accounts("Expenses:Food").overlaps("2026-10-20"))).toEqual([]);
    expect(balanceOf(h, "Assets:Cash", "2026-10-20", "JPY")).toBe("0");
    expect(balanceOf(h, "Assets:Cash", "2026-10-21", "JPY")).toBe("-1200");
    expect(balanceOf(h, "Assets:Cash", "2026-10-21", "NTD")).toBe("0");
  });
});

describe("an accounting time that is an interval", () => {
  const h = ledger(`
2026-07-01=2026-07..2027-06 * "Yearly insurance premium"
    Expenses:Insurance     12000 NTD
    Bank:Checking         -12000 NTD
`);
  const insurance = () => query(h).axis("accounting").accounts("Expenses:Insurance");

  it("spans several months", () => {
    expect(codes(h)).toEqual([]);
    expect(descriptions(insurance().overlaps("2026-10"))).toEqual(["Yearly insurance premium"]);
    expect(descriptions(insurance().within("2026-10"))).toEqual([]);
    expect(descriptions(insurance().within("2026-07..2027-06"))).toEqual([
      "Yearly insurance premium",
    ]);
    // A period report shows the whole record in every period it overlaps, unlike within in a query.
    expect(pnl(h, "2026-10")).toEqual(["Expenses:Insurance 12000 NTD"]);
    expect(pnl(h, "2026-11")).toEqual(["Expenses:Insurance 12000 NTD"]);
    expect(balanceOf(h, "Bank:Checking", "2026-07-01")).toBe("-12000");
  });
  it("counts in until only once it has ended", () => {
    expect(descriptions(insurance().until("2026-12-31"))).toEqual([]);
    expect(descriptions(insurance().until("2027-06-29"))).toEqual([]);
    expect(descriptions(insurance().until("2027-06-30"))).toEqual(["Yearly insurance premium"]);
    expect(descriptions(insurance().until("2027-06"))).toEqual(["Yearly insurance premium"]);
  });
  it("exactly one month", () => {
    const h = ledger(`
2026-11-28=2026-12-01..2026-12-31 * "December building fee"
    Expenses:Housing     2000 NTD
    Bank:Checking       -2000 NTD
`);
    expect(codes(h)).toEqual([]);
    expect(pnl(h, "2026-12")).toEqual(["Expenses:Housing 2000 NTD"]);
    expect(pnl(h, "2026-11")).toEqual([]);
    expect(
      descriptions(query(h).axis("accounting").accounts("Expenses:Housing").overlaps("2026-11")),
    ).toEqual([]);
  });
});

describe("a posting's effective time", () => {
  it("rejects a month inherited from the transaction", () => {
    const h = ledger(`
2026-10 * "October building fee"
    Expenses:Housing     2000 NTD
    Bank:Checking       -2000 NTD
`);
    expect(codes(h)).toEqual(["posting.invalid-effective"]);
    expect(h.transactions).toEqual([]);
  });
  it("accepts the month as the accounting time", () => {
    const h = ledger(`
2026-10-01=2026-10 * "October building fee"
    Expenses:Housing     2000 NTD
    Bank:Checking       -2000 NTD
`);
    expect(codes(h)).toEqual([]);
    expect(descriptions(h.transactions)).toEqual(["October building fee"]);
    expect(pnl(h, "2026-10")).toEqual(["Expenses:Housing 2000 NTD"]);
  });
  it.each([["2026-10-10..2026-10-12"], ["2026-10-12T09:00..2026-10-12T10:00"], ["2026-10"]])(
    "rejects [%s] written on a posting",
    (written) => {
      const h = ledger(`
2026-10-12 * "Transfer"
    Bank:Checking  -100 NTD [${written}]
    Assets:Cash     100 NTD
`);
      expect(codes(h)).toEqual(["posting.invalid-effective"]);
      expect(h.transactions).toEqual([]);
    },
  );
  it.each([["2026-W42"], ["2026"], ["2026-10-12T09:00..2026-10-12T10:00"]])(
    "rejects %s inherited by a posting",
    (written) => {
      const h = ledger(`
${written} * "Transfer"
    Bank:Checking  -100 NTD
    Assets:Cash     100 NTD
`);
      expect(codes(h)).toEqual(["posting.invalid-effective"]);
      expect(h.transactions).toEqual([]);
    },
  );
  it("lets a period's postings each write their own time", () => {
    const h = ledger(`
2026-10 * "Transfer"
    Bank:Checking  -100 NTD [2026-10-05]
    Assets:Cash     100 NTD [2026-10-06T09:00]
`);
    expect(codes(h)).toEqual([]);
    expect(balanceOf(h, "Bank:Checking", "2026-10-05")).toBe("-100");
    expect(balanceOf(h, "Assets:Cash", "2026-10-05")).toBe("0");
    expect(balanceOf(h, "Assets:Cash", "2026-10-06")).toBe("100");
  });
  it("lets a transaction without postings have any effective time", () => {
    const h = ledger(`2026-10 * "October review"\n`);
    expect(codes(h)).toEqual([]);
    expect(descriptions(h.transactions)).toEqual(["October review"]);
  });
});

describe("daylight saving time", () => {
  const NEW_YORK = `
2026-03-07T12:00[America/New_York] * "Lunch in New York"
    Expenses:Food       20 USD
    Bank:USDAccount    -20 USD

2026-03-09T12:00[America/New_York] * "Lunch in New York"
    Expenses:Food       20 USD
    Bank:USDAccount    -20 USD
`;
  it("converts with the offset of each date", () => {
    const h = ledger(NEW_YORK);
    expect(codes(h)).toEqual([]);
    expect(h.transactions.map((t) => t.effective.start)).toEqual([
      "2026-03-07T17:00Z",
      "2026-03-09T16:00Z",
    ]);
    expect(
      query(h)
        .accounts("Expenses:Food")
        .within("2026-03-09")
        .postings()
        .map((p) => p.effective.localDate),
    ).toEqual(["2026-03-09"]);
  });
  it("rejects missing and repeated local times", () => {
    const h = ledger(`${NEW_YORK}
2026-03-08T02:30[America/New_York] * "A skipped time"
    Expenses:Food       20 USD
    Bank:USDAccount    -20 USD

2026-11-01T01:30[America/New_York] * "A repeated time"
    Expenses:Food       20 USD
    Bank:USDAccount    -20 USD
`);
    expect(codes(h)).toEqual(["time.nonexistent-local-time", "time.ambiguous-local-time"]);
    expect(balanceOf(h, "Bank:USDAccount", "2026-12-31", "USD")).toBe("-40");
  });
  it("never affects dates", () => {
    const h = at("2026-03-08[America/New_York]");
    expect(codes(h)).toEqual([]);
    expect(h.transactions[0]?.effective).toMatchObject({
      start: "2026-03-08T05:00Z",
      end: "2026-03-09T04:00Z",
    });
  });
});

describe("weeks and the first day of the week", () => {
  const WEEKS = [
    "2025-12-27 A 100",
    "2025-12-28 B 200",
    "2026-01-03 C 300",
    "2026-01-04 D 400",
    "2026-12-28 E 500",
  ]
    .map((line) => {
      const [date, name, amount] = line.split(" ");
      return `${String(date)} * "${String(name)}"\n    Expenses:Other  ${String(amount)} NTD\n    Assets:Cash  -${String(amount)} NTD\n`;
    })
    .join("\n");
  const week = (h: ReturnType<typeof ledger>, label: string) =>
    descriptions(query(h).within(label));

  it("starts on Sunday", () => {
    const h = ledger(`option week-start sunday\n${WEEKS}`);
    expect(week(h, "2026-W01")).toEqual(["B", "C"]);
    expect(week(h, "2025-W52")).toEqual(["A"]);
    expect(week(h, "2027-W01")).toEqual(["E"]);
  });
  it("starts on Monday by default", () => {
    const h = ledger(WEEKS);
    expect(week(h, "2026-W01")).toEqual(["C", "D"]);
    expect(week(h, "2025-W52")).toEqual(["A", "B"]);
    expect(week(h, "2027-W01")).toEqual(["E"]);
  });
  it("2026 has no week 53", () => {
    const h = ledger(
      `${WEEKS}\n2026-12-30=2026-W53 * "F"\n    Expenses:Other  1 NTD\n    Assets:Cash  -1 NTD\n`,
    );
    expect(codes(h)).toEqual(["time.nonexistent-week"]);
    expect(descriptions(h.transactions)).not.toContain("F");
  });
});

describe("time predicates", () => {
  const h = ledger(`
2026-10-12T10:00 * "Coffee"
    Expenses:Food     100 NTD
    Assets:Cash      -100 NTD

2026-10-12T18:00=2026-10-12T09:00..2026-10-12T18:00 * "Shift meal allowance"
    Assets:Cash        200 NTD
    Income:Allowance  -200 NTD
`);
  const q = () => query(h).axis("accounting");
  const found = (ts: ReturnType<typeof q>) => descriptions(ts).sort();

  it("loads both", () => {
    expect(codes(h)).toEqual([]);
    expect(
      h.transactions.find((t) => t.description === "Shift meal allowance")?.accounting,
    ).toMatchObject({
      localDate: "2026-10-12",
      localEnd: "2026-10-12",
    });
  });
  it("finds a point and an interval within and overlapping their day", () => {
    expect(found(q().within("2026-10-12"))).toEqual(["Coffee", "Shift meal allowance"]);
    expect(found(q().overlaps("2026-10-12"))).toEqual(["Coffee", "Shift meal allowance"]);
    expect(found(q().within("2026-10-11"))).toEqual([]);
    expect(found(q().overlaps("2026-10-13"))).toEqual([]);
  });
  it("compares local dates for covers, so a point never covers", () => {
    expect(found(q().covers("2026-10-12"))).toEqual(["Shift meal allowance"]);
    expect(found(q().covers("2026-10"))).toEqual([]);
  });
  it("counts both until their day", () => {
    expect(found(q().until("2026-10-12"))).toEqual(["Coffee", "Shift meal allowance"]);
    expect(found(q().until("2026-10-11"))).toEqual([]);
  });
});

describe("times given to the API", () => {
  const h = at("2026-10-12");
  it.each([
    ["2026-13", "parse.invalid-time"],
    ["2026-02-30", "parse.invalid-time"],
    ["2026-10-12T25:00", "parse.invalid-time"],
    ["2026-10-12T09:30:15", "parse.invalid-time"],
    ["2026-10-12[Mars/Base]", "parse.invalid-time"],
    ["2026-W53", "time.nonexistent-week"],
    ["2026-10-12+08:00", "parse.invalid-time"],
  ])("rejects %s", (text, code) => {
    expect(() => query(h).within(text)).toThrow(code);
    expect(() => reconcile(h, { account: "Assets:Cash", at: text })).toThrow(code);
  });
  it.each([
    ["2026-10-12T09:00"],
    ["2026-10-12T09:00..2026-10-12T10:00"],
    ["2026-10-12T09:00..2026-10-13"],
    ["2026-10-11..2026-10-12T10:00"],
    ["2026-10-12T09:00+08:00"],
    ["2026-11-01T01:30-04:00[America/New_York]"],
  ])("rejects the time of day in %s", (text) => {
    expect(() => query(h).within(text)).toThrow("query.time-of-day");
    expect(() => query(h).overlaps(text)).toThrow("query.time-of-day");
    expect(() => query(h).covers(text)).toThrow("query.time-of-day");
    expect(() => query(h).until(text)).toThrow("query.time-of-day");
    expect(() => reconcile(h, { account: "Assets:Cash", at: text })).toThrow("query.time-of-day");
  });
  it("reads text before checking its time of day", () => {
    const text = "2026-03-08T02:30[America/New_York]";
    expect(() => query(h).within(text)).toThrow("time.nonexistent-local-time");
    expect(() => query(h).within(text)).not.toThrow("query.time-of-day");
  });
  it("never reports a rejected time in check", () => {
    const h2 = at("2026-10-12");
    expect(() => query(h2).within("2026-13")).toThrow("parse.invalid-time");
    expect(() => query(h2).within("2026-10-12T09:00")).toThrow("query.time-of-day");
    expect(() => query(h2).within("2026-W53")).toThrow("time.nonexistent-week");
    expect(codes(h2, true)).toEqual([]);
  });
  it("tells a zone name with T and a digit from a time of day", () => {
    expect(() => query(h).within("2026-10-12[Etc/GMT0]")).not.toThrow();
    expect(() => query(h).within("2026-10-12T09:00[Etc/GMT0]")).toThrow("query.time-of-day");
  });
  it("rejects a time value with a time of day", () => {
    const coffee = at("2026-10-12T10:00").transactions[0]?.effective;
    expect(coffee).toBeDefined();
    if (coffee) expect(() => query(h).within(coffee)).toThrow("query.time-of-day");
  });
  it("accepts a time value without one", () => {
    const day = h.transactions[0]?.effective;
    expect(day).toBeDefined();
    if (day) expect(descriptions(query(h).within(day))).toEqual(["Lunch"]);
  });
  it("never reports query.time-of-day for a ledger", () => {
    expect(codes(at("2026-10-12T09:00"), true)).not.toContain("query.time-of-day");
  });
  it("reads text with the ledger's time zone", () => {
    expect(query(h).until("2026-10-12").postings()).toHaveLength(2);
    expect(query(h).until("2026-10-11").postings()).toHaveLength(0);
  });
});

describe("a UTC offset picks a repeated local time", () => {
  const start = (h: ReturnType<typeof ledger>): string | undefined =>
    h.transactions[0]?.effective.start;

  it("chooses the moment with that offset", () => {
    expect(start(at("2026-11-01T01:30-04:00[America/New_York]"))).toBe("2026-11-01T05:30Z");
    expect(start(at("2026-11-01T01:30-05:00[America/New_York]"))).toBe("2026-11-01T06:30Z");
    expect(start(at("2026-10-12T09:00+08:00"))).toBe("2026-10-12T01:00Z");
  });
  it("never changes the zone", () => {
    expect(at("2026-10-12T09:00+08:00").transactions[0]?.effective.timezone).toBe("Asia/Taipei");
  });
  it("is ambiguous without one", () => {
    const h = at("2026-11-01T01:30[America/New_York]");
    expect(codes(h)).toEqual(["time.ambiguous-local-time"]);
    expect(check(h)[0]?.message).toContain("-04:00 or -05:00");
  });
  it("rejects an offset the zone does not have then", () => {
    for (const time of ["2026-11-01T01:30-03:00[America/New_York]", "2026-10-12T09:00+09:00"]) {
      const h = at(time);
      expect(codes(h)).toEqual(["time.offset-mismatch"]);
      expect(h.transactions).toEqual([]);
    }
    expect(codes(at("2026-10-12T09:00+24:00"))).toEqual(["parse.invalid-time"]);
    expect(codes(at("2026-10-12+08:00"))).toEqual(["parse.invalid-time"]);
  });
});
