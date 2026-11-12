// Identifier rules (docs/dsl/lexical.md, "Identifiers"). Each check returns a message when the
// text breaks its rule; the caller reports it as parse.syntax,
// or anchor.invalid-name for an anchor.

import { HuekeLexer as L } from "./generated/HuekeLexer.js";

/** The keywords of Hueke.g4, with their token types. */
export const KEYWORDS: ReadonlyMap<string, number> = new Map(
  L.literalNames.flatMap((literal, type) =>
    literal && /^'[a-z-]+'$/.test(literal) ? [[literal.slice(1, -1), type] as const] : [],
  ),
);

const ROOT = /^\p{L}/u;
const COMMODITY = /^\p{L}[\p{L}0-9_.-]*$/u;
const ENTITY = /^[\p{L}_][\p{L}0-9_-]*$/u;
const ANCHOR = /^[\p{L}0-9_-]+$/u;
const SCOPE = /^[a-z-]+$/;
const ALIAS_BAD = /[\s0-9;",%#^@*×[\]{}=()+/]/u;

export function accountError(name: string): string | undefined {
  if (/[\s;",]/.test(name) || /^[%#^@]/.test(name)) return `"${name}" is not an account name`;
  const segments = name.split(":");
  if (segments.some((s) => s === "")) return `"${name}" has an empty segment`;
  return rootError(segments[0] ?? "");
}

export function rootError(root: string): string | undefined {
  if (!ROOT.test(root) || root.includes(":")) return `"${root}" is not an account root`;
  if (KEYWORDS.has(root)) return `"${root}" is a keyword and cannot be an account root`;
  return undefined;
}

export function commodityError(code: string): string | undefined {
  if (!COMMODITY.test(code)) return `"${code}" is not a commodity code`;
  return KEYWORDS.has(code) ? keywordError(code) : undefined;
}

const keywordError = (word: string): string =>
  `"${word}" is a keyword and cannot be a commodity code or alias`;

/**
 * An amount, price or cost as written, such as `5 NTD`, `5NTD` or `((100 + 50) * 2)NTD`: the word
 * that ends each of its pieces, a commodity code or suffix alias, must not be a keyword.
 */
export function amountError(text: string): string | undefined {
  for (const piece of text.split(/\s+/)) {
    const word = TRAILING_WORD.exec(piece)?.[0];
    if (word !== undefined && KEYWORDS.has(word)) return keywordError(word);
  }
  return undefined;
}

const TRAILING_WORD = /\p{L}[\p{L}0-9_.-]*$/u;

export const entityError = (id: string): string | undefined =>
  ENTITY.test(id) ? undefined : `"${id}" is not an entity`;

/** `entity` or `role:entity`. */
export function referenceError(text: string): string | undefined {
  const parts = text.split(":");
  if (parts.length > 2 || parts.some((p) => !ENTITY.test(p)))
    return `"@${text}" is not an entity reference`;
  return undefined;
}

export function anchorError(name: string): string | undefined {
  if (!ANCHOR.test(name)) return `"${name}" is not an anchor`;
  if (name === "self") return `"self" cannot be an anchor`;
  return undefined;
}

export const scopeError = (scope: string): string | undefined =>
  SCOPE.test(scope) ? undefined : `"${scope}" is not a tag scope`;

export function aliasError(text: string): string | undefined {
  if (text === "" || ALIAS_BAD.test(text) || /^[-.']/.test(text))
    return `"${text}" cannot be an alias`;
  return KEYWORDS.has(text) ? keywordError(text) : undefined;
}
