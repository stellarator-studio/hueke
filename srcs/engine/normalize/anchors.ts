// Normalization of anchors and tags (docs/core/anchors.md). Anchors are collected from the Raw
// records first, so that a duplicated anchor is no record's ID; once the records are built, each
// tag and primary tag is checked against its scope and resolved to the record its anchor names.

import type { Account, Id, Posting, Tag, Transaction } from "../../data/model/types.js";
import { anchorKey } from "../../data/raw/anchor.js";
import type { AnchorRef, DeclarationData, TagData } from "../../data/raw/model.js";
import type { Diagnostic, SourcePath, SourceSpan } from "../../data/source/source.js";
import { diagnostic, type Code } from "../../data/source/diagnostics.js";
import type { Where } from "./declarations.js";
import type { SourcedItem } from "./shared.js";

/** The scopes Core defines and where each may be written. */
const SCOPES: Readonly<Record<string, readonly ("transaction" | "posting")[]>> = {
  tag: ["transaction", "posting"],
  refund: ["transaction"],
  system: ["transaction", "posting"],
};

/**
 * Reports every definition of an anchor after the first, in source order, and returns the anchors
 * defined more than once: none of their definitions defines them. `declaredAccount` tells the
 * account declarations that took effect.
 */
export function duplicateAnchors(
  items: readonly SourcedItem[],
  declaredAccount: (item: DeclarationData) => boolean,
  where: Where,
  out: Diagnostic[],
): Set<string> {
  const first = new Map<string, { source: SourcePath; span: SourceSpan | undefined }>();
  const duplicated = new Set<string>();
  const define = (ref: AnchorRef, source: SourcePath, span: SourceSpan | undefined): void => {
    const key = anchorKey(ref);
    const earlier = first.get(key);
    if (!earlier) {
      first.set(key, { source, span });
      return;
    }
    duplicated.add(key);
    out.push(
      diagnostic(
        "anchor.duplicate",
        `%${key} is already defined at ${where(earlier.source, earlier.span)}; neither defines it`,
        source,
        span,
      ),
    );
  };
  for (const { item, source } of items) {
    if (item.kind === "transaction") {
      if (item.anchor) define(item.anchor, source, item.span);
      for (const p of item.postings) if (p.anchor) define(p.anchor, source, p.span);
    } else if (item.kind === "account" && item.anchor && declaredAccount(item))
      define(item.anchor, source, item.span);
  }
  return duplicated;
}

/** A record that defines an anchor. */
type Definer =
  | { readonly kind: "transaction"; readonly transaction: Transaction }
  | { readonly kind: "posting"; readonly posting: Posting }
  | { readonly kind: "account"; readonly account: Account };

const idOf = (d: Definer): Id =>
  d.kind === "transaction" ? d.transaction.id : d.kind === "posting" ? d.posting.id : d.account.id;

/**
 * The transactions with their tags and primary tags checked and resolved. Tags with a scope error
 * are skipped. `decimals` is moved to the new postings.
 */
export function resolveTags(
  transactions: readonly Transaction[],
  accounts: Iterable<Account>,
  decimals: Map<Posting, number>,
  out: Diagnostic[],
): Transaction[] {
  const definers = new Map<string, Definer>();
  for (const t of transactions) {
    if (t.origin?.anchor && t.id === anchorKey(t.origin.anchor))
      definers.set(t.id, { kind: "transaction", transaction: t });
    for (const p of t.postings)
      if (p.origin?.anchor && p.id === anchorKey(p.origin.anchor))
        definers.set(p.id, { kind: "posting", posting: p });
  }
  for (const a of accounts)
    if (a.anchor !== undefined) definers.set(a.anchor, { kind: "account", account: a });

  return transactions.map((t) => {
    const at = (span: SourceSpan | undefined) => (code: Code, message: string) =>
      out.push(diagnostic(code, message, t.source, span));
    const own = resolve(t.origin?.tags ?? [], "transaction", t.id, definers, at(t.span));
    let primaryTarget: Id | undefined;
    let primaryDropped = false;
    const primary = t.origin?.primaryTag;
    if (primary) {
      const definer = definers.get(anchorKey(primary.ref));
      if (definer && definer.kind === "transaction" && idOf(definer) === t.id) {
        at(t.span)("tag.self-reference", `^${anchorKey(primary.ref)} names its own transaction`);
        primaryDropped = true;
      } else if (definer) primaryTarget = idOf(definer);
    }
    const postings = t.postings.map((p) => {
      const tags = [
        ...resolve(p.origin?.tags ?? [], "posting", p.id, definers, at(p.span)),
        ...own,
      ];
      const posting: Posting = { ...p, tags };
      const d = decimals.get(p);
      if (d !== undefined) {
        decimals.delete(p);
        decimals.set(posting, d);
      }
      return posting;
    });
    const { primaryTag, ...rest } = t;
    return {
      ...rest,
      ...(primaryTag !== undefined && !primaryDropped && { primaryTag }),
      ...(primaryTarget !== undefined && { primaryTarget }),
      tags: own,
      postings,
    };
  });
}

function resolve(
  written: readonly TagData[],
  level: "transaction" | "posting",
  self: Id,
  definers: ReadonlyMap<string, Definer>,
  report: (code: Code, message: string) => void,
): Tag[] {
  const tags: Tag[] = [];
  for (const w of written) {
    const scope = w.scope ?? "tag";
    const key = anchorKey(w.ref);
    const text = `#${scope}:${key}`;
    if (scope === "system") {
      report("tag.reserved-scope", `${text}: the scope system is only for generated records`);
      continue;
    }
    const levels = SCOPES[scope];
    if (!levels) {
      report("tag.unknown-scope", `${text}: Core defines no scope "${scope}"`);
      continue;
    }
    if (!levels.includes(level)) {
      report("tag.wrong-level", `${text} cannot be written on a ${level}`);
      continue;
    }
    const definer = definers.get(key);
    if (definer && definer.kind === level && idOf(definer) === self) {
      report("tag.self-reference", `${text} names the ${level} it is written on`);
      continue;
    }
    if (
      scope === "refund" &&
      !(definer?.kind === "transaction" && definer.transaction.occurrence === "occurred")
    ) {
      report("tag.wrong-target", `${text} must name an occurred transaction`);
      continue;
    }
    tags.push({ scope, ref: w.ref, ...(definer && { target: idOf(definer) }) });
  }
  return tags;
}
