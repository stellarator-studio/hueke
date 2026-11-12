import { Temporal } from "temporal-polyfill";
import { describe, expect, it, vi } from "vitest";
import { parseTime, TimeError, type TimeContext } from "../../../srcs/data/time/time.js";

const UTC: TimeContext = { timezone: "UTC", weekStart: "monday" };
const TAIPEI: TimeContext = { timezone: "Asia/Taipei", weekStart: "monday" };
const NEW_YORK: TimeContext = { timezone: "America/New_York", weekStart: "monday" };

/** The code and message of the error reading `text` throws, or undefined when it is read. */
function failure(text: string, context: TimeContext): [string, string] | undefined {
  try {
    parseTime(text, context);
  } catch (e) {
    if (e instanceof TimeError) return [e.code, e.message];
    throw e;
  }
  return undefined;
}

/** Reads `texts` in order with times not read before in this module, each as a result or a code. */
async function readFresh(
  texts: readonly string[],
  context: TimeContext,
): Promise<Record<string, unknown>> {
  vi.resetModules();
  const fresh = await import("../../../srcs/data/time/time.js");
  const out: Record<string, unknown> = {};
  for (const text of texts) {
    try {
      out[text] = fresh.parseTime(text, context);
    } catch (e) {
      if (!(e instanceof fresh.TimeError)) throw e;
      out[text] = e.code;
    }
  }
  return out;
}

/** Where a time value starts and ends, and the local dates it covers. */
const span = (text: string, context: TimeContext) => {
  const { start, end, localDate, localEnd } = parseTime(text, context);
  return { start, end, localDate, localEnd };
};

describe("reading the same text again", () => {
  it.each([
    ["2026", TAIPEI],
    ["2026-10", TAIPEI],
    ["2026-W05", TAIPEI],
    ["2026-10-12", TAIPEI],
    ["2026-10-12T09:30", TAIPEI],
    ["2026-10-12T09:30+08:00", TAIPEI],
    ["2026-10-10..2026-10-13", TAIPEI],
    ["2026-03-08T01:30", NEW_YORK],
    ["2026-11-01T01:30-05:00", NEW_YORK],
  ])("gives an equal value for %s", (text, context) => {
    const first = parseTime(text, context);
    expect(parseTime(text, context)).toEqual(first);
    expect(parseTime(text, context)).toEqual(first);
  });

  it.each([
    ["2026-13", TAIPEI, "parse.invalid-time"],
    ["2026-10-12[Mars/Base]", TAIPEI, "parse.invalid-time"],
    ["2026-10-14..2026-10-12", TAIPEI, "parse.invalid-time"],
    ["2026-W53", TAIPEI, "time.nonexistent-week"],
    ["2026-03-08T02:30", NEW_YORK, "time.nonexistent-local-time"],
    ["2026-11-01T01:30", NEW_YORK, "time.ambiguous-local-time"],
    ["2026-10-12T09:00+08:00[Asia/Tokyo]", TAIPEI, "time.offset-mismatch"],
    ["2026-03-08T01:30-04:00", NEW_YORK, "time.offset-mismatch"],
    ["2026-03-08T03:30-05:00", NEW_YORK, "time.offset-mismatch"],
    ["2026-11-01T01:30-03:00", NEW_YORK, "time.offset-mismatch"],
  ])("throws the same error for %s every time", (text, context, code) => {
    const first = failure(text, context);
    expect(first?.[0]).toBe(code);
    expect(failure(text, context)).toEqual(first);
    expect(failure(text, context)).toEqual(first);
  });

  it("gives a frozen value that an attempted change leaves as it was", () => {
    const first = parseTime("2026-10-12T09:30", TAIPEI);
    const copy = { ...first };
    expect(Object.isFrozen(first)).toBe(true);
    expect(() => {
      (first as { start: string }).start = "2000-01-01T00:00Z";
    }).toThrow(TypeError);
    const again = parseTime("2026-10-12T09:30", TAIPEI);
    expect(Object.isFrozen(again)).toBe(true);
    expect(again).toEqual(copy);
    expect(again.start).toBe("2026-10-12T01:30Z");
  });

  it("throws a TimeError each time, not only the first", () => {
    for (let n = 0; n < 3; n++)
      expect(() => parseTime("2026-03-08T02:30", NEW_YORK)).toThrow(TimeError);
  });

  it("reads the same text differently with another time zone", () => {
    expect(span("2026-10-12", TAIPEI)).toEqual({
      start: "2026-10-11T16:00Z",
      end: "2026-10-12T16:00Z",
      localDate: "2026-10-12",
      localEnd: "2026-10-12",
    });
    expect(span("2026-10-12", UTC)).toEqual({
      start: "2026-10-12T00:00Z",
      end: "2026-10-13T00:00Z",
      localDate: "2026-10-12",
      localEnd: "2026-10-12",
    });
    expect(parseTime("2026-10-12", UTC).timezone).toBe("UTC");
    expect(parseTime("2026-10-12", TAIPEI).timezone).toBe("Asia/Taipei");
    expect(span("2026-10-12", TAIPEI).start).toBe("2026-10-11T16:00Z");
  });

  it("reads the same week differently with another week start", () => {
    const sunday: TimeContext = { timezone: "UTC", weekStart: "sunday" };
    const monday = span("2026-W01", UTC);
    expect(monday).toEqual({
      start: "2025-12-29T00:00Z",
      end: "2026-01-05T00:00Z",
      localDate: "2025-12-29",
      localEnd: "2026-01-04",
    });
    expect(span("2026-W01", sunday)).toEqual({
      start: "2025-12-28T00:00Z",
      end: "2026-01-04T00:00Z",
      localDate: "2025-12-28",
      localEnd: "2026-01-03",
    });
    expect(span("2026-W01", UTC)).toEqual(monday);
  });

  it("reads a zone written in the text by that zone, whatever the context", () => {
    expect(span("2026-10-12[UTC]", TAIPEI)).toEqual(span("2026-10-12", UTC));
    expect(parseTime("2026-10-12[UTC]", TAIPEI).timezone).toBe("UTC");
  });
});

