# Ledger settings

A **ledger setting** is written as `option <name> <value>` in the root module and applies to the whole ledger, across all its modules. Settings written in included modules do not take effect (see [modules.md](modules.md), "Declarations in included modules"). This document lists every setting with its values and default, what happens when a setting is wrong or written more than once, and how a platform changes a setting through text patches.

## Features

| Feature | Status |
| --- | --- |
| Settings | `implemented` |
| Errors in settings | `implemented` |
| Changing settings | `specified` |

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

### Changing settings

Status: `specified`

A platform changes a setting by asking Core for text patches to the root module and applying them (see [ledger.md](ledger.md), "Text patches"). Only the root module changes: settings written in included modules take no effect and are left as written.

- The value is given as it would be written after the setting's name, such as `account, entity` for `strict` or `on Flow` for `income-expense`, and is written as given.

| The root module | The change |
| --- | --- |
| Writes the setting once | That block is written again in canonical form with the new value (see [../dsl/formatting.md](../dsl/formatting.md)). Comments on its line and on the lines it owns stay |
| Writes it more than once | The first block takes the new value and the others are removed, so the new value takes effect |
| Does not write it | A line `option <name> <value>` is inserted right after the last `option` block of the root module. With no `option` block, it is inserted before the first block, after the comments at the top of the file, followed by a blank line; with no block at all, at the end of the file |
| Removing the setting | Every block that writes it is removed, with its line break, and the default takes effect again. A setting not written gives no patch |

- When the root module already reads exactly as it would after the change, no patch is returned.
- These are refused with an exception, and no patch is returned:
  - a name that is not a setting, which would be `option.unknown`;
  - a value that would be `option.invalid-value`;
  - a value that is empty, contains a line break or `;`, or starts or ends with whitespace, since it could not be read back as written.
- A value that is valid on its own but not in this ledger is written, and is reported by `check` once the changed module is loaded again: an `income-expense` name already taken (`option.invalid-root`), a `decimal-mark` equal to the `group-mark` (`option.invalid-number-format`), or a `pad-account` that names an unknown account.

## API

- `setOption(ledger, name, value)` [specified] returns the text patches that make the root module write `value` for the setting `name`; without `value`, those that remove every writing of it (see "Changing settings"). It throws before initialization, when the root module was never loaded, and on a refused name or value.

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

Changing settings. These cases do not load the shared declarations; the root module is `main.hueke`, and the result is its text after the patches are applied.

| `main.hueke` | Call | Result |
| --- | --- | --- |
| `option week-start monday` | `setOption(ledger, "week-start", "sunday")` | `option week-start sunday`; one patch, with `expect` `option week-start monday` plus its line break |
| `option timezone Asia/Tokyo  ; office` | `setOption(ledger, "timezone", "Asia/Taipei")` | `option timezone Asia/Taipei  ; office` |
| `option timezone UTC`, then `option timezone Asia/Tokyo` | `setOption(ledger, "timezone", "Asia/Taipei")` | `option timezone Asia/Taipei`; the second line is removed |
| `option timezone Asia/Taipei`, then `commodity NTD` | `setOption(ledger, "week-start", "sunday")` | `option week-start sunday` inserted right after the `timezone` line |
| `; my ledger`, a blank line, then `commodity NTD` | `setOption(ledger, "week-start", "sunday")` | `; my ledger`, a blank line, `option week-start sunday`, a blank line, then `commodity NTD` |
| `option week-start sunday`, then `commodity NTD` | `setOption(ledger, "week-start")` | Only `commodity NTD` remains; weeks start on Monday again |
| `option week-start sunday` | `setOption(ledger, "week-start", "sunday")` | No patch |
| `include accounts.hueke`, which writes `option week-start sunday` | `setOption(ledger, "week-start", "friday")` | `option week-start friday` inserted before the `include` line, followed by a blank line; `accounts.hueke` gets no patch |
| Anything | `setOption(ledger, "currency", "NTD")`, `setOption(ledger, "week-start", "funday")` or `setOption(ledger, "pad-account", "Expenses:Fees ; fees")` | Throws |
| `account-root Flow asset` | `setOption(ledger, "income-expense", "on Flow")` | `option income-expense on Flow` inserted; after loading it again, `check` reports `option.invalid-root` |
