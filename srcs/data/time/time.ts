// Time values (docs/core/time.md): a written time becomes a UTC half-open interval plus the local
// dates it covers in its own time zone. Queries compare local dates; sorting uses UTC.

import { Temporal } from "temporal-polyfill";
import type { Precision, TimeValue, Weekday } from "./types.js";
import { POINT, timeTextError } from "./text.js";

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

/** One end of a time value; instants are ISO strings in UTC to the minute, as `TimeValue` has. */
interface Point {
  readonly precision: Precision;
  readonly timezone: string;
  readonly start: string;
  readonly end: string; // equal to start for a time of day
  readonly firstDate: string;
  readonly lastDate: string; // inclusive
}

/**
 * The time values read so far, or why one could not be read, by time zone, week start and text.
 * A ledger writes the same times again and again, and every reload reads them all.
 */
const readTimes = new Map<string, TimeValue | TimeError>();
/** Past this many, the times read are forgotten, so a long session does not keep every one. */
const READ_TIMES_LIMIT = 200_000;

/**
 * Parses a time value: a point or `<point>..<point>`, each with an optional `[Zone]`. Text is
 * checked by the same rules as ledger text, so `2026-13` is rejected, never adjusted.
 */
export function parseTime(literal: string, context: TimeContext): TimeValue {
  const key = `${context.timezone} ${context.weekStart} ${literal}`;
  const known = readTimes.get(key);
  if (known instanceof TimeError) throw new TimeError(known.code, known.message);
  if (known) return known;
  let value: TimeValue | TimeError;
  try {
    // Every reader gets this same value, so none can change what the others see.
    value = Object.freeze(readTime(literal, context));
  } catch (e) {
    if (!(e instanceof TimeError)) throw e;
    value = e;
  }
  if (readTimes.size >= READ_TIMES_LIMIT) readTimes.clear();
  readTimes.set(key, value);
  if (value instanceof TimeError) throw value;
  return value;
}