describe("times of day", () => {
  it("accepts a written offset that the zone has on a steady day", () => {
    expect(parseTime("2026-10-12T09:00+09:00[Asia/Tokyo]", TAIPEI).start).toBe("2026-10-12T00:00Z");
    expect(parseTime("2026-10-12T09:00+08:00", TAIPEI).start).toBe("2026-10-12T01:00Z");
    expect(parseTime("2026-07-01T09:00-04:00", NEW_YORK).start).toBe("2026-07-01T13:00Z");
  });

  it("is a point on its own local date", () => {
    expect(parseTime("2026-10-12T23:30", TAIPEI)).toMatchObject({
      precision: "time",
      start: "2026-10-12T15:30Z",
      end: "2026-10-12T15:30Z",
      localDate: "2026-10-12",
      localEnd: "2026-10-12",
    });
    expect(parseTime("2026-10-12T00:00", TAIPEI).start).toBe("2026-10-11T16:00Z");
  });

  it.each([
    ["2026-03-08T00:00", "2026-03-08T05:00Z"],
    ["2026-03-08T01:30", "2026-03-08T06:30Z"],
    ["2026-03-08T01:59", "2026-03-08T06:59Z"],
    ["2026-03-08T03:00", "2026-03-08T07:00Z"],
    ["2026-03-08T03:30", "2026-03-08T07:30Z"],
    ["2026-03-08T23:59", "2026-03-09T03:59Z"],
    ["2026-11-01T00:30", "2026-11-01T04:30Z"],
    ["2026-11-01T01:30-04:00", "2026-11-01T05:30Z"],
    ["2026-11-01T01:30-05:00", "2026-11-01T06:30Z"],
    ["2026-11-01T02:30", "2026-11-01T07:30Z"],
  ])("maps %s in New York, on a transition day, to %s", (text, instant) => {
    expect(parseTime(text, NEW_YORK).start).toBe(instant);
  });

  it("maps the days around a transition by their own offsets", () => {
    expect(parseTime("2026-03-07T12:00", NEW_YORK).start).toBe("2026-03-07T17:00Z");
    expect(parseTime("2026-03-09T12:00", NEW_YORK).start).toBe("2026-03-09T16:00Z");
    expect(parseTime("2026-10-31T12:00", NEW_YORK).start).toBe("2026-10-31T16:00Z");
    expect(parseTime("2026-11-02T12:00", NEW_YORK).start).toBe("2026-11-02T17:00Z");
  });

  it("gives what Temporal gives, also for zones without daylight saving", () => {
    const cases: [string, string][] = [
      ["2026-10-12T09:30", "Asia/Kolkata"],
      ["2026-10-12T09:30", "Asia/Kathmandu"],
      ["2026-10-12T09:30", "Australia/Lord_Howe"],
      ["2026-04-05T01:15", "Australia/Lord_Howe"],
      ["2026-10-04T03:00", "Australia/Lord_Howe"],
      ["2026-09-06T12:00", "America/Santiago"],
      ["2026-04-05T12:00", "America/Santiago"],
    ];
    for (const [text, timezone] of cases) {
      const expected = Temporal.PlainDateTime.from(text)
        .toZonedDateTime(timezone, { disambiguation: "reject" })
        .toInstant()
        .toString({ smallestUnit: "minute" });
      expect(parseTime(text, { timezone, weekStart: "monday" }).start, `${text} ${timezone}`).toBe(
        expected,
      );
    }
  });
});

