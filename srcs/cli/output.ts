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
