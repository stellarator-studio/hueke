// The derived model: what init() builds from the Raw model. Names are resolved, prices are totals
// and omitted amounts are filled in. Each record points back to the Raw record it came from
// through `origin`. Fields of later features are added with them.

import type { AnchorRef, PostingData, TransactionData } from "../raw/model.js";
import type { SourcePath, SourceSpan } from "../source/source.js";
import type { TimeValue } from "../time/types.js";
import type { Amount, Decimal, Id } from "../values/types.js";

export type { Precision, TimeValue } from "../time/types.js";
export type { Amount, Decimal, Id } from "../values/types.js";

export type Metadata = Readonly<Record<string, string>>;

// ---------- Values ----------

export interface Commodity {
  readonly id: Id;
  readonly span?: SourceSpan; // absent when used without a declaration
  readonly precision: number; // 0 unless declared
  /** `precision` was declared; only then is posting.excess-precision reported. */
  readonly precisionWritten: boolean;
}

// ---------- Accounts ----------

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

export interface AccountRoot {
  readonly name: string;
  readonly type: AccountType;
  readonly builtin: boolean;
}

export interface Account {
  readonly id: Id; // the full name, e.g. "Bank:Checking"
  readonly type?: AccountType; // from the root; absent when the root is unknown
  readonly parent?: Id;
}

// ---------- Tags and references ----------

export interface Tag {
  readonly scope: string; // "tag" unless written
  readonly ref: AnchorRef;
}

export interface Reference {
  readonly role: string; // "person" when omitted
  readonly entity: Id;
}

// ---------- Transactions ----------

export type Occurrence = "occurred" | "planned" | "cancelled";

/** A number written in a breakdown, with its commodity when one is written. */
export interface Figure {
  readonly value: Decimal;
  readonly commodity?: Id;
}

/** Kept as written; Core never computes with it (docs/core/transactions.md, "Breakdowns"). */
export interface Breakdown {
  readonly name: string;
  readonly quantity?: { readonly value: Decimal; readonly unit?: string };
  readonly unitPrice?: Figure;
  readonly total?: Figure;
}

export interface Posting {
  readonly id: Id;
  readonly span?: SourceSpan;
  readonly origin: PostingData;
  readonly transaction: Id;
  readonly account: Id;
  readonly amount: Amount;
  readonly price?: Amount; // total
  readonly cost?: Amount; // total
  readonly tags: readonly Tag[]; // own tags plus the transaction's
  readonly refs: readonly Reference[];
  readonly meta: Metadata;
  readonly breakdown: readonly Breakdown[];
}

export interface Transaction {
  readonly id: Id;
  readonly source: SourcePath;
  readonly span?: SourceSpan;
  readonly origin: TransactionData;
  readonly time: TimeValue;
  readonly description?: string;
  readonly occurrence: Occurrence; // only occurred transactions count
  readonly primaryTag?: string;
  readonly tags: readonly Tag[];
  readonly refs: readonly Reference[];
  readonly meta: Metadata;
  readonly postings: readonly Posting[];
}

// ---------- Ledger ----------

export interface LedgerSettings {
  readonly timezone: string;
}