describe("whole days, weeks, months and years", () => {
  it("a day in a zone whose midnight is skipped starts at its first moment", () => {
    // Chile moves its clocks forward at midnight: 2026-09-06 starts at 01:00, at -03:00.
    const santiago: TimeContext = { timezone: "America/Santiago", weekStart: "monday" };
    expect(span("2026-09-06", santiago)).toEqual({
      start: "2026-09-06T04:00Z",
      end: "2026-09-07T03:00Z",
      localDate: "2026-09-06",
      localEnd: "2026-09-06",
    });
    expect(span("2026-09-05", santiago)).toEqual({
      start: "2026-09-05T04:00Z",
      end: "2026-09-06T04:00Z",
      localDate: "2026-09-05",
      localEnd: "2026-09-05",
    });
  });

  it.each([
    ["2026-03-08", "day", "2026-03-08T05:00Z", "2026-03-09T04:00Z", "2026-03-08", "2026-03-08"],
    ["2026-11-01", "day", "2026-11-01T04:00Z", "2026-11-02T05:00Z", "2026-11-01", "2026-11-01"],
    ["2026-03", "month", "2026-03-01T05:00Z", "2026-04-01T04:00Z", "2026-03-01", "2026-03-31"],
    ["2026-11", "month", "2026-11-01T04:00Z", "2026-12-01T05:00Z", "2026-11-01", "2026-11-30"],
    ["2026", "year", "2026-01-01T05:00Z", "2027-01-01T05:00Z", "2026-01-01", "2026-12-31"],
    ["2026-W10", "week", "2026-03-02T05:00Z", "2026-03-09T04:00Z", "2026-03-02", "2026-03-08"],
  ])("%s in New York is a %s across its offsets", (text, precision, start, end, first, last) => {
    expect(parseTime(text, NEW_YORK)).toEqual({
      literal: text,
      precision,
      timezone: "America/New_York",
      localDate: first,
      localEnd: last,
      start,
      end,
    });
  });

  it.each([
    ["2028-02", "2028-02-01T00:00Z", "2028-03-01T00:00Z", "2028-02-01", "2028-02-29"],
    ["2026-02", "2026-02-01T00:00Z", "2026-03-01T00:00Z", "2026-02-01", "2026-02-28"],
    ["2000-02", "2000-02-01T00:00Z", "2000-03-01T00:00Z", "2000-02-01", "2000-02-29"],
    ["2100-02", "2100-02-01T00:00Z", "2100-03-01T00:00Z", "2100-02-01", "2100-02-28"],
    ["2028-02-29", "2028-02-29T00:00Z", "2028-03-01T00:00Z", "2028-02-29", "2028-02-29"],
  ])("February %s has its days", (text, start, end, localDate, localEnd) => {
    expect(span(text, UTC)).toEqual({ start, end, localDate, localEnd });
  });

  it.each([
    ["2026-12", "2026-11-30T16:00Z", "2026-12-31T16:00Z", "2026-12-01", "2026-12-31"],
    ["2026-12-31", "2026-12-30T16:00Z", "2026-12-31T16:00Z", "2026-12-31", "2026-12-31"],
    ["2026", "2025-12-31T16:00Z", "2026-12-31T16:00Z", "2026-01-01", "2026-12-31"],
    ["2027-W01", "2026-12-27T16:00Z", "2027-01-03T16:00Z", "2026-12-28", "2027-01-03"],
    ["2026-W52", "2026-12-20T16:00Z", "2026-12-27T16:00Z", "2026-12-21", "2026-12-27"],
    ["2026-12..2027-01", "2026-11-30T16:00Z", "2027-01-31T16:00Z", "2026-12-01", "2027-01-31"],
  ])("%s in Taipei ends in the next year where it should", (text, start, end, first, last) => {
    expect(span(text, TAIPEI)).toEqual({ start, end, localDate: first, localEnd: last });
  });

  it.each([
    ["0999", "0999-01-01T00:00Z", "1000-01-01T00:00Z", "0999-01-01", "0999-12-31"],
    ["0999-12", "0999-12-01T00:00Z", "1000-01-01T00:00Z", "0999-12-01", "0999-12-31"],
    ["0999-06-15", "0999-06-15T00:00Z", "0999-06-16T00:00Z", "0999-06-15", "0999-06-15"],
    ["0999-06-15T12:00", "0999-06-15T12:00Z", "0999-06-15T12:00Z", "0999-06-15", "0999-06-15"],
  ])("reads %s, before year 1000", (text, start, end, localDate, localEnd) => {
    expect(span(text, UTC)).toEqual({ start, end, localDate, localEnd });
  });
});

