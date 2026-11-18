// Amounts written for showing (docs/core/commodities.md, "API"): values in the ledger's marks and
// padded to their commodity's precision, and value text put through a commodity's format. Every
// presentation, the CLI included, writes amounts with these, so a value reads the same everywhere.

import type { Amount, Commodity, LedgerSettings } from "./types.js";

/** What `valueText` needs of a ledger. */
interface Written {
  readonly commodities: readonly Pick<Commodity, "id" | "precision">[];
  readonly settings: Pick<LedgerSettings, "decimalMark" | "groupMark">;
}

/**
 * Writes a value without its commodity: in the ledger's marks, padded with zeros up to the
 * commodity's precision, never dropping digits. A fraction is grouped but not padded.
 */
export function valueText(ledger: Written): (a: Amount) => string {
  const precisions = new Map(ledger.commodities.map((c) => [c.id, c.precision]));
  const { decimalMark, groupMark } = ledger.settings;
  const number = (value: string, precision: number): string => {
    const negative = value.startsWith("-");
    const [whole = "", fraction = ""] = (negative ? value.slice(1) : value).split(".");
    const grouped = groupMark === null ? whole : whole.replace(/\B(?=(\d{3})+$)/g, groupMark);
    const digits = fraction.padEnd(precision, "0");
    return `${negative ? "-" : ""}${grouped}${digits ? `${decimalMark}${digits}` : ""}`;
  };
  return (a) => {
    const slash = a.value.indexOf("/");
    if (slash >= 0)
      return `${number(a.value.slice(0, slash), 0)}/${number(a.value.slice(slash + 1), 0)}`;
    return number(a.value, precisions.get(a.commodity) ?? 0);
  };
}

/**
 * Value text through a commodity's format: `{amount}` is the text without its minus sign, which
 * goes before the whole result, as `-$1,234`; without a format, the text and the code.
 */
export function formatText(
  commodity: Pick<Commodity, "id" | "displayName" | "format">,
  text: string,
): string {
  const negative = text.startsWith("-");
  const fields: Readonly<Record<string, string>> = {
    amount: negative ? text.slice(1) : text,
    code: commodity.id,
    leaf: commodity.id.slice(commodity.id.lastIndexOf(":") + 1),
    name: commodity.displayName ?? commodity.id,
  };
  const written = (commodity.format ?? "{amount} {code}").replace(
    /\{(amount|code|leaf|name)\}/g,
    (_, key: string) => fields[key] ?? "",
  );
  return negative ? `-${written}` : written;
}
