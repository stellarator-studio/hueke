// The ledger settings and the values each accepts (docs/core/settings.md, "Settings"). Shared by
// the engine, which reads the settings a ledger writes, and by setOption, which refuses a value
// the engine would not read.

import { isTimeZone } from "../time/time.js";
import type { LedgerSettings, Weekday } from "./types.js";

export const SETTING_NAMES = [
  "timezone",
  "pad-account",
  "week-start",
  "strict",
  "income-expense",
  "decimal-mark",
  "group-mark",
] as const;

export type SettingName = (typeof SETTING_NAMES)[number];

/** What each setting's written value reads as. */
export interface SettingValues {
  readonly timezone: string;
  readonly "pad-account": string;
  readonly "week-start": Weekday;
  readonly strict: LedgerSettings["strict"];
  /** The merged root's name. */
  readonly "income-expense": string;
  readonly "decimal-mark": LedgerSettings["decimalMark"];
  readonly "group-mark": LedgerSettings["groupMark"];
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
const DECIMAL_MARKS = new Map<string, LedgerSettings["decimalMark"]>([
  [".", "."],
  [",", ","],
]);
const GROUP_MARKS = new Map<string, LedgerSettings["groupMark"]>([
  [",", ","],
  [".", "."],
  ["'", "'"],
  ["none", null],
]);
const STRICT_KINDS = new Set(["account", "commodity", "entity"]);
const MERGED_ROOT = /^\p{L}[^\s:;",]*$/u;

export function isSettingName(name: string): name is SettingName {
  return (SETTING_NAMES as readonly string[]).includes(name);
}

/**
 * The value a setting's written text reads as, or undefined when it is not a valid value
 * (`option.invalid-value`). Rules that need the rest of the ledger, such as a merged root name
 * already taken, are not checked here.
 */
export function readSetting<N extends SettingName>(
  name: N,
  text: string,
): { readonly value: SettingValues[N] } | undefined {
  const ok = (value: unknown): { readonly value: SettingValues[N] } => ({
    value: value as SettingValues[N],
  });
  switch (name) {
    case "timezone":
      return isTimeZone(text) ? ok(text) : undefined;
    case "pad-account":
      return ok(text);
    case "week-start":
      return (WEEKDAYS as readonly string[]).includes(text) ? ok(text) : undefined;
    case "strict": {
      const kinds = text.split(",").map((s) => s.trim());
      return kinds.every((k) => STRICT_KINDS.has(k)) ? ok(kinds) : undefined;
    }
    case "income-expense": {
      const [on, root = "IncomeExpenses", ...rest] = text.split(/\s+/);
      return on === "on" && rest.length === 0 && MERGED_ROOT.test(root) ? ok(root) : undefined;
    }
    case "decimal-mark":
      return DECIMAL_MARKS.has(text) ? ok(DECIMAL_MARKS.get(text)) : undefined;
    case "group-mark":
      return GROUP_MARKS.has(text) ? ok(GROUP_MARKS.get(text)) : undefined;
  }
  return undefined;
}
