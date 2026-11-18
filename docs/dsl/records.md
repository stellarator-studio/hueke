# Records and declarations

Each record and declaration is written as a fixed sequence of parts. This document gives that sequence for time values, amounts, transaction headers, postings, breakdowns, Balance assertions, declarations, `include`, splits and split tables, rules, and group ledgers with their shared accounts.

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
| Account restrictions | `specified` |
| Splits | `specified` |
| Split tables | `specified` |
| Rules | `specified` |
| Group ledgers and shared accounts | `implemented` |

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
- `^tag:x` is the same as `^x`, and `%tag:x` as `%x`. `^shared:<name>` and `%shared:<name>` name a group ledger (see [../core/anchors.md](../core/anchors.md), "Scoped anchors"). A primary tag or an anchor with another scope is `parse.syntax`.
- `#scope:x` gives a tag a scope; `#x` is `#tag:x`. `#shared:<name>:x` names the anchor `x` of the group ledger this ledger names `<name>` with `as`. `@role:x` gives a reference a role; `@x` is `@person:x`.

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
- `@entity` limits the assertion to one entity (see [../core/balance.md](../core/balance.md), "Entities in Balance assertions"). At most one; a second is `parse.syntax`. Its role follows the rules of any reference (see [../core/entities.md](../core/entities.md), "References and roles"). On obligations, only a pad on one obligation takes an entity (see [../core/balance.md](../core/balance.md), "Obligations in Balance assertions").
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
| Commodity | `commodity <code>` | `display-name <text>`, `item` (no value), `precision <whole number>`, `format <template>`, `alias <text> prefix` or `alias <text> suffix` (may repeat), metadata |
| Account | `account <name> [%anchor]` | `display-name <text>`, `obligation receivable` or `obligation payable`, `pad-account <account>`; `primary <commodity>`; `active`, `allow`, `deny` (see "Account restrictions") [specified]; for a shared account, `source`, `self`, `map` (see "Group ledgers and shared accounts"); metadata |
| Entity | `entity <id>` | `display-name <text>`, metadata; `type` is reserved (see [../core/diagnostics.md](../core/diagnostics.md), "Unsupported syntax") |
| Include | `include <path>`; the path is one token | None |
| Rule [specified] | `rule %<id> ["description"]` | See "Rules" |
| Module | `module shared ["description"]` | See "Group ledgers and shared accounts" |

- Declarations have no time; their order does not matter. Only the root module's declarations take effect (see [../core/modules.md](../core/modules.md), "Declarations in included modules").
- The settings and their values are listed in [../core/settings.md](../core/settings.md), "Settings".
- `precision` must be a whole number without marks, and `alias` must have exactly a text and `prefix` or `suffix`; otherwise `parse.syntax`, and the declaration is not loaded. A `format` template is checked as described in [../core/commodities.md](../core/commodities.md), "Display names and formats".
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
commodity TWSE
    precision 0
    format {amount} shares ({leaf})
commodity TWSE:0050
    display-name Yuanta Taiwan 50

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

- `include <path>` is a top-level line with no child lines. The path is one token; quote it when it contains whitespace or any of `;` `"` `[` `]` `{` `}`. A path with `(` or `)` may be written with or without quotes; Core writes it quoted (see [formatting.md](formatting.md), "Canonical form"). A missing path or an extra token is `parse.syntax`, and the line is not loaded.
- How paths resolve and how included modules join the ledger is described in [../core/modules.md](../core/modules.md).

### Account restrictions

Status: `specified`

```hueke
account Assets:Wallet
    allow NTD, JPY
account Assets:CoinPurse
    deny USD
account Bank:Taishin
    active 2026-03-01..2026-10-15
account Liabilities:OldCard
    active ..2025-12
```

- `allow` and `deny` take commodity codes or aliases, separated by `,`, with optional spaces around it; an empty list or an empty item is `parse.syntax`.
- `active` takes one time value (see "Time values"): an interval, open at one end or not, such as `2026-01-01..` or `..2025-12`, or a single time, such as `2026`. An interval open at both ends, `..`, is `parse.syntax`.
- What they mean is described in [../core/accounts.md](../core/accounts.md), "Allowed commodities" and "Active periods".

