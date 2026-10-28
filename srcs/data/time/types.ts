// Time values (docs/core/time.md).

/** `time` is a time of day, written to the minute. */
export type Precision = "year" | "month" | "week" | "day" | "time";

export interface TimeValue {
  readonly literal: string; // as written, e.g. "2026-12"
  readonly precision: Precision; // of the first point of an interval
  readonly timezone: string; // IANA name
  readonly localDate: string; // first local date, for calendar comparison
  readonly localEnd: string; // last local date covered (inclusive)
  readonly start: string; // UTC half-open interval [start, end), e.g. "2026-10-11T16:00Z"
  readonly end: string;
}
