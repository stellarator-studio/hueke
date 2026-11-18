// Presentation for the CLI (docs/cli.md, "Output"): tables and CSV. Nothing here changes what the
// API computed.

import { formatText, valueText, type Amount, type Hueke } from "../index.js";

export type Format = "table" | "csv";

/**
 * Writes an amount for a table: its value as `valueText` writes it, through the commodity's format,
 * or followed by its commodity when it has none (docs/core/commodities.md, "API").
 */
export function amountText(hueke: Hueke): (a: Amount) => string {
  const value = valueText(hueke);
  const commodities = new Map(hueke.commodities.map((c) => [c.id, c]));
  return (a) => formatText(commodities.get(a.commodity) ?? { id: a.commodity }, value(a));
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