### Splits

Status: `specified`

A split is a child line of a posting.

```text
split <member> … [paid-by @<entity>] [-> <obligation>]
split <table anchor> [paid-by @<entity>] [-> <obligation>]
paid-by @<entity> [-> <obligation>]
```

| Member | Meaning |
| --- | --- |
| `@AMY` | AMY, ratio 1 |
| `@AMY 500` | AMY, 500 in the settlement commodity; the number takes no commodity |
| `@AMY *2`, `@AMY ×2`, `@AMY * 2` | AMY, ratio 2 |
| `self *2` | The owner, ratio 2; without it, the owner's ratio is 1 |

```hueke
2026-10-13 * "Dinner"
    Expenses:Food   1200 NTD
        split @AMY @BOB -> Assets:Receivable:dinner-1013
    Assets:Cash    -1200 NTD

2026-10-12 * "Lunch, AMY paid"
    Expenses:Food   180 NTD
        paid-by @AMY -> Liabilities:Payable:lunch-1012
```

- The parts keep the order shown. A split names members or one table, never both: a member after a table anchor is `parse.syntax`. A split with no member and no table is `parse.syntax`.
- `self` is written at most once, and each entity once; a repeat is `parse.syntax`.
- A ratio is a number zero or greater, without a commodity, and may have decimals; a negative ratio is `parse.syntax`. A member's amount follows the ledger's number rules and may be an expression.
- A posting takes at most one `split` or `paid-by` line; a second is `parse.duplicate-property`.
- What a split means is described in [../core/generators.md](../core/generators.md), "Splits" and "Paid by someone else".

### Split tables

Status: `specified`

A split table is written on a transaction with no postings that defines an anchor.

```hueke
2026-10-18 %tokyo-trip "Tokyo trip"
    ;; budget: 60000 NTD
    share self 1
    share @AMY 1
    share @BOB 2
    into Assets:Receivable
```

| Property | Value |
| --- | --- |
| `share` | `self` or `@<entity>`, then a ratio; may repeat, one line per member |
| `into` | The obligation account that receivables go under; optional |

- `share` and `into` stand before the transaction's first posting; after it, they are `parse.unexpected-property` (see [lexical.md](lexical.md), "Ownership"). A ratio follows the rule for split ratios. A member listed twice is `parse.syntax`.
- `split <anchor>` names the table by the transaction's anchor. What it means is described in [../core/generators.md](../core/generators.md), "Split tables".

### Rules

Status: `specified`

A rule is a declaration: a header, properties, then a posting template.

```text
rule %<id> ["description"]
    [cap-group <rule>]
    active <time>
    rate <percent> | rate <number> [<commodity>] per <number> [<commodity>] | fixed <amount> [per <window>]
    [cap <amount> per <window>] …
    [minimum <amount> per <window>] …
    [rounding [per <window>] [half-up | half-even | down]]
    [active <time> …]
    <account> [<amount> | [-]<slot>] [@entity …] [#tag …]
    …
```

```hueke
rule %withhold-5 "Income tax withheld"
    active 2026-01-01..
    rate 5%
    Expenses:Tax  -amount

rule %miles "Miles"
    active 2026-01-01..
    rate 1 MILE per 30 NTD
    rounding per posting down
    Assets:Miles   -amount
    Income:Miles    amount

rule %cashback "Card cashback"
    active 2026-01-01..2026-06-30
    rate 1%
    cap 100 NTD per month
    active 2026-07-01..
    rate 0.5%
    cap 100 NTD per month
    Income:Cashback   amount
    Assets:CashbackDue
```

