// Time values (docs/core/time.md): a written time becomes a UTC half-open interval plus the local
// dates it covers in its own time zone. Queries compare local dates; sorting uses UTC.

import { Temporal } from "temporal-polyfill";
import type { Precision, TimeValue, Weekday } from "./types.js";
import { timeTextError } from "./text.js";

export interface TimeContext {
  readonly timezone: string;
  readonly weekStart: Weekday;
}

export class TimeError extends Error {
  constructor(
    readonly code:
      | "time.nonexistent-local-time"
      | "time.ambiguous-local-time"
      | "time.nonexistent-week"
      | "time.offset-mismatch"
      | "parse.invalid-time",
    message: string,
  ) {
    super(message);
  }
}

const WEEKDAYS: readonly Weekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const POINT =
  /^(\d{4})(?:-(?:W(\d{2})|(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2})([+-]\d{2}:\d{2})?)?)?))?(?:\[([^\]]+)\])?$/;

interface Point {
  readonly precision: Precision;
  readonly timezone: string;
  readonly start: Temporal.Instant;
  readonly end: Temporal.Instant; // equal to start for a time of day
  readonly firstDate: Temporal.PlainDate;
  readonly lastDate: Temporal.PlainDate; // inclusive
}

/**
 * Parses a time value: a point or `<point>..<point>`, each with an optional `[Zone]`. Text is
 * checked by the same rules as ledger text, so `2026-13` is rejected, never adjusted.
 */
export function parseTime(literal: string, context: TimeContext): TimeValue {
  const error = timeTextError(literal, false);
  if (error !== undefined) throw new TimeError("parse.invalid-time", error);
  const parts = literal.split("..");
  const [first, second] = parts;
  if (first === undefined || parts.length > 2) throw new TimeError("parse.invalid-time", literal);
  const a = parsePoint(first, context);
  const b = second === undefined ? a : parsePoint(second, context);
  if (Temporal.Instant.compare(b.end, a.start) < 0)
    throw new TimeError("parse.invalid-time", `"${literal}" ends before it starts`);
  return {
    literal,
    precision: a.precision,
    timezone: a.timezone,
    localDate: a.firstDate.toString(),
    localEnd: b.lastDate.toString(),
    start: iso(a.start),
    end: iso(b.end),
  };
}

const zones = new Map<string, boolean>();

/**
 * A query time given to the API: a time value, or its text read with the ledger's time zone and
 * week start. Text that cannot be read, or a time of day, is a misuse of the API; the error names
 * the code.
 */
export function timeInput(t: TimeValue | string, context: TimeContext): TimeValue {
  let value: TimeValue;
  try {
    value = typeof t === "string" ? parseTime(t, context) : t;
  } catch (e) {
    if (e instanceof TimeError) throw new Error(`${e.code}: ${e.message}`, { cause: e });
    throw e;
  }
  if (/\dT\d{2}:/.test(value.literal))
    throw new Error(`query.time-of-day: "${value.literal}": a query time has no time of day`);
  return value;
}

/** Whether `name` is an IANA time zone the runtime knows. */
export function isTimeZone(name: string): boolean {
  let known = zones.get(name);
  if (known === undefined) {
    try {
      Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(name);
      known = true;
    } catch {
      known = false;
    }
    zones.set(name, known);
  }
  return known;
}

function iso(instant: Temporal.Instant): string {
  return instant.toString({ smallestUnit: "minute" });
}

function parsePoint(text: string, context: TimeContext): Point {
  const m = POINT.exec(text);
  if (!m?.[1]) throw new TimeError("parse.invalid-time", `"${text}" is not a time value`);
  const [, year, week, month, day, hour, minute, offset, zone] = m;
  const timezone = zone ?? context.timezone;
  if (!isTimeZone(timezone))
    throw new TimeError("parse.invalid-time", `unknown time zone "${timezone}"`);
  const y = Number(year);

  if (week !== undefined) {
    const n = Number(week);
    const first = weekOne(y, context.weekStart);
    const count = first.until(weekOne(y + 1, context.weekStart)).days / 7;
    if (n < 1 || n > count)
      throw new TimeError("time.nonexistent-week", `${String(y)} has no week ${String(n)}`);
    const startDate = first.add({ days: (n - 1) * 7 });
    return dates("week", timezone, startDate, startDate.add({ days: 6 }));
  }
  if (month === undefined) {
    const startDate = Temporal.PlainDate.from({ year: y, month: 1, day: 1 });
    return dates("year", timezone, startDate, startDate.add({ years: 1 }).subtract({ days: 1 }));
  }
  const mo = Number(month);
  if (day === undefined) {
    const startDate = Temporal.PlainDate.from({ year: y, month: mo, day: 1 });
    return dates("month", timezone, startDate, startDate.add({ months: 1 }).subtract({ days: 1 }));
  }
  const date = Temporal.PlainDate.from(
    { year: y, month: mo, day: Number(day) },
    { overflow: "reject" },
  );
  if (hour === undefined || minute === undefined) return dates("day", timezone, date, date);

  const local = date.toPlainDateTime({ hour: Number(hour), minute: Number(minute) });
  const earlier = local.toZonedDateTime(timezone, { disambiguation: "earlier" });
  const later = local.toZonedDateTime(timezone, { disambiguation: "later" });
  if (!earlier.toPlainDateTime().equals(local))
    throw new TimeError("time.nonexistent-local-time", `${text} does not exist in ${timezone}`);
  // A written UTC offset picks the moment; it must be one the zone has at that local time.
  const matching =
    offset === undefined
      ? [earlier, later]
      : [earlier, later].filter((z) => z.offsetNanoseconds === offsetNanoseconds(offset));
  const [chosen] = matching;
  if (chosen === undefined)
    throw new TimeError(
      "time.offset-mismatch",
      `${text}: ${timezone} is not at ${offset ?? ""} at that time`,
    );
  if (chosen.epochNanoseconds !== later.epochNanoseconds && matching.length > 1)
    throw new TimeError(
      "time.ambiguous-local-time",
      `${text} happens twice in ${timezone}; write its UTC offset (${earlier.offset} or ${later.offset})`,
    );
  const instant = chosen.toInstant();
  return {
    precision: "time",
    timezone,
    start: instant,
    end: instant,
    firstDate: date,
    lastDate: date,
  };
}

