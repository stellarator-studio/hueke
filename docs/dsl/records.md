# Records and declarations

Each record and declaration is written as a fixed sequence of parts. This document gives that sequence for time values, amounts, transaction headers, postings, breakdowns, Balance assertions, declarations and `include`.

## Features

| Feature | Status |
| --- | --- |
| Time values | `implemented` |
| Amounts | `implemented` |
| Transaction headers | `implemented` |
| Postings | `implemented` |
| Breakdowns | `implemented` |
| Balance assertions | `implemented` |
| Declarations | `implemented` |
| `include` | `implemented` |

## Concepts

Each record is written as a fixed sequence of parts. Parts in brackets below are optional; `…` means the part may repeat. A part out of its order, or a once-only part written twice, is `parse.token-order`.

What each part means is described in the core documents (see [../README.md](../README.md), "Documents"). How numbers and aliases are read depends on settings and declarations, so the parser keeps amounts and times as text, and they are read during normalization.

## Behavior

### Time values

Status: `implemented`

| Written | Form |
| --- | --- |
| `2026`, `2026-10`, `2026-W45`, `2026-10-11` | A date: a year, a month, a week or a day |
| `2026-10-11T14:30` | A date with a time of day, to the minute; seconds are not written |
| `2026-11-01T01:30-04:00` | A time of day followed by its UTC offset |
| `<point>[Asia/Tokyo]` | A point followed by a time zone in brackets |
| `<point>..<point>` | An interval; each point may have its own zone |
| `<time>=<time>` | Only in a transaction header or a Balance assertion: effective time, then accounting time |

- A time value contains no whitespace.
- A UTC offset comes after the time of day and before the zone, and only with a time of day.
- What each form means, its precision and interval, and which values are rejected, are described in [../core/time.md](../core/time.md), "Time values" and "Daylight saving time".

### Amounts

Status: `implemented`

| Written | Meaning |
| --- | --- |
| `180 NTD`, `180NTD` | The code after the number, with or without whitespace |
| `NT$180`, `NT$ 180` | A prefix alias before the number, joined or separated by one space |
| `180dollars`, `180 dollars` | A suffix alias after the number, joined or separated by one space |
| `-NT$180`, `-180dollars` | The minus sign always comes first |
| `1,500.25 USD` | Group and decimal marks as set for the ledger |
| `(1000/3) NTD`, `((100 + 50) * 2)NTD` | An expression in parentheses in place of the number |

- How numbers, marks and expressions are read is described in [../core/values.md](../core/values.md), "Numbers as written" and "Arithmetic"; how aliases are read, in [../core/commodities.md](../core/commodities.md), "Commodity aliases".
- Prices and costs:

| Written | Meaning |
| --- | --- |
| `1000 USD @ 32.10 NTD` | Unit price |
| `1000 USD @@ 32100 NTD` | Total price |
| `10 AAPL {150 USD}` | Unit cost |
| `10 AAPL {{1500 USD}}` | Total cost |
| `-5 AAPL {150 USD} @ 170 USD` | Cost first, then price |

- Prices and costs carry no sign, even when the quantity is negative (see [../core/values.md](../core/values.md), "Prices and costs"). Unmatched braces (`{150 USD}}`) are `parse.syntax`.

### Transaction headers

Status: `implemented`

```text
<time>[=<time>] [*|!|#] [%anchor] ["description"] [@entity …] [^anchor] [#tag …]
```

- Only the time is required.
- At most one header mark: none (recorded, not checked), `*` (status cleared), `!` (occurrence planned) or `#` (occurrence cancelled). Two marks are `parse.token-order`.
- At most one `%anchor`, at most one `^`; any number of `@` references and `#` tags, in that order. A second `^` is `txn.multiple-primary-tag`, reported by the parser, and the block is not loaded.
- `^tag:x` is the same as `^x`; a primary tag with another scope is `parse.syntax`.
- `#scope:x` gives a tag a scope; `#x` is `#tag:x`. `#shared:<module>:x` names the anchor `x` of another module. `@role:x` gives a reference a role; `@x` is `@person:x`.

### Postings

Status: `implemented`

```text
[*] <account> [<amount> [{cost} | {{cost}}] [@ price | @@ price]] [[<time>]] [%anchor] [@entity …] [#tag …]
```

- A posting line starts with the account, optionally preceded by `*` (cleared). `!` or `#` there is `parse.syntax`.
- The amount may be left out, at most once per transaction (see [../core/transactions.md](../core/transactions.md), "Filling in an omitted amount"). The account is then followed directly by the time, anchor, references or tags.
- `[<time>]` is the posting's own effective time. Its point may carry a zone: `[2026-06-02T09:00[Asia/Tokyo]]`.
- A posting's `%anchor` takes no period; a period there is `parse.syntax`.

### Breakdowns

Status: `implemented`

```text
- <name>  [<quantity>[unit]] [* <unit price>] [= <total>]
```

```hueke
        - Bubble tea  3 cups * 40 NTD = 120 NTD  ; half sugar
        - Toast  = 65 NTD
        - Apples  3kg
        - Napkins
```

