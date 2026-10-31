// The derived model: what init() builds from the Raw model. Inheritance, name resolution and
// expansion are applied; system-generated records exist only here. Each record points back to the
// Raw record it came from through `origin`. Fields of later features are added with them.

import type { AnchorRef, BalanceData, PostingData, TransactionData } from "../raw/model.js";
import type { SourcePath, SourceSpan } from "../source/source.js";
import type { TimeValue, Weekday } from "../time/types.js";
import type { Amount, Decimal, Id } from "../values/types.js";
import type { NumberFormat } from "../values/number.js";

export type { Axis, Precision, TimeValue, Weekday } from "../time/types.js";
export type { Amount, Decimal, Id } from "../values/types.js";

export type Metadata = Readonly<Record<string, string>>;

// ---------- Values ----------

export interface CommodityAlias {
  readonly text: string;
  readonly position: "prefix" | "suffix";
}

export interface Commodity {
  readonly id: Id;
  readonly span?: SourceSpan; // absent when used without a declaration
  readonly item: boolean;
  readonly precision: number; // fixed at 0 for items
  /** `precision` was written; only then is posting.excess-precision reported. */
  readonly precisionWritten: boolean;
  readonly aliases: readonly CommodityAlias[];
  readonly meta: Metadata;
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
  readonly span?: SourceSpan; // absent when used without a declaration
  readonly type?: AccountType; // from the root; absent when the root is unknown
  readonly parent?: Id;
  readonly primaryCommodity?: Id;
  readonly meta: Metadata;
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

export type Status = "none" | "cleared";
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
  readonly origin?: PostingData; // absent on generated postings
  readonly transaction: Id;
  readonly account: Id;
  readonly amount: Amount;
  readonly price?: Amount; // total
  readonly cost?: Amount; // total
  readonly status: Status;
  readonly effective: TimeValue; // inherited from the transaction when not written
  readonly tags: readonly Tag[]; // own tags plus the transaction's
  readonly refs: readonly Reference[];
  readonly meta: Metadata;
  readonly breakdown: readonly Breakdown[];
}

export interface Transaction {
  readonly id: Id;
  readonly source?: SourcePath;
  readonly span?: SourceSpan;
  readonly origin?: TransactionData; // absent on generated transactions
  readonly effective: TimeValue;
  readonly accounting: TimeValue;
  readonly description?: string;
  readonly occurrence: Occurrence;
  readonly status: Status; // the default of its postings
  readonly primaryTag?: string;
  readonly tags: readonly Tag[];
  readonly refs: readonly Reference[];
  readonly meta: Metadata;
  readonly postings: readonly Posting[];
}

export interface Balance {
  readonly source?: SourcePath;
  readonly span?: SourceSpan;
  readonly origin?: BalanceData;
  readonly account: Id;
  readonly effective: TimeValue; // the point asserted: one day
  readonly accounting?: TimeValue; // for the transaction a pad generates
  readonly amount: Amount;
  readonly mode: "hard" | "pad";
  readonly pad?: Amount; // written padding on the asserted account
  readonly padPrice?: Amount; // total
  readonly padAccount?: Id;
  readonly meta: Metadata;
}

// ---------- Ledger ----------

export interface LedgerSettings {
  readonly timezone: string;
  readonly padAccount?: Id;
  readonly weekStart: Weekday;
  readonly strict: readonly ("account" | "commodity" | "entity")[];
  readonly incomeExpenseRoot?: string;
  readonly decimalMark: NumberFormat["decimalMark"];
  readonly groupMark: NumberFormat["groupMark"];
}
