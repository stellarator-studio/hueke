// Raw model: what one file says, as written. Serializes back to DSL text.
//
// - Plain immutable data: an edit returns a new ModuleData and reuses every unchanged object,
//   so write-back only has to compare object identity to find what changed.
// - Values keep their written form as strings; numbers, aliases and times are interpreted
//   after declarations are collected.
// - Only what is written: no inheritance, no derived or generated content.
// - Order is the array order, never recovered from spans. `span` is set by the parser and
//   is absent on nodes created by edits; it locates diagnostics and the text a patch replaces.
// - Blank lines and indentation are not kept.
//
// Naming: `<Derived>Data` for records and parts with a derived counterpart, `<Content>Line` for
// syntax-only line nodes, `<Owner>Child` for unions of those lines, `<Kind>Note` for notes.
// Values shared with the derived model (AnchorRef, SourceSpan, Diagnostic) take no suffix.

import type { Diagnostic, SourceSpan } from "../source/source.js";

// ---------- Metadata and comments ----------

export interface MetaNote {
  readonly kind: "meta";
  readonly key: string;
  readonly value: string; // unquoted
}

export interface CommentNote {
  readonly kind: "comment";
  readonly text: string; // after `;` and at most one following space
}

export type Note = MetaNote | CommentNote;

/** A whole-line Metadata or comment, kept where it was written among its siblings. */
export interface NoteLine {
  readonly kind: "note";
  readonly span?: SourceSpan;
  readonly note: Note;
}

/** Every line node can end with one trailing Metadata or comment. */
interface Line {
  readonly span?: SourceSpan;
  readonly trailer?: Note;
}

// ---------- Anchors and tags ----------

/**
 * One written Anchor, split into its parts. Definitions and references share this shape, so
 * every place that names the same Anchor has the same `anchorKey`.
 * - `%lunch`, `#lunch`: { name: "lunch" }
 * - `%esun-card/2026-10`, `#statement:esun-card/2026-10`: { name: "esun-card", period: "2026-10" }
 * - `#shared:trip:t1`: { module: "trip", name: "t1" }
 */
export interface AnchorRef {
  readonly name: string;
  readonly period?: string; // period key after a Cycle name, as written: "2026-10", "n3"
  readonly module?: string; // only in `#shared:<module>:<anchor>`
}

/** `#x`, `#scope:x`; also the primary tag `^x`, `^tag:x`. */
export interface TagData {
  readonly scope?: string; // as written; absent when the tag has no scope
  readonly ref: AnchorRef;
}

// ---------- Shared parts ----------

/** `{…}` / `@` is a unit value, `{{…}}` / `@@` a total. */
export interface PriceData {
  readonly kind: "unit" | "total";
  readonly amount: string;
}

/** Header parts after the anchor; also the def-tail of schedule, installment and rule. */
export interface HeaderTailData {
  readonly description?: string; // unquoted
  readonly refs: readonly string[]; // entity refs without `@`, e.g. "NAT", "person:NAT"
  readonly primaryTag?: TagData;
  readonly tags: readonly TagData[];
}

/** A key-to-end-of-line property: `precision 2`, `share @AMY 1`, `into Assets:Cash`. */
export interface PropertyLine extends Line {
  readonly kind: "property";
  readonly key: string;
  readonly value: string; // rest of the line, trimmed; "" when absent
  /** Only `statement` under `account`: its Cycle properties, `due` and `override`. */
  readonly children?: readonly ItemChild[];
}

/** A line under a record or a property. */
export type ItemChild = PropertyLine | NoteLine;

// ---------- Posting ----------

export interface BreakdownLine extends Line {
  readonly kind: "breakdown";
  readonly name: string; // unquoted
  readonly figure?: string; // the rest, e.g. "= 65", "3cups * 40 = 120"
}

export interface SplitMemberData {
  readonly who: string; // entity ref without `@`, or "self"
  readonly weight?: string;
  readonly times: boolean; // `×2` / `*2` rather than `2`
}

export interface SplitLine extends Line {
  readonly kind: "split";
  readonly members: readonly SplitMemberData[]; // empty when `table` is set
  readonly table?: AnchorRef; // `split <anchor>`
  readonly paidBy?: string;
  readonly into?: string;
}

export interface PaidByLine extends Line {
  readonly kind: "paid-by";
  readonly entity: string;
  readonly into?: string;
}

export type PostingChild = BreakdownLine | SplitLine | PaidByLine | NoteLine;

export interface PostingData extends Line {
  readonly cleared: boolean; // leading `*` on this line; not inherited
  readonly account: string;
  readonly amount?: string; // absent when the amount is omitted
  readonly cost?: PriceData;
  readonly price?: PriceData;
  readonly effective?: string; // only an explicit `[time]`
  /** Only in a template posting: `amount`, `-interest`, … in place of an amount. */
  readonly slot?: { readonly name: "amount" | "interest" | "fee"; readonly negated: boolean };
  readonly anchor?: AnchorRef;
  readonly refs: readonly string[];
  readonly tags: readonly TagData[];
  readonly lines: readonly PostingChild[];
}

// ---------- Items ----------

export interface TransactionData extends HeaderTailData, Line {
  readonly kind: "transaction";
  readonly effective: string; // as written
  readonly accounting?: string; // only an explicit `=ACC`
  readonly mark?: "*" | "!" | "#";
  readonly anchor?: AnchorRef; // `%anchor` or `%<name>/<period>`
  /** Lines before the first posting: `share`, `into` and notes. Later notes belong to postings. */
  readonly lines: readonly ItemChild[];
  readonly postings: readonly PostingData[];
}

export interface BalanceData extends Line {
  readonly kind: "balance";
  readonly time: string; // the effective time
  readonly accounting?: string;
  readonly account: string;
  readonly entity?: string;
  readonly amount: string;
  readonly pad?: {
    readonly amount?: string;
    readonly price?: PriceData;
    readonly account?: string;
  };
  readonly lines: readonly NoteLine[];
}

export type DeclarationKind =
  | "option"
  | "account-root"
  | "commodity"
  | "account"
  | "entity"
  | "schedule"
  | "installment"
  | "rule"
  | "module"
  | "include";

/** All declarations share one shape; properties are read per keyword after parsing. */
export interface DeclarationData extends Line {
  readonly kind: DeclarationKind;
  readonly args: readonly string[]; // declaration-line arguments, e.g. ["timezone", "Asia/Taipei"], ["2026.hueke"]
  readonly anchor?: AnchorRef; // account, schedule, installment, rule
  readonly tail?: HeaderTailData; // schedule, installment, rule
  readonly description?: string; // module
  readonly lines: readonly ItemChild[];
  readonly postings: readonly PostingData[]; // template postings
}

export type ItemData = TransactionData | BalanceData | DeclarationData;

// ---------- Module ----------

/** One file. An item's `span` covers its whole block: first line to its last owned line. */
export interface ModuleData {
  /** Comments before the first block; Metadata there is `parse.orphan-line`. */
  readonly comments: readonly (NoteLine & { readonly note: CommentNote })[];
  readonly items: readonly ItemData[];
  /** Offset where each line starts; lines and columns are computed from it (`position`). */
  readonly lineStarts: readonly number[];
  readonly diagnostics: readonly Diagnostic[]; // parse-stage diagnostics
}
