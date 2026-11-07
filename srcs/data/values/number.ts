// Reads numbers and amounts as written, once `option decimal-mark`, `group-mark` and the
// Commodity aliases are known (docs/core/values.md, docs/core/commodities.md).

import type { Decimal, Id } from "./types.js";
import { decimal, neg, rational } from "./decimal.js";
import { closing, evaluate, ExpressionError } from "./expression.js";

export interface NumberFormat {
  readonly decimalMark: "." | ",";
  readonly groupMark: "," | "." | "'" | null; // null: no group mark
}

export interface AliasTable {
  readonly prefix: ReadonlyMap<string, Id>;
  readonly suffix: ReadonlyMap<string, Id>;
}

export class NumberError extends Error {}

export interface ParsedNumber {
  readonly value: Decimal;
  readonly decimals: number; // digits after the decimal mark, as written
  /** The expression as written, such as "-(1000/3)"; absent for a plain number. */
  readonly expression?: string;
}

export interface ParsedAmount extends ParsedNumber {
  readonly commodity: Id;
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A signed number such as "-1,500.25", or an expression such as "(1000/3)". */
export function parseNumber(text: string, format: NumberFormat): ParsedNumber {
  const negative = text.startsWith("-");
  return signed(parseBody(negative ? text.slice(1) : text, format), negative);
}

function signed(n: ParsedNumber, negative: boolean): ParsedNumber {
  if (n.expression !== undefined && negative) n = { ...n, expression: `-${n.expression}` };
  return negative ? { ...n, value: decimal(neg(rational(n.value))) } : n;
}

/** An unsigned number or a parenthesized expression. */
function parseBody(body: string, format: NumberFormat): ParsedNumber {
  if (!body.startsWith("(")) return parseUnsigned(body, format);
  try {
    return { ...evaluate(body, (t) => parseUnsigned(t, format)), expression: body };
  } catch (e) {
    if (e instanceof ExpressionError) throw new NumberError(e.message);
    throw e;
  }
}

function parseUnsigned(body: string, format: NumberFormat): ParsedNumber {
  const { decimalMark, groupMark } = format;
  const at = body.indexOf(decimalMark);
  const whole = at < 0 ? body : body.slice(0, at);
  const fraction = at < 0 ? "" : body.slice(at + 1);
  if (at >= 0 && !/^\d+$/.test(fraction)) throw new NumberError(`"${body}" is not a number`);
  let digits = whole;
  if (groupMark !== null && whole.includes(groupMark)) {
    const pattern = new RegExp(`^\\d{1,3}(?:${escape(groupMark)}\\d{3})+$`);
    if (!pattern.test(whole))
      throw new NumberError(`"${body}": digit groups must have three digits`);
    digits = whole.split(groupMark).join("");
  }
  if (!/^\d+$/.test(digits)) throw new NumberError(`"${body}" is not a number`);
  return {
    value: decimal(rational(fraction ? `${digits}.${fraction}` : digits)),
    decimals: fraction.length,
  };
}

/**
 * An amount: "180 NTD", "180NTD", "NT$180", "NT$ 180", "-180dollars", "180 dollars", "(1000/3) NTD".
 */
export function parseAmount(text: string, format: NumberFormat, aliases: AliasTable): ParsedAmount {
  const negative = text.startsWith("-");
  const body = negative ? text.slice(1) : text;
  const sign = (n: ParsedNumber, commodity: Id): ParsedAmount => ({
    ...signed(n, negative),
    commodity,
  });

  if (!/^[\d(]/.test(body)) {
    // A prefix alias: the longest one that matches.
    let best: string | undefined;
    for (const alias of aliases.prefix.keys())
      if (body.startsWith(alias) && (best === undefined || alias.length > best.length))
        best = alias;
    if (best === undefined) throw new NumberError(`"${text}" is not an amount`);
    const commodity = aliases.prefix.get(best);
    if (commodity === undefined) throw new NumberError(`"${best}" is a suffix alias`);
    return sign(parseBody(body.slice(best.length).trim(), format), commodity);
  }

  const numberText = body.startsWith("(")
    ? body.slice(0, closing(body) + 1)
    : /^[\d.,']+/.exec(body)?.[0];
  const unit = body.slice(numberText?.length ?? 0).trim();
  if (!numberText || unit === "") throw new NumberError(`"${text}" has no commodity`);
  const suffix = aliases.suffix.get(unit);
  let commodity: Id;
  if (suffix !== undefined) commodity = suffix;
  else if (aliases.prefix.has(unit)) throw new NumberError(`"${unit}" is a prefix alias`);
  else if (/^\p{L}[\p{L}\p{N}_.-]*$/u.test(unit)) commodity = unit;
  else throw new NumberError(`"${unit}" is not a commodity`);
  return sign(parseBody(numberText, format), commodity);
}

/** The parts of a breakdown figure, as written: `3cups * 40 NTD = 120 NTD` (docs/dsl/records.md). */
export interface FigureParts {
  readonly quantity?: { readonly number: string; readonly unit?: string };
  readonly unitPrice?: string;
  readonly total?: string;
}

/** A number of a breakdown figure, with the commodity written beside it, if any. */
export interface FigureValue extends ParsedNumber {
  readonly commodity?: Id;
}

/** A quantity, then an optional unit label, joined or not: "3cups", "3 cups", "-2". */
const QUANTITY = /^(-?[\d.,']+)\s*(\p{L}+)?$/u;
const BARE = /^-?[\d.,']+$/;

/** Splits a figure into quantity, `*` unit price and `=` total; throws NumberError when out of shape. */
export function splitFigure(text: string): FigureParts {
  if (text.includes("(")) throw new NumberError(`"${text}": a breakdown takes no expression`);
  const eq = text.indexOf("=");
  const left = (eq < 0 ? text : text.slice(0, eq)).trim();
  const total = eq < 0 ? undefined : text.slice(eq + 1).trim();
  const times = left.search(/[*×]/);
  const quantity = (times < 0 ? left : left.slice(0, times)).trim();
  const unitPrice = times < 0 ? undefined : left.slice(times + 1).trim();
  for (const part of [unitPrice, total])
    if (part !== undefined && (part === "" || /[*×=]/.test(part)))
      throw new NumberError(`"${text}" is not a breakdown figure`);
  const q = quantity === "" ? undefined : QUANTITY.exec(quantity);
  if (q === null || (q && !q[1])) throw new NumberError(`"${quantity}" is not a quantity`);
  return {
    ...(q?.[1] && { quantity: { number: q[1], ...(q[2] && { unit: q[2] }) } }),
    ...(unitPrice !== undefined && { unitPrice }),
    ...(total !== undefined && { total }),
  };
}

/** A unit price or total: a number, or an amount with its commodity ("40", "NT$40", "120 NTD"). */
export function parseFigureValue(
  text: string,
  format: NumberFormat,
  aliases: AliasTable,
): FigureValue {
  return BARE.test(text) ? parseNumber(text, format) : parseAmount(text, format, aliases);
}
