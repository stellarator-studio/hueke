// Arithmetic in amounts (docs/core/values.md, "Arithmetic"): `+ - * /` and parentheses over exact
// rationals. The numbers inside are read by the caller, with the ledger's marks.

import type { Decimal } from "./types.js";
import { add, decimal, div, isZero, mul, neg, rational, sub, type Rational } from "./decimal.js";

export class ExpressionError extends Error {}

export interface Evaluated {
  readonly value: Decimal;
  readonly decimals: number; // the most decimal places among the numbers written
}

/** The index of the parenthesis that closes the one at `text[0]`, or -1. */
export function closing(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

/** Evaluates `(…)`, such as `(1000/3)` or `((100 + 50) * 2)`. */
export function evaluate(
  text: string,
  readNumber: (text: string) => { readonly value: Decimal; readonly decimals: number },
): Evaluated {
  const tokens = text.match(/[()+\-*/]|[^\s()+\-*/]+/g) ?? [];
  let at = 0;
  let decimals = 0;
  const fail = (): never => {
    throw new ExpressionError(`"${text}" is not an expression`);
  };
  const peek = (): string | undefined => tokens[at];

  function sum(): Rational {
    let value = term();
    for (let op = peek(); op === "+" || op === "-"; op = peek()) {
      at++;
      value = op === "+" ? add(value, term()) : sub(value, term());
    }
    return value;
  }
  function term(): Rational {
    let value = factor();
    for (let op = peek(); op === "*" || op === "/"; op = peek()) {
      at++;
      const right = factor();
      if (op === "/" && isZero(right)) throw new ExpressionError(`"${text}" divides by zero`);
      value = op === "*" ? mul(value, right) : div(value, right);
    }
    return value;
  }
  function factor(): Rational {
    const token = tokens[at++];
    if (token === "-") return neg(factor());
    if (token === "(") {
      const value = sum();
      if (tokens[at++] !== ")") fail();
      return value;
    }
    if (token === undefined || /^[)+*/]$/.test(token)) return fail();
    const n = readNumber(token);
    decimals = Math.max(decimals, n.decimals);
    return rational(n.value);
  }

  if (peek() !== "(") fail();
  const value = factor();
  if (at !== tokens.length) fail();
  return { value: decimal(value), decimals };
}