describe("a day whose midnight is skipped", () => {
  // Chile moves its clocks forward at midnight: 2026-09-06 has no 00:00 to 00:59.
  const santiago: TimeContext = { timezone: "America/Santiago", weekStart: "monday" };

  it.each([["2026-09-06T00:30"], ["2026-09-06T00:00"], ["2026-09-06T00:59"]])(
    "has no %s, however often it is read",
    (text) => {
      const first = failure(text, santiago);
      expect(first?.[0]).toBe("time.nonexistent-local-time");
      expect(failure(text, santiago)).toEqual(first);
      expect(failure(text, santiago)).toEqual(first);
    },
  );
  it.each([
    ["2026-09-06T01:00", "2026-09-06T04:00Z"],
    ["2026-09-06T01:30", "2026-09-06T04:30Z"],
    ["2026-09-06T23:30", "2026-09-07T02:30Z"],
    ["2026-09-05T23:30", "2026-09-06T03:30Z"],
    ["2026-09-05T00:30", "2026-09-05T04:30Z"],
  ])("maps %s to %s", (text, instant) => {
    expect(parseTime(text, santiago).start).toBe(instant);
    expect(parseTime(text, santiago).start).toBe(instant);
  });

  it("reads the same whether the day or its times are read first", async () => {
    const times = ["2026-09-06T00:30", "2026-09-06T00:00", "2026-09-06T01:30", "2026-09-05T23:30"];
    const days = ["2026-09-06", "2026-09-05", "2026-09"];
    const timesFirst = await readFresh([...times, ...days], santiago);
    const daysFirst = await readFresh([...days, ...times], santiago);
    expect(timesFirst).toEqual(daysFirst);
    expect(timesFirst["2026-09-06T00:30"]).toBe("time.nonexistent-local-time");
    expect(timesFirst["2026-09-06T00:00"]).toBe("time.nonexistent-local-time");
    expect(timesFirst["2026-09-06T01:30"]).toMatchObject({ start: "2026-09-06T04:30Z" });
    expect(timesFirst["2026-09-05T23:30"]).toMatchObject({ start: "2026-09-06T03:30Z" });
    expect(timesFirst["2026-09-06"]).toMatchObject({
      start: "2026-09-06T04:00Z",
      end: "2026-09-07T03:00Z",
    });
  });
});