- The name is required and is not empty; a breakdown line without one, such as `-` alone or `- ""`, is `parse.syntax`. It may contain single spaces; what follows is separated from it by two or more spaces or a tab. A name that contains `;` or two spaces in a row, or starts with `"`, is quoted: `- "Rice; large"  = 50`. After a quoted name, one space or tab is enough; anything else right after the closing quote is `parse.syntax`.
- Whitespace separates `-` from an unquoted name; a quoted name may follow `-` directly: `-"Rice; large"  = 50`. Anything else right after `-`, such as `-%x`, is `parse.syntax`.
- The quantity is a number, and may be negative. A unit may follow it, joined or after whitespace: `3cups`, `3 cups`. The unit is one word of letters and only a label, never a commodity.
- The unit price follows `*` or `×`; the total follows `=`. Each is a number with an optional commodity code or alias, written as an amount (see "Amounts") but without an expression. Spaces around `*`, `×` and `=` are optional.
- The parts keep this order; each may be left out. What they mean, and figures that cannot be read, are described in [../core/transactions.md](../core/transactions.md), "Breakdowns".
- A breakdown line belongs to the posting above it (see [lexical.md](lexical.md), "Ownership").
- A comment may end the line. Metadata after a breakdown line is described in [lexical.md](lexical.md), "Ownership".

### Balance assertions

Status: `implemented`

```text
<time>[=<time>] balance <account> [@entity] <amount> [pad [<padding> [@ price | @@ price]] [-> <counter-account>]]
```

- The effective time is one day; an accounting time may follow after `=` (see [../core/balance.md](../core/balance.md), "Balance assertions").
- The amount is signed; with `pad`, it is the balance after padding.
- After `pad`, a number or alias is the padding (signed, on the asserted account); `->` names the counter-account. Both are optional.
- `@entity` limits the assertion to one entity (see [../core/balance.md](../core/balance.md), "Entities in Balance assertions"). At most one; a second is `parse.syntax`. `@person:entity` is the same as `@entity`, and any other role is `name.unknown-role`, as on any reference. On obligations, only a pad on one obligation takes an entity (see [../core/balance.md](../core/balance.md), "Obligations in Balance assertions").
- A Balance takes metadata but no tags; a tag is `parse.syntax`.

```hueke
2026-10-25 balance Bank:Checking 12345 NTD
2026-10-25 balance Bank:Checking 12345 NTD pad -> Expenses:ReconcileDiff
2026-10-25 balance Bank:Checking 12345 NTD pad 45 NTD -> Expenses:ReconcileDiff
2026-10-31 balance Liabilities:CreditCard -3200 NTD
    ;; document: statements/card-2026-10.pdf
2026-10-31 balance Bank:Checking @acme 52000 NTD
2026-10-20 balance Assets:Receivable:lunch-1011 0 NTD pad -50 NTD -> Expenses:Discount
```

### Declarations

Status: `implemented`

| Declaration | Written | Child lines |
| --- | --- | --- |
| Setting | `option <name> <value>`; the value runs to the end of the line | None |
| Account root | `account-root <name> <type>` | None |
| Commodity | `commodity <code>` | `item` (no value), `precision <whole number>`, `alias <text> prefix` or `alias <text> suffix` (may repeat), metadata |
| Account | `account <name> [%anchor]` | `display-name <text>`, `obligation receivable` or `obligation payable`, `pad-account <account>`; `primary <commodity>`; metadata |
| Entity | `entity <id>` | `display-name <text>`, metadata; `type` is reserved (see [../core/diagnostics.md](../core/diagnostics.md), "Unsupported syntax") |
| Include | `include <path>`; the path is one token | None |

- Declarations have no time; their order does not matter. Only the root module's declarations take effect (see [../core/modules.md](../core/modules.md), "Declarations in included modules").
- The settings and their values are listed in [../core/settings.md](../core/settings.md), "Settings".
- `precision` must be a whole number without marks, and `alias` must have exactly a text and `prefix` or `suffix`; otherwise `parse.syntax`, and the declaration is not loaded.
- `display-name` runs to the end of the line and may contain spaces; with no text, it is `parse.syntax`, and the declaration is not loaded. `obligation` takes exactly `receivable` or `payable`, `pad-account` exactly one account name; otherwise `parse.syntax`, and the declaration is not loaded.

```hueke
option timezone Asia/Taipei
option pad-account Expenses:ReconcileDiff
option week-start sunday

account-root Bank asset

commodity NTD
    precision 0
    alias NT$ prefix
commodity camera-01
    item
    ;; category: camera

account Bank:Checking %main-bank
    display-name Main checking account
    primary NTD
    ;; bank_code: 808
account Assets:Receivable
    obligation receivable
    pad-account Expenses:WriteOff

entity NAT
    display-name Nat Chen
```

### `include`

Status: `implemented`

```hueke
include accounts.hueke
include 2026/10.hueke
```

- `include <path>` is a top-level line with no child lines. The path is one token; quote it when it contains whitespace or any of `;` `"` `(` `)` `[` `]` `{` `}`. A missing path or an extra token is `parse.syntax`, and the line is not loaded.
- How paths resolve and how included modules join the ledger is described in [../core/modules.md](../core/modules.md).
