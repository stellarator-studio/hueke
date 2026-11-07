// Time errors that can be told from the text alone (parse.invalid-time), shared by the parser (for
// times and for period labels after an anchor) and the API's time arguments (docs/core/time.md, "Times given to the API"). Weeks that need
// `option week-start` (such as a missing W53) are checked when the time is read.

const POINT =
  /^(\d{4})(?:-(?:W(\d{2})|(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2})([+-]\d{2}:\d{2})?)?)?))?(?:\[([A-Za-z0-9/_+-]+)\])?$/;

/** Returns a message when `text` (a time value, optionally `<time>=<time>`) is not valid. */
export function timeTextError(text: string, allowAccounting: boolean): string | undefined {
  const sides = text.split("=");
  if (sides.length > 2 || (sides.length === 2 && !allowAccounting))
    return `"${text}" has more than one =`;
  for (const side of sides) {
    const points = side.split("..");
    if (points.length > 2) return `"${side}" has more than one ..`;
    for (const point of points) {
      const error = pointError(point);
      if (error) return error;
    }
  }
  return undefined;
}

function pointError(point: string): string | undefined {
  if (/T\d{2}:\d{2}:\d{2}/.test(point))
    return `"${point}": a time of day is written to the minute, without seconds`;
  const m = POINT.exec(point);
  if (!m) return `"${point}" is not a time value`;
  const [, year, week, month, day, hour, minute, offset] = m;
  if (week !== undefined) {
    const w = Number(week);
    return w < 1 || w > 53 ? `"${point}": there is no week ${week}` : undefined;
  }
  if (month === undefined) return undefined;
  const mo = Number(month);
  if (mo < 1 || mo > 12) return `"${point}": there is no month ${month}`;
  if (day === undefined) return undefined;
  const d = Number(day);
  if (d < 1 || d > daysInMonth(Number(year), mo)) return `"${point}": there is no such day`;
  if (hour === undefined || minute === undefined) return undefined;
  if (Number(hour) > 23 || Number(minute) > 59) return `"${point}" is not a time of day`;
  if (offset !== undefined && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4)) > 59))
    return `"${point}" has no UTC offset ${offset}`;
  return undefined;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