function readTime(literal: string, context: TimeContext): TimeValue {
  const error = timeTextError(literal, false);
  if (error !== undefined) throw new TimeError("parse.invalid-time", error);
  const parts = literal.split("..");
  const [first, second] = parts;
  if (first === undefined || parts.length > 2) throw new TimeError("parse.invalid-time", literal);
  const a = parsePoint(first, context);
  const b = second === undefined ? a : parsePoint(second, context);
  if (b.end < a.start)
    throw new TimeError("parse.invalid-time", `"${literal}" ends before it starts`);
  return {
    literal,
    precision: a.precision,
    timezone: a.timezone,
    localDate: a.firstDate,
    localEnd: b.lastDate,
    start: a.start,
    end: b.end,
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

/** An instant in epoch milliseconds as `iso` writes it: UTC to the minute. */
function isoOfMs(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16)}Z`;
}

/** A local date as text, `YYYY-MM-DD`. */
function dateText(year: number, month: number, day: number): string {
  const pad = (n: number, width: number): string => String(n).padStart(width, "0");
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** The local date `days` after one, as text; the date is valid. */
function addDays(date: string, days: number): string {
  const d = new Date(0);
  d.setUTCFullYear(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8)) + days,
  );
  return dateText(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** A local date and time, read as if it were UTC, in epoch milliseconds. */
function localMs(year: number, month: number, day: number, hour: number, minute: number): number {
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  d.setUTCHours(hour, minute, 0, 0);
  return d.getTime();
}

/** A local date in one time zone: when it starts, and its UTC offset when its time is steady. */
interface Day {
  /** The instant the day starts, as `iso` writes it. */
  readonly start: string;
  /** The UTC offset in milliseconds, when the day has one throughout; undefined when it changes. */
  readonly offset: number | undefined;
}

const days = new Map<string, Day>();

/**
 * A local date (`YYYY-MM-DD`, valid) in a time zone, worked out with Temporal once. A day that
 * starts at its local midnight, with no transition before the next local midnight read at the
 * later of its offsets, has no transition, so its times map to instants by its offset alone.
 * - A day whose midnight is skipped starts later, already at the new offset.
 * - A day skipped whole, as when a zone crosses the date line, "starts" on the next date.
 * - Clocks set back shortly after the next midnight repeat the last minutes of this day too.
 */
function dayIn(timezone: string, date: string): Day {
  const key = `${timezone} ${date}`;
  let day = days.get(key);
  if (!day) {
    const start = Temporal.PlainDate.from(date).toZonedDateTime({ timeZone: timezone });
    const next = Temporal.PlainDate.from(addDays(date, 1))
      .toPlainDateTime()
      .toZonedDateTime(timezone, { disambiguation: "later" });
    const transition = start.getTimeZoneTransition("next");
    const steady =
      start.toPlainDate().toString() === date &&
      start.hour === 0 &&
      start.minute === 0 &&
      (transition === null || Temporal.ZonedDateTime.compare(transition, next) >= 0);
    day = {
      start: iso(start.toInstant()),
      offset: steady ? start.offsetNanoseconds / 1_000_000 : undefined,
    };
    if (days.size >= READ_TIMES_LIMIT) days.clear();
    days.set(key, day);
  }
  return day;
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
    const count = (weekOne(y + 1, context.weekStart) - first) / 7;
    if (n < 1 || n > count)
      throw new TimeError("time.nonexistent-week", `${String(y)} has no week ${String(n)}`);
    const startDate = dateOfDayNumber(first + (n - 1) * 7);
    return dates("week", timezone, startDate, addDays(startDate, 6));
  }
  if (month === undefined) return dates("year", timezone, dateText(y, 1, 1), dateText(y, 12, 31));
  const mo = Number(month);
  if (day === undefined) {
    const first = dateText(y, mo, 1);
    const next = mo === 12 ? dateText(y + 1, 1, 1) : dateText(y, mo + 1, 1);
    return dates("month", timezone, first, addDays(next, -1));
  }
  // The text has been checked, so the date exists.
  const date = dateText(y, mo, Number(day));
  if (hour === undefined || minute === undefined) return dates("day", timezone, date, date);

  const steady = dayIn(timezone, date).offset;
  if (steady !== undefined) {
    // No transition that day: the local time exists once, at the day's offset.
    if (offset !== undefined && offsetNanoseconds(offset) !== steady * 1_000_000)
      throw new TimeError(
        "time.offset-mismatch",
        `${text}: ${timezone} is not at ${offset} at that time`,
      );
    const at = isoOfMs(localMs(y, mo, Number(day), Number(hour), Number(minute)) - steady);
    return { precision: "time", timezone, start: at, end: at, firstDate: date, lastDate: date };
  }

  const local = Temporal.PlainDate.from(date).toPlainDateTime({
    hour: Number(hour),
    minute: Number(minute),
  });
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
  const instant = iso(chosen.toInstant());
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

/** Whole local days, from the start of the first to the start of the day after the last. */
function dates(precision: Precision, timezone: string, firstDate: string, lastDate: string): Point {
  return {
    precision,
    timezone,
    start: dayIn(timezone, firstDate).start,
    end: dayIn(timezone, addDays(lastDate, 1)).start,
    firstDate,
    lastDate,
  };
}

/** Whether a time is one day or one moment: what a posting may have as its effective. */
export const isOneDayOrMoment = (t: TimeValue): boolean =>
  (t.precision === "day" || t.precision === "time") && !t.literal.includes("..");

/** Whether a time is one day: what a Balance has as its effective. */
export const isOneDay = (t: TimeValue): boolean =>
  t.precision === "day" && !t.literal.includes("..");

/** A day number: days since 1970-01-01, which is 0. */
function dayNumber(year: number, month: number, day: number): number {
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  return Math.round(d.getTime() / 86_400_000);
}

/** The day number of a local date (`YYYY-MM-DD`, valid). */
function dayNumberOf(date: string): number {
  return dayNumber(Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8)));
}

/** The local date of a day number, as text. */
function dateOfDayNumber(n: number): string {
  const d = new Date(n * 86_400_000);
  return dateText(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * Whether `YYYY-MM-DD` text is a date that exists, in the years a ledger may use: 0001 to 9998
 * (docs/core/time.md).
 */
export function isPlainDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const year = Number(text.slice(0, 4));
  return year >= 1 && year <= 9998 && dateOfDayNumber(dayNumberOf(text)) === text;
}

/**
 * Week 1 is the week that contains January 1, starting on `weekStart` (not ISO 8601): the day
 * number of its first day.
 */
function weekOne(year: number, weekStart: Weekday): number {
  const jan1 = dayNumber(year, 1, 1);
  // Day 0, 1970-01-01, is a Thursday: 3 days after a Monday.
  const weekday = (((jan1 + 3) % 7) + 7) % 7; // 0 is Monday
  return jan1 - ((weekday - WEEKDAYS.indexOf(weekStart) + 7) % 7);
}

/** The week label ("2027-W01") of a local date. */
export function weekLabel(date: string, weekStart: Weekday): string {
  const d = dayNumberOf(date);
  let year = Number(date.slice(0, 4)) + 1;
  while (weekOne(year, weekStart) > d) year--;
  const n = Math.floor((d - weekOne(year, weekStart)) / 7) + 1;
  return `${String(year)}-W${String(n).padStart(2, "0")}`;
}

/** Each local date from `first` to `last`, inclusive. */
export function* eachDate(first: string, last: string): Generator<string> {
  if (first === last) {
    yield first;
    return;
  }
  const end = dayNumberOf(last);
  for (let d = dayNumberOf(first); d <= end; d++) yield dateOfDayNumber(d);
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