describe("a date skipped whole", () => {
  // Crossing the date line westward skips a whole calendar date: Samoa went from
  // 2011-12-29 23:59 -10:00 straight to 2011-12-31 00:00 +14:00.
  it.each([
    ["2011-12-30T12:00[Pacific/Apia]"],
    ["2011-12-30T00:00[Pacific/Apia]"],
    ["2011-12-30T23:59[Pacific/Apia]"],
    ["2011-12-30T12:00+14:00[Pacific/Apia]"],
    ["1993-08-21T12:00[Pacific/Kwajalein]"],
    ["1994-12-31T12:00[Pacific/Kiritimati]"],
  ])("has no %s, however often it is read", (text) => {
    const first = failure(text, UTC);
    expect(first?.[0]).toBe("time.nonexistent-local-time");
    expect(failure(text, UTC)).toEqual(first);
  });

  it.each([
    ["2011-12-29T23:30[Pacific/Apia]", "2011-12-30T09:30Z"],
    ["2011-12-31T00:30[Pacific/Apia]", "2011-12-30T10:30Z"],
  ])("maps %s, next to the skipped date, to %s", (text, instant) => {
    expect(parseTime(text, UTC).start).toBe(instant);
    expect(parseTime(text, UTC).start).toBe(instant);
  });

  it("reads the same whether the skipped date or its times are read first", async () => {
    const times = [
      "2011-12-30T12:00[Pacific/Apia]",
      "2011-12-30T00:00[Pacific/Apia]",
      "2011-12-30T23:59[Pacific/Apia]",
      "2011-12-30T12:00+14:00[Pacific/Apia]",
      "2011-12-29T23:30[Pacific/Apia]",
      "2011-12-31T00:30[Pacific/Apia]",
    ];
    const days = [
      "2011-12-30[Pacific/Apia]",
      "2011-12-29[Pacific/Apia]",
      "2011-12-31[Pacific/Apia]",
    ];
    const timesFirst = await readFresh([...times, ...days], UTC);
    const daysFirst = await readFresh([...days, ...times], UTC);
    expect(timesFirst).toEqual(daysFirst);
    for (const text of times.slice(0, 4)) {
      expect(daysFirst[text]).toBe("time.nonexistent-local-time");
    }
    expect(daysFirst["2011-12-29T23:30[Pacific/Apia]"]).toMatchObject({
      start: "2011-12-30T09:30Z",
    });
    expect(daysFirst["2011-12-31T00:30[Pacific/Apia]"]).toMatchObject({
      start: "2011-12-30T10:30Z",
    });
  });
});

describe("a day whose last minutes occur twice", () => {
  // Clocks fall back shortly after the next midnight, so the end of the day is repeated:
  // in Goose Bay, 2010-11-07 00:01 -03:00 became 2010-11-06 23:01 -04:00.
  const zone = (timezone: string): TimeContext => ({ timezone, weekStart: "monday" });
  const gooseBay = zone("America/Goose_Bay");

  it.each([
    ["2010-11-06T23:30", "America/Goose_Bay"],
    ["2007-11-03T23:30", "America/St_Johns"],
    ["2010-03-04T23:30", "Antarctica/Casey"],
    ["1969-01-25T23:30", "Pacific/Guam"],
    // Clocks fell back two hours here.
    ["1988-10-29T22:30", "America/Goose_Bay"],
  ])("has %s in %s twice, however often it is read", (text, timezone) => {
    const first = failure(text, zone(timezone));
    expect(first?.[0]).toBe("time.ambiguous-local-time");
    expect(failure(text, zone(timezone))).toEqual(first);
  });

  it.each([
    ["2010-11-06T23:30-03:00", "2010-11-07T02:30Z"],
    ["2010-11-06T23:30-04:00", "2010-11-07T03:30Z"],
  ])("maps %s, with its offset, to %s", (text, instant) => {
    expect(parseTime(text, gooseBay).start).toBe(instant);
    expect(parseTime(text, gooseBay).start).toBe(instant);
  });

  it.each([
    ["2010-11-06T12:00", "2010-11-06T15:00Z"],
    ["2010-11-06T22:59", "2010-11-07T01:59Z"],
    ["2010-11-07T00:30", "2010-11-07T04:30Z"],
  ])("maps %s, outside the repeated minutes, by its own offset to %s", (text, instant) => {
    expect(parseTime(text, gooseBay).start).toBe(instant);
  });

  it("reads the same whether the day or its times are read first", async () => {
    const times = [
      "2010-11-06T12:00",
      "2010-11-06T23:30",
      "2010-11-06T23:30-03:00",
      "2010-11-06T23:30-04:00",
    ];
    const days = ["2010-11-06", "2010-11-07", "2010-11"];
    const timesFirst = await readFresh([...times, ...days], gooseBay);
    const daysFirst = await readFresh([...days, ...times], gooseBay);
    expect(timesFirst).toEqual(daysFirst);
    expect(timesFirst["2010-11-06T23:30"]).toBe("time.ambiguous-local-time");
    expect(timesFirst["2010-11-06T12:00"]).toMatchObject({ start: "2010-11-06T15:00Z" });
    expect(timesFirst["2010-11-06T23:30-04:00"]).toMatchObject({ start: "2010-11-07T03:30Z" });
  });
});
