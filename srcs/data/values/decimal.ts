// Exact arithmetic on Decimal strings. A value is a reduced fraction of bigints; it prints as a
// decimal when the denominator has only the factors 2 and 5, and as "n/d" otherwise (such as the
// result of `(1000/3)`).

import type { Decimal } from "./types.js";

export interface Rational {
  readonly n: bigint;
  readonly d: bigint; // > 0
}

export const ZERO: Rational = { n: 0n, d: 1n };

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

function make(n: bigint, d: bigint): Rational {
  if (d === 0n) throw new RangeError("division by zero");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return g > 1n ? { n: n / g, d: d / g } : { n, d };
}

/** Reads a canonical Decimal: "-12.5", "32100", "1000/3". */
export function rational(value: Decimal): Rational {
  const slash = value.indexOf("/");
  if (slash >= 0) return make(BigInt(value.slice(0, slash)), BigInt(value.slice(slash + 1)));
  const negative = value.startsWith("-");
  const body = negative ? value.slice(1) : value;
  const dot = body.indexOf(".");
  const digits = dot < 0 ? body : body.slice(0, dot) + body.slice(dot + 1);
  const scale = dot < 0 ? 0 : body.length - dot - 1;
  const n = BigInt(digits);
  return make(negative ? -n : n, 10n ** BigInt(scale));
}

export function decimal(r: Rational): Decimal {
  let d = r.d;
  let twos = 0;
  let fives = 0;
  while (d % 2n === 0n) {
    d /= 2n;
    twos++;
  }
  while (d % 5n === 0n) {
    d /= 5n;
    fives++;
  }
  if (d !== 1n) return `${r.n.toString()}/${r.d.toString()}`;
  const scale = Math.max(twos, fives);
  const scaled = (r.n * 10n ** BigInt(scale)) / r.d;
  const negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export const add = (a: Rational, b: Rational): Rational => make(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Rational, b: Rational): Rational => make(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Rational, b: Rational): Rational => make(a.n * b.n, a.d * b.d);
export const div = (a: Rational, b: Rational): Rational => make(a.n * b.d, a.d * b.n);
export const neg = (a: Rational): Rational => ({ n: -a.n, d: a.d });
export const abs = (a: Rational): Rational => (a.n < 0n ? neg(a) : a);
export const cmp = (a: Rational, b: Rational): number => {
  const x = a.n * b.d;
  const y = b.n * a.d;
  return x < y ? -1 : x > y ? 1 : 0;
};
export const isZero = (a: Rational): boolean => a.n === 0n;
export const isInteger = (a: Rational): boolean => a.d === 1n;

/** 10^-k as a Rational. */
export const tenToMinus = (k: number): Rational => make(1n, 10n ** BigInt(k));

/** Sums Decimal strings. */
export function sum(values: Iterable<Decimal>): Decimal {
  let total = ZERO;
  for (const v of values) total = add(total, rational(v));
  return decimal(total);
}

// The public value arithmetic (docs/core/values.md, "Arithmetic"): Decimal strings in and
// out, for a presentation that works figures out of values the API returned.

const VALUE = /^-?\d+(\.\d+)?$|^-?\d+\/\d*[1-9]\d*$/;

function checked(value: Decimal): Rational {
  if (typeof value !== "string" || !VALUE.test(value))
    throw new RangeError(`not a value: ${JSON.stringify(value)}`);
  return rational(value);
}

export function sumValues(values: Iterable<Decimal>): Decimal {
  let total = ZERO;
  for (const v of values) total = add(total, checked(v));
  return decimal(total);
}

export const multiplyValues = (a: Decimal, b: Decimal): Decimal =>
  decimal(mul(checked(a), checked(b)));

export const negateValue = (value: Decimal): Decimal => decimal(neg(checked(value)));

export const compareValues = (a: Decimal, b: Decimal): number => cmp(checked(a), checked(b));
