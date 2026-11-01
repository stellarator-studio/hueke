# Ledger settings

A **ledger setting** is written as `option <name> <value>` in the root module and applies to the whole ledger, across all its modules. Settings written in included modules do not take effect (see [modules.md](modules.md), "Declarations in included modules"). This document lists every setting with its values and default, and what happens when a setting is wrong or written more than once.

## Features

| Feature | Status |
| --- | --- |
| Settings | `implemented` |
| Errors in settings | `implemented` |

## Behavior

### Settings

Status: `implemented`

| Setting | Field | Values | Default | Described in |
| --- | --- | --- | --- | --- |
| `timezone` | `timezone` | An IANA name | The `timezone` given when creating the ledger, else UTC | [time.md](time.md), "Default time zone" |
| `pad-account` | `padAccount` | An account name, kept as written; it is not checked when read | None | [balance.md](balance.md), "`pad` assertions" |
| `week-start` | `weekStart` | `monday` … `sunday` | `monday` | [time.md](time.md), "Weeks" |
| `strict` | `strict` | Comma-separated kinds: `account`, `commodity`, `entity`; spaces around the commas are allowed. An empty value or an empty kind (`account,`) is `option.invalid-value` | None | [ledger.md](ledger.md), "Declarations and strict mode" |
| `income-expense` | `incomeExpenseRoot` | `on` or `on <name>`, such as `on Flow`; the name starts with a letter and contains no whitespace, `:`, `;`, `"` or `,`. Any other value is `option.invalid-value` | Off. The field holds the merged root's name, and is absent when off | [accounts.md](accounts.md), "Combined income and expense" |
| `decimal-mark` | `decimalMark` | `.` or `,` | `.`; `,` when `group-mark` is `.` (see "Errors in settings") | [values.md](values.md), "Numbers as written" |
| `group-mark` | `groupMark` | `,`, `.`, `'` or `none` (no group mark) | `,`; `.` when `decimal-mark` is `,` (see "Errors in settings") | [values.md](values.md), "Numbers as written" |

- The field is the setting's name in the ledger's `settings`.
- The value runs to the end of the line (see [../dsl/records.md](../dsl/records.md), "Declarations").

### Errors in settings

Status: `implemented`

- An unknown setting is `option.unknown`; the line is ignored.
- A setting written more than once in the root module is `option.duplicate`, reported on each writing after the first. **Every** writing of it is ignored in favor of the default, so the result never depends on order.
- An invalid value is `option.invalid-value`; the default is used.
- When only one of `decimal-mark` and `group-mark` takes effect, because the other is not written, or is invalid or written twice, the other's default changes so that the two differ (see the table). When both are written with the same mark, that is `option.invalid-number-format`, reported on `decimal-mark`; both fall back to `.` and `,`.
- A merged income and expense root whose name is already taken is `option.invalid-root` (see [accounts.md](accounts.md), "Combined income and expense").

## Examples

| Ledger text added to the shared declarations | `check` |
| --- | --- |
| `option currency NTD` | `option.unknown`, message names `currency` |
| `option timezone Asia/Tokyo` (a second `timezone`) | `option.duplicate`; the creation option or UTC is used |
| `option strict account, entity` | `strict` is `account` and `entity`; commodities follow normal mode |
| `option strict account,` | `option.invalid-value`; no strict mode |
| `option strict` | `option.invalid-value`: the value is empty |
| `option week-start funday` | `option.invalid-value`; weeks start on Monday |
| `option income-expense yes` | `option.invalid-value`; income and expenses are not merged |
| `option income-expense on Flow:Food` | `option.invalid-value`: the name contains `:` |
| `option group-mark none`, then `1,000 NTD` | `parse.invalid-number`; the transaction is not loaded. `1000 NTD` reads as 1000 |
| `option pad-account Nowhere:Else`, a transaction moving 180 NTD from `Assets:Cash` to `Expenses:Food`, and `2026-10-31 balance Assets:Cash 0 NTD pad` | No diagnostic about the setting. The pad generates `Assets:Cash` 180 NTD and `Nowhere:Else` −180 NTD, and `Nowhere:Else` is `name.unknown-root` |
