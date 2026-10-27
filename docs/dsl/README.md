# The ledger file format

A ledger file is plain UTF-8 text with the extension `.hueke`, holding records, declarations and comments. This document gives the principles of the format, its symbols, what each piece of syntax becomes in the model, and how syntax for features not supported yet is handled; the other documents in this folder give the details.

## Features

| Feature | Status |
| --- | --- |
| Principles | `specified` |
| Symbols | `specified` |
| What syntax becomes | `specified` |
| Reserved syntax | `specified` |

## Concepts

**Records** are transactions and Balance assertions; **declarations** are settings, account roots, commodities, accounts and includes. The parser turns one file into its Raw model (see [../core/ledger.md](../core/ledger.md), "Concepts"); what the records mean is described in the core documents (see [../README.md](../README.md), "Documents"). The details of the format are in [lexical.md](lexical.md), [records.md](records.md) and [formatting.md](formatting.md).

## Behavior

### Principles

Status: `specified`

- One line holds one record header, posting, breakdown or property. After `;` comes metadata or a comment.
- **Structure does not depend on indentation.** Each line is classified by its first token and belongs to the nearest record that accepts it. Indentation is only for people; formatting rewrites it.
- **Each symbol has one job**: `%` defines an anchor (a transaction's or posting's ID), `#` and `^` refer to anchors or groups, `@` is used only for entities and prices. The exception: a lone `#` after a header's time means cancelled (see [lexical.md](lexical.md), "Symbol disambiguation").
- **Keywords take no colon**: a property is a keyword, a space and a value, such as `precision 2`.
- **Metadata follows `;;`** as `;; key: value`, on its own line or at the end of a line.
- **Numbers** use the ledger's decimal mark and group mark, the same in the whole ledger.
- **Token order is fixed** (see [records.md](records.md)).
- The order of records and declarations in a file does not change the result, except where source order is said to decide (such as IDs without an anchor).

### Symbols

Status: `specified`

An index of the symbols; where each may stand, and how symbols that look alike are told apart, is in [lexical.md](lexical.md), "Symbol disambiguation".

| Symbol | Meaning | Written in |
| --- | --- | --- |
| `*`, `!`, `#` after a header's time | Header mark: `*` sets the status (cleared); `!` and `#` set the occurrence (planned, cancelled) | [records.md](records.md), "Transaction headers" |
| `*` at the start of a posting line | This posting is cleared | [records.md](records.md), "Postings" |
| `=`, `..`, `[Zone]`, `±hh:mm` | Effective and accounting time, an interval, a time zone, a UTC offset | [records.md](records.md), "Time values" |
| `[time]` after a posting's amount | The posting's own effective time | [records.md](records.md), "Postings" |
| `"…"` | A string | [lexical.md](lexical.md), "Strings and values" |
| `%anchor` | Defines an anchor: the transaction's or posting's ID | [records.md](records.md), "Transaction headers", "Postings" |
| `#[scope:]anchor`, `^[tag:]anchor` | A tag, the primary tag | [records.md](records.md), "Transaction headers" |
| `@[role:]entity` | An entity reference | [records.md](records.md), "Transaction headers" |
| `@`, `@@`, `{…}`, `{{…}}` | Unit or total price, unit or total cost | [records.md](records.md), "Amounts" |
| `->` | The counter-account of a pad | [records.md](records.md), "Balance assertions" |
| `- ` at the start of a line | A breakdown line; inside it, `*` or `×` comes before the unit price and `=` before the total | [records.md](records.md), "Breakdowns" |
| `( … )` | Arithmetic in place of a number | [../core/values.md](../core/values.md), "Arithmetic" |
| `;; key:`, `;` | Metadata, a comment | [lexical.md](lexical.md), "Comments and metadata" |

### What syntax becomes

Status: `specified`

| Syntax | Becomes | Described in |
| --- | --- | --- |
| `option` | A ledger setting | [../core/settings.md](../core/settings.md) |
| `account-root` | An account root | [../core/accounts.md](../core/accounts.md), "Account roots" |
| `commodity` | A commodity, with precision, item mode, aliases and metadata | [../core/commodities.md](../core/commodities.md) |
| `account` | An account, with its primary commodity and metadata | [../core/accounts.md](../core/accounts.md) |
| `include` | Another module of the same ledger | [../core/modules.md](../core/modules.md) |
| A transaction header | A transaction; one with no postings is valid | [../core/transactions.md](../core/transactions.md) |
| `EFF[=ACC]` on a header, `[EFF]` on a posting | Effective and accounting times | [../core/time.md](../core/time.md), "Time axes" |
| A header mark, a posting's `*` | Occurrence and status | [../core/transactions.md](../core/transactions.md), "Status and occurrence" |
| `%anchor` | The transaction's or posting's ID | [../core/ledger.md](../core/ledger.md), "IDs" |
| `#[scope:]anchor`, `^anchor`, `@entity` | Tags, primary tag, references, kept as written | [../core/transactions.md](../core/transactions.md), "Parts kept as written" |
| `@`, `@@`, `{…}`, `{{…}}` | A posting's price and cost, as totals | [../core/values.md](../core/values.md), "Prices and costs" |
| `- ` lines | Breakdown lines | [../core/transactions.md](../core/transactions.md), "Breakdowns" |
| `;; key: value` | Metadata | [lexical.md](lexical.md), "Comments and metadata" |
| `balance` | A Balance assertion; with `pad`, also a generated transaction | [../core/balance.md](../core/balance.md) |

### Reserved syntax

Status: `specified`

Syntax whose features are not supported yet is parsed and reported as `syntax.unsupported`; what it is, and what is not loaded, is listed in [../core/diagnostics.md](../core/diagnostics.md), "Unsupported syntax". Its keywords are reserved (see [lexical.md](lexical.md), "Line classes"), so they cannot be account roots. A period may follow the anchor of a transaction header's `%anchor` or of a `#` tag, after `/`, as in `%rent/2026-11` or `#statement:card/2026-10`; on a posting's `%anchor` or a `^` primary tag it is `parse.syntax`. The period is a separate part, not part of the anchor's name, and it is kept as written. It is either a label, a year, month, day, week or quarter (`2026`, `2026-11`, `2026-11-05`, `2026-W45`, `2026-Q4`), or `n` and a period number from 1, without leading zeros (`n3`). A label shaped like a year, month, day or week that names no such time, such as `2026-13` or `2026-W54`, is `parse.invalid-time`, as for any time; anything else, such as `2026-Q5`, `n0`, `n01` or `t1`, is `parse.syntax`. Whether a week exists under the ledger's week start is not checked here.
