// Presentation for the CLI (docs/cli.md, "Output"): tables and CSV. Nothing here changes what the
// API computed.

import type { Amount, Commodity, Id } from "../index.js";

export type Format = "table" | "csv";

/** Pads a decimal with zeros up to the commodity's precision; never drops digits. */
export function amountText(a: Amount, commodities: ReadonlyMap<Id, Commodity>): string {
  const precision = commodities.get(a.commodity)?.precision ?? 0;
  const [whole = a.value, fraction = ""] = a.value.split(".");
  const digits = fraction.padEnd(precision, "0");
  return `${whole}${digits ? `.${digits}` : ""} ${a.commodity}`;
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
