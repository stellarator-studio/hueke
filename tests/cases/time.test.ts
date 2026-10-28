// docs/core/time.md
import { describe, expect, it } from "vitest";
import { check, query } from "../../srcs/index.js";
import { codes, ledger, SHARED } from "./ledger.js";

const at = (time: string): ReturnType<typeof ledger> =>
  ledger(`${time} * "Taxi"\n    Expenses:Food  20 NTD\n    Assets:Cash  -20 NTD\n`);

const descriptions = (q: Iterable<{ description?: string }>): string[] =>
  [...q].map((t) => t.description ?? "");

describe("time values", () => {
  it.each([
    ["2026", "year", "2026-01-01", "2026-12-31"],
    ["2026-10", "month", "2026-10-01", "2026-10-31"],
    ["2026-10-12", "day", "2026-10-12", "2026-10-12"],
    ["2026-10-12T09:30", "time", "2026-10-12", "2026-10-12"],
    ["2026-10-10..2026-10-13", "day", "2026-10-10", "2026-10-13"],
    ["2026-10-12T09:00..2026-10-13", "time", "2026-10-12", "2026-10-13"],
  ])("reads %s as precision %s", (written, precision, localDate, localEnd) => {
    const h = ledger(`${written} * "Note"\n`);
    expect(codes(h)).toEqual([]);
    const time = h.transactions[0]?.time;
    expect(time).toMatchObject({ literal: written, precision, localDate, localEnd });
    expect(time).not.toHaveProperty("exact");
  });
  it("reads a time of day as a point, to the minute in UTC", () => {
    expect(at("2026-10-12T09:30").transactions[0]?.time).toMatchObject({
      start: "2026-10-12T01:30Z",
      end: "2026-10-12T01:30Z",
    });
  });
  it.each([["2026-10-12T09:30:15"], ["2026-10-12T09:30:00"], ["2026-10-12T09:30:15+08:00"]])(
    "rejects the seconds in %s",
    (written) => {
      const h = at(written);
      expect(codes(h)).toEqual(["parse.invalid-time"]);
      expect(h.transactions).toEqual([]);
    },
  );
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
    expect(h.transactions[0]?.time).toMatchObject({ localDate, start, end });
  });
  it("no time zone at all", () => {
    const h = ledger(`2026-10-12 * "Note"\n`, { prelude: noTimezone });
    expect(codes(h)).toEqual(["option.missing-timezone"]);
    expect(h.transactions[0]?.time).toMatchObject({
      localDate: "2026-10-12",
      timezone: "UTC",
      start: "2026-10-12T00:00Z",
      end: "2026-10-13T00:00Z",
    });
  });
  it("Asia/Tokyo given when creating the ledger", () => {
    const h = ledger(`2026-10-12 * "Note"\n`, { prelude: noTimezone, timezone: "Asia/Tokyo" });
    expect(codes(h)).toEqual([]);
    expect(h.transactions[0]?.time).toMatchObject({
      start: "2026-10-11T15:00Z",
      end: "2026-10-12T15:00Z",
    });
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
    expect(h.transactions[0]?.time).toEqual({
      literal: "2026-10-21T00:30[Asia/Tokyo]",
      precision: "time",
      timezone: "Asia/Tokyo",
      localDate: "2026-10-21",
      localEnd: "2026-10-21",
      start: "2026-10-20T15:30Z",
      end: "2026-10-20T15:30Z",
    });
  });
  it("compares the record's own local date", () => {
    expect(descriptions(query(h).within("2026-10-21"))).toEqual(["Ramen"]);
    expect(descriptions(query(h).within("2026-10-20"))).toEqual([]);
    expect(descriptions(query(h).until("2026-10-20"))).toEqual([]);
    expect(descriptions(query(h).until("2026-10-21"))).toEqual(["Ramen"]);
  });
});

describe("daylight saving time", () => {
  it("converts with the offset of each date", () => {
    const h = ledger(`
2026-03-07T12:00[America/New_York] * "Lunch in New York"
    Expenses:Food       20 USD
    Bank:USDAccount    -20 USD

2026-03-09T12:00[America/New_York] * "Lunch in New York"
    Expenses:Food       20 USD
    Bank:USDAccount    -20 USD
`);
    expect(codes(h)).toEqual([]);
    expect(h.transactions.map((t) => t.time.start)).toEqual([
      "2026-03-07T17:00Z",
      "2026-03-09T16:00Z",
    ]);
  });
  it("never affects dates", () => {
    const h = at("2026-03-08[America/New_York]");
    expect(codes(h)).toEqual([]);
    expect(h.transactions[0]?.time).toMatchObject({
      start: "2026-03-08T05:00Z",
      end: "2026-03-09T04:00Z",
    });
  });
});

describe("times given to the API", () => {
  const h = at("2026-10-12");
  it("rejects seconds as an invalid time", () => {
    expect(() => query(h).within("2026-10-12T09:30:15")).toThrow("parse.invalid-time");
    expect(() => query(h).until("2026-10-12T09:30:15")).toThrow("parse.invalid-time");
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
    expect(() => query(h).until(text)).toThrow("query.time-of-day");
  });
  it("tells a zone name with T and a digit from a time of day", () => {
    expect(() => query(h).within("2026-10-12[Etc/GMT0]")).not.toThrow();
    expect(() => query(h).within("2026-10-12T09:00[Etc/GMT0]")).toThrow("query.time-of-day");
  });
  it("rejects a time value with a time of day", () => {
    const coffee = at("2026-10-12T10:00").transactions[0]?.time;
    expect(coffee).toBeDefined();
    if (coffee) {
      expect(() => query(h).within(coffee)).toThrow("query.time-of-day");
      expect(() => query(h).until(coffee)).toThrow("query.time-of-day");
    }
  });
  it("accepts a time value without one", () => {
    const day = h.transactions[0]?.time;
    expect(day).toBeDefined();
    if (day) expect(descriptions(query(h).within(day))).toEqual(["Taxi"]);
  });
  it("never reports query.time-of-day for a ledger", () => {
    expect(codes(at("2026-10-12T09:00"), true)).not.toContain("query.time-of-day");
  });
});

describe("a UTC offset picks a repeated local time", () => {
  const start = (h: ReturnType<typeof ledger>): string | undefined => h.transactions[0]?.time.start;

  it("chooses the moment with that offset", () => {
    expect(start(at("2026-11-01T01:30-04:00[America/New_York]"))).toBe("2026-11-01T05:30Z");
    expect(start(at("2026-11-01T01:30-05:00[America/New_York]"))).toBe("2026-11-01T06:30Z");
    expect(start(at("2026-10-12T09:00+08:00"))).toBe("2026-10-12T01:00Z");
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