/** "+05:30" or "-04:00" in nanoseconds. */
function offsetNanoseconds(offset: string): number {
  const minutes = Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4));
  return (offset.startsWith("-") ? -minutes : minutes) * 60_000_000_000;
}

function dates(
  precision: Precision,
  timezone: string,
  firstDate: Temporal.PlainDate,
  lastDate: Temporal.PlainDate,
): Point {
  return {
    precision,
    timezone,
    start: firstDate.toZonedDateTime({ timeZone: timezone }).toInstant(),
    end: lastDate.add({ days: 1 }).toZonedDateTime({ timeZone: timezone }).toInstant(),
    firstDate,
    lastDate,
  };
}

/** Whether a time is one day or one moment: what a posting or a Balance may have as its effective. */
export const isOneDayOrMoment = (t: TimeValue): boolean =>
  (t.precision === "day" || t.precision === "time") && !t.literal.includes("..");

/** Week 1 is the week that contains January 1, starting on `weekStart` (not ISO 8601). */
export function weekOne(year: number, weekStart: Weekday): Temporal.PlainDate {
  const jan1 = Temporal.PlainDate.from({ year, month: 1, day: 1 });
  const offset = (jan1.dayOfWeek - 1 - WEEKDAYS.indexOf(weekStart) + 7) % 7;
  return jan1.subtract({ days: offset });
}

/** The week label ("2027-W01") of a local date. */
export function weekLabel(date: string, weekStart: Weekday): string {
  const d = Temporal.PlainDate.from(date);
  let year = d.year + 1;
  while (Temporal.PlainDate.compare(weekOne(year, weekStart), d) > 0) year--;
  const n = Math.floor(weekOne(year, weekStart).until(d).days / 7) + 1;
  return `${String(year)}-W${String(n).padStart(2, "0")}`;
}

/** Each local date from `first` to `last`, inclusive. */
export function* eachDate(first: string, last: string): Generator<string> {
  let d = Temporal.PlainDate.from(first);
  const end = Temporal.PlainDate.from(last);
  while (Temporal.PlainDate.compare(d, end) <= 0) {
    yield d.toString();
    d = d.add({ days: 1 });
  }
}

// ---------- Predicates (docs/core/time.md, "Time predicates") ----------

export type Predicate = "within" | "overlaps" | "covers" | "until";

const isPoint = (t: TimeValue): boolean => t.start === t.end;

/**
 * Whether record time `r` satisfies `predicate` against query time `q`. Query times have no time
 * of day, so the record's local dates in its own time zone are compared, whatever its precision.
 */
export function matches(r: TimeValue, predicate: Predicate, q: TimeValue): boolean {
  switch (predicate) {
    case "within":
      return q.localDate <= r.localDate && r.localEnd <= q.localEnd;
    case "overlaps":
      return r.localDate <= q.localEnd && q.localDate <= r.localEnd;
    case "covers":
      // A point never covers a query time.
      return !isPoint(r) && r.localDate <= q.localDate && q.localEnd <= r.localEnd;
    case "until":
      // A record counts once it has ended.
      return r.localEnd <= q.localEnd;
  }
}

/**
 * Orders times at their end, in UTC; a point at its moment (docs/core/transactions.md, "Order of
 * transactions"). At the same end, intervals come before points, and a shorter interval first.
 */
export function compareTime(a: TimeValue, b: TimeValue): number {
  if (a.end !== b.end) return a.end < b.end ? -1 : 1;
  if (isPoint(a) !== isPoint(b)) return isPoint(a) ? 1 : -1;
  return a.start > b.start ? -1 : a.start < b.start ? 1 : 0;
}
