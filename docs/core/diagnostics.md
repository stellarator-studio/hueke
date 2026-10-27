# Diagnostics

A **diagnostic** reports one problem in a ledger. Validation never throws: every problem is a diagnostic with a fixed code and severity, returned by `check`. This document lists every code, when it is reported and what happens to the faulty record, and the syntax that is read but not supported yet.

## Features

| Feature | Status |
| --- | --- |
| Diagnostics and severities | `implemented` |
| Codes | Per code, in the table below |
| Codes used only by the API | `implemented` |
| Unsupported syntax | `implemented` |

## Concepts

**Diagnostic**

| Field | Meaning |
| --- | --- |
| `code` | Such as `txn.unbalanced`. |
| `severity` | `error`, `warning` or `info`. |
| `message` | English text that includes the values involved. |
| `source`, `span` | The module and the place at fault: the record, line or declaration. |

## Behavior

### Diagnostics and severities

Status: `implemented`

- A code is `<area>.<name>`, both parts lowercase kebab-case. A code is never renamed once released.
- Each code has a fixed severity. `error`: a record does not hold, or the result cannot be trusted. `warning`: the result is computable but probably mistyped. `info`: a hint.
- Messages include the values involved, such as the asserted amount, the recorded amount and the difference.
- Other records keep loading when there are errors. What happens to the faulty record is listed under "On error":
  - **block not loaded**: a top-level line and every line it owns are dropped;
  - **record not loaded**: only that record is dropped; an error in a posting drops the whole transaction;
  - **skipped**: only the faulty part is dropped;
  - **computed as written**: the record counts as written, and the diagnostic only marks the problem.
- What happens when one thing is written twice is decided per kind: settings in [settings.md](settings.md), "Errors in settings"; declarations in [ledger.md](ledger.md), "Duplicate declarations". Declarations in included modules never take effect (see [modules.md](modules.md), "Declarations in included modules").

### Codes

| Code | Severity | When | On error | Status |
| --- | --- | --- | --- | --- |
| `parse.syntax` | error | Anything else that cannot be parsed, including an invalid `account-root`, `precision` or `alias` | Block not loaded | `implemented` |
| `parse.orphan-line` | error | A child line with nothing to belong to: any line before the first block, metadata in a block that accepts none, or a breakdown line before its block's first posting (see [../dsl/lexical.md](../dsl/lexical.md), "Ownership") | Line skipped; for a breakdown line, block not loaded | `implemented` |
| `parse.unexpected-property` | error | A property keyword that does not belong to the record, such as `precision` on an account or an item commodity, or a posting line under a Balance or a declaration that takes none (see [../dsl/lexical.md](../dsl/lexical.md), "Ownership") | Block not loaded | `implemented` |
| `parse.duplicate-property` | error | A single-valued property written twice | Block not loaded | `implemented` |
| `parse.token-order` | error | Tokens out of their fixed order, or a once-only part written twice (two `^`) | Block not loaded | `implemented` |
| `parse.unterminated-string` | error | A string that is not closed | Block not loaded | `implemented` |
| `parse.invalid-time` | error | A time wrong from its text alone (`2026-13`, `W54`, `T25:00`, a time with seconds), an unknown time zone, or an interval that ends before it starts | Block not loaded | `implemented` |
| `parse.invalid-number` | error | A number or amount that does not fit the ledger's marks, an alias on the wrong side, or an expression that cannot be read or divides by zero (see [values.md](values.md)); in a breakdown, `breakdown.invalid-figure` instead | Record not loaded | `implemented` |
| `parse.metadata-after-breakdown` | warning | Metadata after a breakdown line, at its end or on its own line (see [../dsl/lexical.md](../dsl/lexical.md), "Ownership") | Computed as written: it belongs to the posting | `implemented` |
| `option.unknown` | error | Unknown setting name | Line ignored | `implemented` |
| `option.duplicate` | error | Setting written more than once in the root module | All writings ignored; default used (see [settings.md](settings.md), "Errors in settings") | `implemented` |
| `option.invalid-value` | error | Setting value not allowed | Default used | `implemented` |
| `option.missing-timezone` | warning | No time zone is set at all (see [time.md](time.md), "Default time zone") | UTC used | `implemented` |
| `option.invalid-number-format` | error | `decimal-mark` and `group-mark` are both written, and are the same mark | Both defaults used | `implemented` |
| `option.invalid-root` | error | The name of the merged income and expense root equals an account root, built-in or declared, or the root of an account in use (see [accounts.md](accounts.md), "Combined income and expense") | The setting takes no effect | `implemented` |
| `time.nonexistent-local-time` | error | Local time skipped by daylight saving time | Record not loaded; on a posting's time, the whole transaction | `implemented` |
| `time.ambiguous-local-time` | error | Local time repeated by daylight saving time | Same | `implemented` |
| `time.nonexistent-week` | error | The week does not exist in that year under `week-start` | Same | `implemented` |
| `time.offset-mismatch` | error | A written UTC offset is not one the time zone has at that local time | Same | `implemented` |
| `commodity.alias-conflict` | error | An alias equals a declared commodity's code or another alias (see [commodities.md](commodities.md), "Commodity aliases") | Alias not used; records using it not loaded | `implemented` |
| `name.unknown-root` | info | An account's root is unknown (normal mode) | Computed; the account has no type | `implemented` |
| `name.inferred-commodity` | info | An undeclared commodity is used (normal mode) | Computed; precision inferred | `implemented` |
| `strict.undeclared` | error | Strict mode: an undeclared account or commodity is used | Computed as in normal mode | `implemented` |
| `strict.unknown-root` | error | Strict mode: a declared account's root is unknown | Computed; the account has no type | `implemented` |
| `declaration.duplicate` | error | The root module declares a commodity, account or account root again, in any mode | The first declaration is used; the later one is ignored | `implemented` |
| `txn.cleared-not-occurred` | error | A planned or cancelled transaction has a cleared posting | Loaded with status `none` | `implemented` |
| `txn.unbalanced` | error | Postings do not balance | Computed as written | `implemented` |
| `txn.amount-not-inferable` | error | More than one omitted amount, or the other weights are in several commodities | Transaction not loaded | `implemented` |
| `posting.pnl-effective` | error | An income or expense posting has its own effective time | Computed; the posting uses the transaction's time | `implemented` |
| `posting.invalid-effective` | error | The effective time a posting uses, its own or its transaction's, is not one day or one moment; the message says which | Transaction not loaded | `implemented` |
| `posting.excess-precision` | warning | More decimal places than the declared precision | Computed as written | `implemented` |
| `posting.signed-price` | warning | A price or cost is negative as written (see [values.md](values.md), "Prices and costs") | Computed without the sign | `implemented` |
| `breakdown.invalid-figure` | warning | A breakdown figure cannot be read (see [transactions.md](transactions.md), "Breakdowns") | The line keeps its name; its figures are skipped | `implemented` |
| `breakdown.commodity-mismatch` | error | A breakdown's unit price, total and posting amount are written in different commodities | Computed as written; the line is kept | `implemented` |
| `item.fractional` | error | A written posting amount in an item commodity is not a whole number | Computed as written | `implemented` |
| `item.invalid-balance` | error | An account holds a negative quantity of an item at some point, counting `occurred` transactions | Computed | `implemented` |
| `balance.mismatch` | error | A `hard` Balance differs from the computed balance beyond the tolerance, or a written pad does not close the difference | No record generated | `implemented` |
| `balance.invalid-effective` | error | A Balance's effective time is not one day: a week, month, year, interval or time of day | Record not loaded | `implemented` |
| `balance.pad-conflict` | error | Pads at the same point that affect each other, reported on each; or a pad whose counter-account is inside its own account (see [balance.md](balance.md), "Point-by-point expansion") | No record generated | `implemented` |
| `balance.pad-commodity` | error | A pad's written padding is not in the asserted commodity | No record generated | `implemented` |
| `balance.missing-pad-account` | error | A pad has no counter-account and the ledger has no `pad-account` | No record generated | `implemented` |
| `module.missing` | error | The root, or a module named by `include`, was not loaded | Root: the ledger is empty. `include`: ignored | `implemented` |
| `module.ignored-declaration` | warning | A declaration (`option`, `account-root`, `commodity`, `account`) stands in an included module; only the root's take effect | The declaration is ignored | `implemented` |
| `module.duplicate` | error | A module is included when it is already in the ledger (twice, or in a cycle) | The `include` is ignored | `implemented` |
| `path.invalid` | error | An `include` path is empty, names a folder or has a scheme (see [modules.md](modules.md), "Paths") | The `include` is ignored | `implemented` |
| `path.outside-root` | error | An `include` path resolves above the root directory | The `include` is ignored | `implemented` |
| `syntax.unsupported` | error | Syntax that is parsed but not supported yet; see "Unsupported syntax" | Record not loaded | `implemented` |

