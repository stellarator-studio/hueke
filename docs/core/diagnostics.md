# Diagnostics

A **diagnostic** reports one problem in a ledger. Validation never throws: every problem is a diagnostic with a fixed code and severity, returned by `check`. This document lists every code, when it is reported and what happens to the faulty record, and the syntax that is read but not supported yet.

## Features

| Feature | Status |
| --- | --- |
| Diagnostics and severities | `implemented` |
| Codes | Per code, in the table below |
| Codes used only by the API | `implemented` |
| Codes returned with results | `specified` |
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
| `parse.duplicate-property` | error | A property that may not repeat written twice in one record (see [../dsl/lexical.md](../dsl/lexical.md), "Ownership") | Block not loaded | `implemented` |
| `parse.token-order` | error | Tokens out of their fixed order, or a once-only part written twice, other than `^` | Block not loaded | `implemented` |
| `txn.multiple-primary-tag` | error | A transaction header has more than one `^`, found by the parser (see [anchors.md](anchors.md), "Primary tags") | Block not loaded | `implemented` |
| `parse.unterminated-string` | error | A string that is not closed | Block not loaded | `implemented` |
| `parse.invalid-time` | error | A time wrong from its text alone (`2026-13`, `W54`, `T25:00`, a time with seconds), an unknown time zone, or an interval that ends before it starts | Block not loaded | `implemented` |
| `parse.invalid-number` | error | A number or amount that does not fit the ledger's marks, an alias on the wrong side, or an expression that cannot be read or divides by zero (see [values.md](values.md)); in a breakdown, `breakdown.invalid-figure` instead | Record not loaded | `implemented` |
| `parse.metadata-after-breakdown` | warning | Metadata after a breakdown line, at its end or on its own line (see [../dsl/lexical.md](../dsl/lexical.md), "Ownership") | Computed as written: it belongs to the posting | `implemented` |
| `option.unknown` | error | Unknown setting name | Line ignored | `implemented` |
| `option.duplicate` | error | Setting written more than once in the root module | All writings ignored; default used (see [settings.md](settings.md), "Errors in settings") | `implemented` |
| `option.invalid-value` | error | Setting value not allowed (see [settings.md](settings.md), "Errors in settings") | Default used | `implemented` |
| `option.missing-timezone` | warning | No time zone is set at all (see [time.md](time.md), "Default time zone") | UTC used | `implemented` |
| `option.invalid-number-format` | error | `decimal-mark` and `group-mark` are both written, and are the same mark (see [settings.md](settings.md), "Errors in settings") | Both defaults used | `implemented` |
| `option.invalid-root` | error | The name of the merged income and expense root is already a root (see [accounts.md](accounts.md), "Combined income and expense") | The setting takes no effect | `implemented` |
| `time.nonexistent-local-time` | error | Local time skipped by daylight saving time | Record not loaded; on a posting's time, the whole transaction | `implemented` |
| `time.ambiguous-local-time` | error | Local time repeated by daylight saving time | Same | `implemented` |
| `time.nonexistent-week` | error | The week does not exist in that year under `week-start` | Same | `implemented` |
| `time.offset-mismatch` | error | A written UTC offset is not one the time zone has at that local time | Same | `implemented` |
| `commodity.alias-conflict` | warning | An alias equals a declared commodity's code or another alias (see [commodities.md](commodities.md), "Commodity aliases") | Alias not loaded; amounts are read as if it were never declared | `implemented` |
| `name.unknown-root` | info | An account's root is unknown (normal mode) | Computed; the account has no type | `implemented` |
| `name.inferred-commodity` | info | An undeclared commodity is used (normal mode) | Computed; precision inferred | `implemented` |
| `strict.undeclared` | error | Strict mode: an undeclared account, commodity or entity is used | Computed as in normal mode | `implemented` |
| `strict.unknown-root` | error | Strict mode: a declared account's root is unknown | Computed; the account has no type | `implemented` |
| `declaration.duplicate` | error | The root module declares a commodity, account, account root or entity again, in any mode | The first declaration is used; the later one is ignored | `implemented` |
| `name.unknown-role` | error | A reference has a role Core does not define (see [entities.md](entities.md), "References and roles") | Skipped: the reference is dropped | `implemented` |
| `anchor.invalid-name` | error | An anchor after `%`, `#[scope:]` or `^` breaks the rules for anchor names, found by the parser (see [../dsl/lexical.md](../dsl/lexical.md), "Identifiers") | Block not loaded | `implemented` |
| `anchor.duplicate` | error | An anchor is defined more than once in the ledger, reported on each definition after the first (see [anchors.md](anchors.md), "Anchors") | Skipped: no definition defines the anchor; tags naming it are plain | `implemented` |
| `tag.unknown-scope` | error | A tag's scope is not defined by Core (see [anchors.md](anchors.md), "Scopes") | Skipped: the tag is dropped | `implemented` |
| `tag.reserved-scope` | error | A `system` tag is written in a ledger | Skipped: the tag is dropped | `implemented` |
| `tag.wrong-level` | error | A tag is written where its scope may not stand | Skipped: the tag is dropped | `implemented` |
| `tag.wrong-target` | error | A tag's anchor does not name the record its scope needs, or names none when one is needed | Skipped: the tag is dropped | `implemented` |
| `tag.self-reference` | error | A tag names the record it is written on | Skipped: the tag is dropped | `implemented` |
| `txn.cleared-not-occurred` | error | A planned or cancelled transaction has a cleared posting | Loaded with status `none` | `implemented` |
| `txn.unbalanced` | error | Postings do not balance | Computed as written | `implemented` |
| `txn.amount-not-inferable` | error | More than one omitted amount, or the other weights are in several commodities | Transaction not loaded | `implemented` |
| `posting.pnl-effective` | error | An income or expense posting has its own effective time | Computed; the posting uses the transaction's time | `implemented` |
| `posting.invalid-effective` | error | The effective time a posting uses, its own or its transaction's, is not one day or one moment; the message says which | Transaction not loaded | `implemented` |
| `posting.excess-precision` | warning | More decimal places than the declared precision | Computed as written | `implemented` |
| `obligation.missing-entity` | error | No posting of an obligation names anyone; reported once per obligation (see [obligations.md](obligations.md), "Entities of an obligation") | Computed as written | `implemented` |
| `obligation.root-posting` | error | A posting is on an obligation account itself, not on an obligation | Computed as written; it belongs to no obligation | `implemented` |
| `obligation.nested` | error | A posting, an `account` declaration or a Balance is on an account inside an obligation, or an account inside an obligation account declares `obligation` (see [obligations.md](obligations.md), "Obligation accounts") | Computed as written; a posting there belongs to no obligation, and the inner `obligation` takes no effect | `implemented` |
| `obligation.unlinked-commodity` | warning | One obligation has several commodities, and none of its postings has a price or a cost (see [obligations.md](obligations.md), "Progress") | Computed as written | `implemented` |
| `refund.exceeds` | warning | The refunds of a transaction or posting exceed the original amount on one or more of its accounts; once per refunded transaction or posting (see [anchors.md](anchors.md), "Refunds") | Computed as written | `implemented` |
| `posting.commodity-not-allowed` | error | A posting's commodity is denied by its account, or not among those it allows (see [accounts.md](accounts.md), "Allowed commodities") | Computed as written | `specified` |
| `account.commodity-conflict` | error | An account both allows and denies one commodity, or its `primary` commodity is not allowed | The whole declaration is not loaded | `specified` |
| `account.inactive` | error | A posting's effective time is outside its account's `active` period (see [accounts.md](accounts.md), "Active periods") | Computed as written | `specified` |
| `split.exceeds` | error | A split's member amounts add up to more than the posting (see [generators.md](generators.md), "Splits") | The split is not expanded; the posting counts as written | `specified` |
| `split.zero-ratio` | error | The ratios of a split, a split table or a group ledger's default shares add up to zero while an amount remains to share | The split is not expanded; for a group ledger's default shares, none of its transactions converts | `specified` |
| `split.missing-account` | error | A split or `paid-by` has no obligation: none written, and no table gives one (see [generators.md](generators.md), "Split tables") | The split is not expanded | `specified` |
| `split.not-obligation` | error | A split's or `paid-by`'s `->` is not an obligation, or is one of the wrong direction | The split is not expanded | `specified` |
| `split.unknown-table` | error | `split <anchor>` names no transaction with a split table | The split is not expanded | `specified` |
| `split.table-with-postings` | error | A transaction with postings has a split table | The table is ignored; the postings count | `specified` |
| `split.input-amount-omitted` | error | A `split` or `paid-by` stands under a posting whose amount is omitted | Transaction not loaded | `specified` |
| `rule.segment-overlap` | error | Two segments of one rule overlap (see [generators.md](generators.md), "Per-posting rules") | The rule produces nothing | `specified` |
| `rule.amount-missing` | error | A rule segment has both `rate` and `fixed`, or neither | The rule produces nothing | `specified` |
| `rule.cap-group-unknown` | error | A rule's `cap-group` names no rule | The rule produces nothing | `specified` |
| `rule.cap-group-chain` | error | A rule's `cap-group` names a rule that has a `cap-group` itself | The rule produces nothing | `specified` |
| `rule.input-commodity` | error | An input is not in the commodity a rate takes, as `NTD` in `1 MILE per 30 NTD` | That input produces nothing | `specified` |
| `rule.input-amount-omitted` | error | A posting tagged `#rule:` omits its amount | Transaction not loaded | `specified` |
| `template.unknown-slot` | error | A posting template uses a slot its kind does not have (see [generators.md](generators.md), "Posting templates") | The rule produces nothing | `specified` |
| `template.missing-slot` | error | A rule's template never uses `amount` | The rule produces nothing | `specified` |
| `posting.signed-price` | warning | A price or cost is negative as written (see [values.md](values.md), "Prices and costs") | Computed without the sign | `implemented` |
| `breakdown.invalid-figure` | warning | A breakdown figure cannot be read (see [transactions.md](transactions.md), "Breakdowns") | The line keeps its name; its figures are skipped | `implemented` |
| `breakdown.commodity-mismatch` | error | A breakdown line's unit price and total are written in different commodities, or in one not written on its posting's amount, price or cost (see [transactions.md](transactions.md), "Breakdowns") | Computed as written; the line is kept | `implemented` |
| `item.fractional` | error | A written posting amount in an item commodity is not a whole number | Computed as written | `implemented` |
| `item.invalid-balance` | error | An account holds a negative quantity of an item at some point, counting `occurred` transactions | Computed | `implemented` |
| `balance.mismatch` | error | A `hard` Balance differs from the computed balance beyond the tolerance, or a written pad does not close the difference | No record generated | `implemented` |
| `balance.invalid-effective` | error | A Balance's effective time is not one day: a week, month, year, interval or time of day | Record not loaded | `implemented` |
| `balance.pad-conflict` | error | Pads at the same point that affect each other, reported on each; or a pad whose counter-account is inside its own account (see [balance.md](balance.md), "Point-by-point expansion") | No record generated | `implemented` |
| `balance.pad-commodity` | error | A pad's written padding is not in the asserted commodity | No record generated | `implemented` |
| `balance.missing-pad-account` | error | A pad has no counter-account: the pad names none, and neither the account nor the ledger has a `pad-account` | No record generated | `implemented` |
| `balance.pad-needs-amount` | error | A pad on an obligation account, an obligation, an account inside one, or a shared account [specified] does not write its padding (see [balance.md](balance.md), "Obligations in Balance assertions", "Shared accounts in Balance assertions") | No record generated | `implemented` |
| `balance.obligation-entity` | error | A Balance on an obligation account or inside one has an entity, other than a pad on one obligation (see [balance.md](balance.md), "Obligations in Balance assertions") | Record not loaded | `implemented` |
| `balance.ambiguous` | error | A pad on an obligation account itself, not on one obligation | No record generated | `implemented` |
| `module.missing` | error | The root, or a module named by `include`, was not loaded | Root: the ledger is empty. `include`: ignored | `implemented` |
| `module.ignored-declaration` | warning | A declaration (`option`, `account-root`, `commodity`, `account`, `entity`) stands in an included module; only the root's take effect | The declaration is ignored | `implemented` |
| `module.duplicate` | error | A module is included when it is already in the ledger (twice, or in a cycle); or a module is both included and referred to, or referred to twice [specified] (see [modules.md](modules.md), "Referenced modules") | The `include` is ignored; a module referred to: no `include` or `source` naming it takes effect | `implemented` |
| `module.missing-declaration` | error | A referenced module does not start with exactly one `module` declaration | The module is not loaded | `specified` |
| `include.module-file` | error | An included module has a `module` declaration | The `include` is ignored | `specified` |
| `module.forbidden-record` | error | A record its module's kind does not allow, such as a Balance in a group ledger; a module referring to other modules; a `module` declaration in the root | Record not loaded | `specified` |
| `module.name-conflict` | error | Two group ledgers have the same name in a ledger | Neither converts | `specified` |
| `shared.wrong-account` | error | `source`, `self` or `map` on an account whose type is not `shared` | Skipped: those properties are ignored | `specified` |
| `shared.missing-source` | error | A shared account has no `source` or no `self` (see [group-ledgers.md](group-ledgers.md), "Shared accounts") | The account loads; nothing converts | `specified` |
| `shared.unknown-module` | error | A shared account's `source` names no loaded group ledger, or `self` is not one of its members | The account loads; nothing converts | `specified` |
| `shared.invalid-split` | error | A split in a group ledger has `self`, a table, `paid-by` or `->` | Skipped: the posting is shared by the default ratios | `specified` |
| `shared.missing-member` | error | A member-money posting in a group ledger names no entity | The group transaction does not convert | `specified` |
| `shared.unknown-member` | error | A member-money posting names an entity that is not a member | The group transaction does not convert | `specified` |
| `shared.unmapped-account` | error | Conversion needs a group account that no mapping maps | The group transaction does not convert | `specified` |
| `shared.payment-mismatch` | error | An actual payment's postings on the shared account differ from the owner's money in the group transaction (see [group-ledgers.md](group-ledgers.md), "Actual payments") | Computed as written; it still replaces | `specified` |
| `shared.multiple-replacement` | error | Several transactions are the actual payment for one group transaction | Computed as written; the conversion is still replaced | `specified` |
| `path.invalid` | error | An `include` or `source` [specified] path is empty, names a folder or has a scheme (see [modules.md](modules.md), "Paths") | The `include` or `source` is ignored | `implemented` |
| `path.outside-root` | error | An `include` or `source` [specified] path resolves above the root directory | The `include` or `source` is ignored | `implemented` |
| `syntax.unsupported` | error | Syntax that is parsed but not supported yet; see "Unsupported syntax" | Record not loaded | `implemented` |

