// Identifier rules (docs/dsl/lexical.md, "Identifiers"). Each check returns a message when the
// text breaks its rule; the caller reports it as parse.syntax,
// or anchor.invalid-name for an anchor.

import { HuekeLexer as L } from "./generated/HuekeLexer.js";

const KEYWORDS = new Set<string>();
for (const literal of L.literalNames)
  if (literal && /^'[a-z-]+'$/.test(literal)) KEYWORDS.add(literal.slice(1, -1));

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

export const commodityError = (code: string): string | undefined =>
  COMMODITY.test(code) ? undefined : `"${code}" is not a commodity code`;

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
  return undefined;
}
