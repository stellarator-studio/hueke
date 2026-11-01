// Presentation for the CLI (docs/cli.md, "Output"): tables and CSV. Nothing here changes what the
// API computed.

import type { Amount, Hueke, LedgerSettings } from "../index.js";

export type Format = "table" | "csv";

type Marks = Pick<LedgerSettings, "decimalMark" | "groupMark">;

/**
 * Writes a value for a table, without its commodity: in the ledger's marks, padded with zeros up to
 * the commodity's precision, never dropping digits. A fraction is grouped but not padded.
 */
export function valueText(hueke: Hueke): (a: Amount) => string {
  const precisions = new Map(hueke.commodities.map((c) => [c.id, c.precision]));
  return (a) => {
    const slash = a.value.indexOf("/");
    if (slash >= 0)
      return `${number(a.value.slice(0, slash), 0, hueke.settings)}/${number(a.value.slice(slash + 1), 0, hueke.settings)}`;
    return number(a.value, precisions.get(a.commodity) ?? 0, hueke.settings);
  };
}

/** Writes an amount for a table: its value as `valueText` writes it, then its commodity. */
export function amountText(hueke: Hueke): (a: Amount) => string {
  const value = valueText(hueke);
  return (a) => `${value(a)} ${a.commodity}`;
}

function number(value: string, precision: number, marks: Marks): string {
  const negative = value.startsWith("-");
  const [whole = "", fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const grouped =
    marks.groupMark === null ? whole : whole.replace(/\B(?=(\d{3})+$)/g, marks.groupMark);
  const digits = fraction.padEnd(precision, "0");
  return `${negative ? "-" : ""}${grouped}${digits ? `${marks.decimalMark}${digits}` : ""}`;
}

/**
 * Adds Decimal strings exactly, for running balances. A value is a decimal ("-12.5") or a
 * reduced fraction ("1000/3"); the sum is written the same way as the API writes values.
 */
export function addDecimals(a: string, b: string): string {
  const [an, ad] = fraction(a);
  const [bn, bd] = fraction(b);
  let n = an * bd + bn * ad;
  let d = ad * bd;
  const g = gcd(n, d);
  n /= g;
  d /= g;
  let rest = d;
  let scale = 0;
  for (const p of [2n, 5n])
    for (let k = 0; rest % p === 0n; k++) {
      rest /= p;
      scale = Math.max(scale, k + 1);
    }
  if (rest !== 1n) return `${n.toString()}/${d.toString()}`;
  const scaled = (n * 10n ** BigInt(scale)) / d;
  const digits = (scaled < 0n ? -scaled : scaled).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const decimals = digits.slice(digits.length - scale);
  return `${scaled < 0n ? "-" : ""}${whole}${decimals ? `.${decimals}` : ""}`;
}

/** A Decimal as numerator and positive denominator. */
function fraction(value: string): [bigint, bigint] {
  const slash = value.indexOf("/");
  if (slash >= 0) return [BigInt(value.slice(0, slash)), BigInt(value.slice(slash + 1))];
  const negative = value.startsWith("-");
  const [whole = "0", decimals = ""] = value.replace(/^[-+]/, "").split(".");
  const n = BigInt(whole + decimals);
  return [negative ? -n : n, 10n ** BigInt(decimals.length)];
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

/** Columns separated by two spaces; columns listed in `right` are right-aligned. */
export function table(
  lines: readonly (readonly string[])[],
  right: readonly number[] = [],
): string {
  const widths: number[] = [];
  for (const line of lines)
    line.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, cell.length)));
  return lines
    .map((line) => {
      const cells = line.map((cell, i) =>
        right.includes(i) ? cell.padStart(widths[i] ?? 0) : cell.padEnd(widths[i] ?? 0),
      );
      return `${cells.join("  ").trimEnd()}\n`;
    })
    .join("");
}

export function csv(columns: readonly string[], rows: readonly (readonly string[])[]): string {
  const quote = (cell: string): string =>
    /[",\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
  return [columns, ...rows].map((r) => `${r.map(quote).join(",")}\n`).join("");
}