- The `%id` is required; without it, `parse.syntax`. The header takes no time, mark, references or tags; `@`, `^` and `#` there are reserved (see [../core/diagnostics.md](../core/diagnostics.md), "Unsupported syntax").
- Each `active` starts a segment; `rate` or `fixed`, `cap`, `minimum` and `rounding` after it belong to that segment (see [lexical.md](lexical.md), "Ownership"). `active` is written as on an account (see "Account restrictions").
- `rate <percent>` is a number followed directly by `%`, such as `1%` or `1.5%`. `rate <Y> per <X>` writes a ratio that is not a round percentage; Y and X are numbers, each optionally followed by a commodity. When either has a commodity, both must; otherwise `parse.syntax`.
- `fixed <amount>` is an amount with its commodity, optionally followed by `per <window>`.
- A window after `per` is `posting`, `day`, `week`, `month`, `quarter`, `year`, or a time interval such as `2026-10-01..2026-12-31`. Any other word is the anchor of a cycle, which is reserved.
- `rounding` takes an optional window and an optional mode, in that order; with neither, it is `parse.syntax`.
- **Template lines** are written as postings (see "Postings"), without a leading `*`, a cost or a `[time]`; a template line with any of them is `parse.syntax`. In place of an amount, a template line may hold a **slot**: `amount`, `interest` or `fee`, optionally preceded by `-` for its negation. A slot is never a commodity, since a commodity cannot be a keyword or a lone word without a number.
- A template line takes metadata and breakdown lines; `split` or `paid-by` under it is `parse.unexpected-property`.
- What a rule means is described in [../core/generators.md](../core/generators.md), "Per-posting rules" and "Posting templates".

### Group ledgers and shared accounts

Status: `implemented`

A group ledger is a file whose first record is its `module` declaration; it is read through a shared account, or opened as a ledger of its own:

```hueke
module shared "Tokyo trip"
    share @SUBANG 1
    share @AMY 1
    share @BOB 1

account-root Pay asset

2026-10-19 * %dinner "Dinner, BOB was not there"
    Expenses:Food   3000 NTD
        split @SUBANG @AMY
    Pay:Cash       -3000 NTD @SUBANG
```

| Part | Written |
| --- | --- |
| `module shared ["description"]` | The kind, `shared`, and an optional description. The module has no name of its own: each ledger that refers to it names it with `as` |
| `share @<entity> <ratio>` | A member and its default ratio; may repeat. `self` is `parse.syntax` |

A shared account is declared in the owner's ledger, under a root of type `shared`:

```hueke
account-root Shared shared

account Shared:tokyo-trip
    source trips/tokyo.hueke as ^tokyo-trip
    self @SUBANG
    map Expenses -> Expenses:Travel
    map Pay:Cash -> Assets:Cash
    map Pay:Card -> Liabilities:Card
    map @AMY -> @AMY_CHEN
    map commodity TWD -> NTD
    pad-account Expenses:Rounding
```

| Property | Written |
| --- | --- |
| `source <path> as [^]<name>` | The group ledger's path, one token as in `include` (see "`include`"), so `as` after it is never ambiguous: `source "trips/tokyo trip.hueke" as tokyo`; then the group ledger's name in this ledger, which follows the rule for anchors (see [lexical.md](lexical.md), "Identifiers"). A `^` joined to the name gives its transactions a primary tag (see [../core/group-ledgers.md](../core/group-ledgers.md), "Group tags") |
| `self @<entity>` | The owner's member entity |
| `map <group account> -> <account>` | An account mapping; may repeat |
| `map @<group entity> -> @<entity>` | An entity mapping |
| `map commodity <group commodity> -> <commodity>` | A commodity mapping |

- A `module` declaration of another kind, or with anything but a description after the kind, is `parse.syntax`, and so is a `share` line that is not `@<entity>` and a ratio, names `self`, names a member already listed, or has a negative ratio.
- A `source` line without `as <name>` or `as ^<name>` after the path, or with anything else after it, a `self` line that is not one entity, and a `map` line that is not one of the three forms above are `parse.syntax`.
- `source`, `self` and `map` belong only on an account whose root has type `shared`. The parser cannot know the type, so on any other account they are `shared.wrong-account` (error), found during normalization, and they are ignored; the rest of the declaration loads.
- A transaction of the owner's ledger names a group transaction with `#shared:<name>:<anchor>`, and the group ledger as a whole with `%shared:<name>`, `#shared:<name>` or `^shared:<name>` (see "Transaction headers").
- What these mean is described in [../core/group-ledgers.md](../core/group-ledgers.md).