### Codes used only by the API

Status: `implemented`

Some API calls reject what they are given by throwing an error whose message names a code. These are misuses of the API, never problems of the ledger.

- A time given to the API that a ledger would reject throws with the code the ledger would report, such as `parse.invalid-time` or one of the `time.*` codes (see [time.md](time.md), "Times given to the API").
- These codes are never reported by `check`, because what they reject is valid in a ledger:

| Code | Thrown when |
| --- | --- |
| `query.time-of-day` | A query time has a time of day (see [time.md](time.md), "Times given to the API") |
| `query.tag-without-scope` | A tag given to the `tags` clause as text has no scope, such as `travel` instead of `tag:travel` (see [query.md](query.md), "Filtering") |

### Codes returned with results

Status: `specified`

Some views return diagnostics with their result, about that result only. They depend on what was asked, so `check` never returns them.

| Code | Severity | When | Result |
| --- | --- | --- | --- |
| `valuation.missing-price` | warning | No price path leads from a commodity to the quote (see [valuation.md](valuation.md), "Prices from the ledger") | That commodity is not valued |
| `valuation.incomplete-cost` | warning | A posting's cost is not in the quote, or cannot be known, and is not converted (see [valuation.md](valuation.md), "Cost and gains") | Cost and average cost are absent until the quantity returns to zero |
| `valuation.negative-position` | warning | The quantity held is below zero | No cost or gain while it is |

### Unsupported syntax

Status: `implemented`

The parser reads the whole language. Syntax whose feature is not supported yet is reported as `syntax.unsupported` instead of being ignored, so a ledger is never computed as if the line were not there. The message names the syntax, such as `schedule is not supported yet`.

| Syntax | Not loaded |
| --- | --- |
| A tag with the scope `installment`, `statement` or `fulfills`, on a transaction or one of its postings | The transaction |
| A period after an anchor: on a header's `%anchor`, or on a tag (`#x/2026-10`, `#statement:card/n3`) | The transaction |
| An `account` with `statement` | The whole declaration |
| An `entity` with `type` | The whole declaration |
| `schedule`, `installment` | The declaration |
| A `rule` with `follows` or `every`; with `per <anchor>` as a window; with `@`, `^` or `#` on its header | The declaration |

`include` is supported (see [modules.md](modules.md)). This list is `specified`: until they are implemented, splits, `paid-by`, split tables (`share`, `into`), per-posting rules, `module`, `account-root` of type `shared`, the account properties `active`, `allow`, `deny`, `source`, `self` and `map`, and the scopes `rule` and `shared` are also `syntax.unsupported`.

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
