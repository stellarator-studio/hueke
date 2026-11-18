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
  shared: ["transaction"],
  system: ["transaction", "posting"],
};

/**
 * Reports every definition of an anchor after the first, in source order, and returns the anchors
 * defined more than once: none of their definitions defines them. Of the account declarations,
 * only those that took effect in `accounts` define anchors.
 */
export function duplicateAnchors(
  items: readonly SourcedItem[],
  accounts: ReadonlyMap<Id, Account>,
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
    } else if (item.kind === "account" && item.anchor && declaredAccount(accounts, item))
      define(item.anchor, source, item.span);
  }
  return duplicated;
}

/** Whether an account declaration is the one that took effect for its account. */
const declaredAccount = (accounts: ReadonlyMap<Id, Account>, item: DeclarationData): boolean =>
  accounts.get(item.args[0] ?? "")?.span === item.span;

/** A record that defines an anchor. */
type Definer =
  | { readonly kind: "transaction"; readonly transaction: Transaction }
  | { readonly kind: "posting"; readonly posting: Posting; readonly transaction: Transaction }
  | { readonly kind: "account"; readonly account: Account };

const idOf = (d: Definer): Id =>
  d.kind === "transaction" ? d.transaction.id : d.kind === "posting" ? d.posting.id : d.account.id;

/**
 * What `shared` anchors and tags may name (docs/core/anchors.md, "Scoped anchors"): the names of
 * this ledger's group ledgers, and the IDs that their anchored transactions convert to,
 * `shared:<name>:<anchor>`.
 */
export interface SharedNames {
  readonly groups: ReadonlySet<string>;
  readonly transactions: ReadonlySet<Id>;
}

const NO_GROUPS: SharedNames = { groups: new Set(), transactions: new Set() };

/**
 * The transactions with their tags and primary tags checked and resolved. Tags with a scope error
 * are skipped. `decimals` is moved to the new postings. A transaction defining `%shared:<name>`
 * for a group ledger this ledger does not have is reported.
 */
export function resolveTags(
  transactions: readonly Transaction[],
  accounts: Iterable<Account>,
  decimals: Map<Posting, number>,
  out: Diagnostic[],
  shared: SharedNames = NO_GROUPS,
): Transaction[] {
  const definers = new Map<string, Definer>();
  for (const t of transactions) {
    if (t.origin?.anchor && t.id === anchorKey(t.origin.anchor))
      definers.set(t.id, { kind: "transaction", transaction: t });
    for (const p of t.postings)
      if (p.origin?.anchor && p.id === anchorKey(p.origin.anchor))
        definers.set(p.id, { kind: "posting", posting: p, transaction: t });
  }
  for (const a of accounts)
    if (a.anchor !== undefined) definers.set(a.anchor, { kind: "account", account: a });

  return transactions.map((t) => {
    const at = (span: SourceSpan | undefined) => (code: Code, message: string) =>
      out.push(diagnostic(code, message, t.source, span));
    const anchor = t.origin?.anchor;
    if (anchor?.scope === "shared" && !shared.groups.has(anchor.name))
      at(t.span)(
        "shared.unknown-module",
        `%${anchorKey(anchor)}: this ledger has no group ledger named ${anchor.name}`,
      );
    const own = resolve(t.origin?.tags ?? [], "transaction", t.id, definers, shared, at(t.span));
    let primaryTarget: Id | undefined;
    let primaryDropped = false;
    const primary = t.origin?.primaryTag;
    if (primary) {
      const key = anchorKey(primary.ref);
      const definer = definers.get(key);
      if (primary.ref.scope === "shared" && !shared.groups.has(primary.ref.name)) {
        at(t.span)("tag.wrong-target", `^${key} must name a group ledger of this ledger`);
        primaryDropped = true;
      } else if (definer && definer.kind === "transaction" && idOf(definer) === t.id) {
        at(t.span)("tag.self-reference", `^${key} names its own transaction`);
        primaryDropped = true;
      } else if (definer) primaryTarget = idOf(definer);
    }
    const postings = t.postings.map((p) => {
      const tags = [
        ...resolve(p.origin?.tags ?? [], "posting", p.id, definers, shared, at(p.span)),
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
  shared: SharedNames,
  report: (code: Code, message: string) => void,
): Tag[] {
  const tags: Tag[] = [];
  for (const w of written) {
    const scope = w.scope ?? "tag";
    const key = anchorKey(w.ref);
    const text = w.ref.scope === undefined ? `#${scope}:${key}` : `#${key}`;
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
    if (scope === "shared" && w.ref.module !== undefined) {
      // `#shared:<name>:<anchor>` names a group transaction, in that group ledger's namespace.
      if (!shared.transactions.has(key))
        report(
          "tag.wrong-target",
          `${text} must name an anchored transaction of a group ledger of this ledger`,
        );
      else tags.push({ scope, ref: w.ref, target: key });
      continue;
    }
    if (scope === "shared" && !shared.groups.has(w.ref.name)) {
      report("tag.wrong-target", `${text} must name a group ledger of this ledger`);
      continue;
    }
    const definer = definers.get(key);
    if (definer && definer.kind === level && idOf(definer) === self) {
      report("tag.self-reference", `${text} names the ${level} it is written on`);
      continue;
    }
    if (scope === "refund" && !refundable(definer, self)) {
      report(
        "tag.wrong-target",
        `${text} must name an occurred transaction, or a posting of another occurred transaction`,
      );
      continue;
    }
    tags.push({ scope, ref: w.ref, ...(definer && { target: idOf(definer) }) });
  }
  return tags;
}

/**
 * Whether a refund tag written on the transaction `self` may name `definer`: an occurred
 * transaction, or a posting of an occurred transaction other than `self`.
 */
function refundable(definer: Definer | undefined, self: Id): boolean {
  if (definer?.kind === "transaction") return definer.transaction.occurrence === "occurred";
  if (definer?.kind === "posting")
    return definer.transaction.occurrence === "occurred" && definer.transaction.id !== self;
  return false;
}