### Codes used only by the API

Status: `implemented`

Some API calls reject what they are given by throwing an error whose message names a code. These are misuses of the API, never problems of the ledger.

- A time given to the API that a ledger would reject throws with the code the ledger would report, such as `parse.invalid-time` or one of the `time.*` codes (see [time.md](time.md), "Times given to the API").
- One code is never reported by `check`, because it is valid in a ledger:

| Code | Thrown when |
| --- | --- |
| `query.time-of-day` | A query time has a time of day (see [time.md](time.md), "Times given to the API") |

### Unsupported syntax

Status: `implemented`

The parser reads the whole language. Syntax whose feature is not supported yet is reported as `syntax.unsupported` instead of being ignored, so a ledger is never computed as if the line were not there. The message names the syntax, such as `entity is not supported yet`.

| Syntax | Not loaded |
| --- | --- |
| `split` or `paid-by` under a posting; `share` or `into` under a transaction | The transaction |
| `@entity` on a `balance` line | The line |
| `account-root` of type `shared` | The declaration |
| An `account` with a `%anchor` after its name | The whole declaration |
| An `account` with `name`, `obligation`, `pad-account`, `active`, `allow`, `deny`, `statement`, `source`, `self` or `map` | The whole declaration |
| `entity`, `schedule`, `installment`, `rule`, `cap-group`, `module` | The declaration |

`include` is supported (see [modules.md](modules.md)).

## Examples

A file that starts with these lines, followed by the shared declarations:

```hueke
    Assets:Cash    -50 NTD

2026-10-12 * "Lunch"
    Expenses:Food     180 NTD
    Assets:Cash      -180 NTD

2026-10-13 * "Dinner
    Expenses:Food     300 NTD
    Assets:Cash      -300 NTD

2026-10-14 balance Assets:Cash

2026-10-15 * "Breakfast"
    Expenses:Food     80 NTD
    Assets:Cash      -80 NTD
```

`check` returns `parse.orphan-line` (line 1), `parse.unterminated-string` and `parse.syntax`, in that order. The other two transactions load, and the balance of `Assets:Cash` on 2026-10-15 is −260 NTD.
