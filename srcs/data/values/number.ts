// Reads numbers and amounts as written (docs/core/values.md): `.` is the decimal mark and `,`
// groups digits by three.

import type { Decimal, Id } from "./types.js";
import { decimal, neg, rational } from "./decimal.js";
import { closing, evaluate, ExpressionError } from "./expression.js";

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

/** A signed number such as "-1,500.25", or an expression such as "(1000/3)". */
export function parseNumber(text: string): ParsedNumber {
  const negative = text.startsWith("-");
  return signed(parseBody(negative ? text.slice(1) : text), negative);
}

function signed(n: ParsedNumber, negative: boolean): ParsedNumber {
  if (n.expression !== undefined && negative) n = { ...n, expression: `-${n.expression}` };
  return negative ? { ...n, value: decimal(neg(rational(n.value))) } : n;
}

/** An unsigned number or a parenthesized expression. */
function parseBody(body: string): ParsedNumber {
  if (!body.startsWith("(")) return parseUnsigned(body);
  try {
    return { ...evaluate(body, parseUnsigned), expression: body };
  } catch (e) {
    if (e instanceof ExpressionError) throw new NumberError(e.message);
    throw e;
  }
}

function parseUnsigned(body: string): ParsedNumber {
  const at = body.indexOf(".");
  const whole = at < 0 ? body : body.slice(0, at);
  const fraction = at < 0 ? "" : body.slice(at + 1);
  if (at >= 0 && !/^\d+$/.test(fraction)) throw new NumberError(`"${body}" is not a number`);
  let digits = whole;
  if (whole.includes(",")) {
    if (!/^\d{1,3}(?:,\d{3})+$/.test(whole))
      throw new NumberError(`"${body}": digit groups must have three digits`);
    digits = whole.split(",").join("");
  }
  if (!/^\d+$/.test(digits)) throw new NumberError(`"${body}" is not a number`);
  return {
    value: decimal(rational(fraction ? `${digits}.${fraction}` : digits)),
    decimals: fraction.length,
  };
}

/** An amount: "180 NTD", "180NTD", "-1,500.25 USD", "(1000/3) NTD". */
export function parseAmount(text: string): ParsedAmount {
  const negative = text.startsWith("-");
  const body = negative ? text.slice(1) : text;
  const numberText = body.startsWith("(")
    ? body.slice(0, closing(body) + 1)
    : /^[\d.,]+/.exec(body)?.[0];
  const unit = body.slice(numberText?.length ?? 0).trim();
  if (!numberText || unit === "") throw new NumberError(`"${text}" has no commodity`);
  if (!/^\p{L}[\p{L}\p{N}_.-]*$/u.test(unit)) throw new NumberError(`"${unit}" is not a commodity`);
  return { ...signed(parseBody(numberText), negative), commodity: unit };
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
const QUANTITY = /^(-?[\d.,]+)\s*(\p{L}+)?$/u;
const BARE = /^-?[\d.,]+$/;

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

/** A unit price or total: a number, or an amount with its commodity ("40", "120 NTD"). */
export function parseFigureValue(text: string): FigureValue {
  return BARE.test(text) ? parseNumber(text) : parseAmount(text);
}
