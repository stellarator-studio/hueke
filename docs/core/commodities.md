# Commodities

A **commodity** is what an amount is counted in: a currency, a security, loyalty points, or a single item such as a camera. Each commodity has a code, a **precision** that is declared or inferred, and optional **aliases** that may stand for the code in amounts; **item mode** adds rules for things counted one by one. Codes form a hierarchy, and a commodity takes the settings it does not write from the commodities above it. A display name and a **format** say how a commodity is shown. This document covers commodity declarations, the hierarchy, aliases, precision, item mode, display names and formats.

## Features

| Feature | Status |
| --- | --- |
| Commodity declarations | `implemented` |
| Commodity aliases | `implemented` |
| Precision | `implemented` |
| Inferred precision | `implemented` |
| Item mode | `implemented` |
| Commodity hierarchy | `implemented` |
| Display names and formats | `implemented` |

## Concepts

**Commodity**

| Field | Meaning |
| --- | --- |
| `id` | The code, such as `NTD`, `AAPL`, `camera-01`, `TWSE:0050`. Records always refer to a commodity by its code. |
| `span` | Where it is declared; absent for a commodity used without a declaration. |
| `parent` | The code without its last segment, such as `TWSE` for `TWSE:0050`; absent for a single segment. The parent need not be declared or used. |
| `item` | Item mode, for things counted one by one, declared or inherited. Default false. |
| `precision` | Decimal places. It sets the balancing tolerance (see [transactions.md](transactions.md), "Balancing") and the padding of amounts for display. |
| `precisionWritten` | Whether the precision was declared, on the commodity or inherited from a commodity above it, not inferred. Always true in item mode. |
| `aliases` | Other ways to write the commodity in amounts, each a text and a position, `prefix` or `suffix`. An alias in conflict is still listed, though it is not used. |
| `displayName` | The name to show, if declared (see [entities.md](entities.md), "Display names"). |
| `format` | How an amount in the commodity is shown, declared or inherited; absent otherwise (see "Display names and formats"). |
| `meta` | Free metadata, such as `category: camera`. |

## Behavior

### Commodity declarations

Status: `implemented`

- A commodity is declared with `commodity <code>`; its properties are written on the lines below (see [../dsl/records.md](../dsl/records.md), "Declarations").
- A commodity used without a declaration, in an amount, a price or a cost, is created during normalization (see [ledger.md](ledger.md), "Declarations and strict mode").
- Only the root module's declarations take effect (see [modules.md](modules.md), "Declarations in included modules"). A commodity declared twice is described in [ledger.md](ledger.md), "Duplicate declarations"; a malformed `precision` or `alias` line in [../dsl/records.md](../dsl/records.md), "Declarations".

### Commodity hierarchy

Status: `implemented`

A code is made of segments joined by `:`, as account names are: `TWSE:0050` is under `TWSE`. The rules for each segment are in [../dsl/lexical.md](../dsl/lexical.md), "Identifiers".

- A commodity takes `item`, `precision` and `format` from the commodities above it when it does not write them, each from the nearest declared one that has it. `TWSE:0050` takes them from `TWSE:0050`'s own declaration, then from `TWSE`.
- `displayName`, aliases and metadata are never inherited.
- A commodity used without a declaration inherits as well: with `TWSE` declared, `10 TWSE:2330` has `TWSE`'s settings. It is still undeclared (see [ledger.md](ledger.md), "Declarations and strict mode").
- Only declared commodities pass settings on; a commodity above that is not declared is skipped. A precision inferred for one commodity is never passed on.
- A commodity under an item commodity is an item too, and its precision is 0. A `precision` it writes is not used, and `commodity.item-precision` (warning) is reported on its declaration.
- A code under a declared commodity may still be another commodity's alias when it is not declared itself: with `commodity TWSE` and `alias TWSE:etf suffix` on `Y`, `10 TWSE:etf` is 10 Y (see "Commodity aliases"). Declaring `TWSE:etf` makes the alias a conflict.
- Each commodity is its own: an amount in `TWSE` and one in `TWSE:0050` are different commodities, and a commodity above may be used in amounts like any other. Balances, queries and balancing never add up the commodities under one code.

### Commodity aliases

Status: `implemented`

- An alias may replace the code in any amount: a `prefix` alias before the number, a `suffix` alias after it. How it is written is described in [../dsl/records.md](../dsl/records.md), "Amounts".
- An alias on the wrong side (`180NT$` for a prefix alias) is `parse.invalid-number`.
- An alias must not equal the code of a declared commodity, its own included, nor another alias, its own included. Such an alias is `commodity.alias-conflict` (warning), reported on each declaration after the first that writes it, and is not loaded for any of them: when two commodities declare the same alias, the first loses it too. Amounts are then read as if the alias had never been declared: with `alias NTD suffix` on `TWD` and `NTD` declared, `180 NTD` is 180 NTD; with `dollars` declared by two commodities, `180dollars` is in the commodity `dollars`. A code that is only used, not declared, does not conflict.
- Output always uses the code.

### Precision

Status: `implemented`

- One precision per commodity; it cannot vary by account.
- `precision <whole number>` declares it. Amounts with more decimal places are described in [transactions.md](transactions.md), "Postings".
- A commodity that does not declare it may inherit it (see "Commodity hierarchy").

### Inferred precision

Status: `implemented`

- When `precision` is neither declared nor inherited, including for undeclared commodities, the precision is the largest number of decimal places among that commodity's posting and Balance amounts as written. An expression's decimal places are counted as in [values.md](values.md), "Arithmetic".
- Only records that are loaded count. A transaction that is not loaded (for example `txn.amount-not-inferable`) does not affect the precision.
- Prices and costs are not counted, because unit prices often carry more places. A commodity used only in prices and costs has precision 0.
- Amounts filled in for an omitted amount are not counted.

### Item mode

Status: `implemented`

Item mode is for things counted one by one: a camera, a book lent to a friend. Ordinary consumables such as milk or fuel use the normal mode.

- `precision` is fixed at 0 and cannot be written (`parse.unexpected-property`).
- Every posting amount written in an item commodity must be a whole number (`item.fractional`). Balances and generated postings are not checked.
- No account may hold a negative quantity of an item at any point, in effective-time order (`item.invalid-balance`, reported once per account and item, naming the account and the date).
- Item mode is inherited (see "Commodity hierarchy").

### Display names and formats

Status: `implemented`

- `display-name <text>` sets `displayName`, a name only for showing (see [entities.md](entities.md), "Display names").
- `format <template>` sets how an amount is shown. The template is a text holding `{amount}` exactly once, and any number of `{code}`, `{leaf}` and `{name}`:

| Placeholder | Replaced with |
| --- | --- |
| `{amount}` | The value, with its sign, written as the presentation writes values (in the CLI, with the ledger's marks and padded to the precision) |
| `{code}` | The code, such as `TWSE:0050` |
| `{leaf}` | The last segment of the code, such as `0050` |
| `{name}` | The display name; the code when there is none |

- Any other text between `{` and `}`, a `{` or `}` without its pair, or a template without `{amount}` or with it twice, is `parse.syntax`, and the declaration is not loaded. The template runs to the end of the line, or may be quoted (see [../dsl/lexical.md](../dsl/lexical.md), "Strings and values").
- Without a format, an amount is shown as `{amount} {code}`.
- A format is inherited (see "Commodity hierarchy"); `{code}`, `{leaf}` and `{name}` are always those of the commodity shown, not of the one that declared the format.
- A format is only for showing, like a display name: the amount keeps its value and commodity, the API and the CSV output are unchanged, and ledger text is always written with the code (see [../dsl/formatting.md](../dsl/formatting.md)). An alias is how an amount may be written; a format is how it is shown. Where the CLI uses formats is described in [../cli.md](../cli.md), "Output".

## Examples

```hueke
2026-10-12 * "Points earned by card"
    Assets:Points      12.5 POINT
    Income:Rewards    -12.5 POINT

2026-10-20 * "Paid with points"
    Expenses:Other     3.25 POINT
    Assets:Points     -3.25 POINT
```

`POINT` is not declared: `check` reports `name.inferred-commodity`, its precision is 2, and `Assets:Points` holds 9.25 POINT on 2026-10-20. A declared `commodity MILE` without `precision` is inferred the same way, without a diagnostic.

| Ledger text | Result |
| --- | --- |
| `commodity NTD` with `alias NT$ prefix` and `alias dollars suffix`, then `NT$180` and `-180dollars` | 180 NTD and −180 NTD |
| The same, then `180NT$` | `parse.invalid-number` |
| A second commodity `TWD` with `alias dollars suffix` | `commodity.alias-conflict` naming TWD; `-180dollars` is read as −180 in the commodity `dollars`, and the record loads |
| `commodity MILE` with `precision x` | `parse.syntax`; `MILE` is not declared, and its precision is inferred as for an undeclared commodity |

```hueke
2026-10-12 * "Bought a camera"
    Assets:Equipment         1 camera-01 @@ 30000 NTD
    Bank:Checking       -30000 NTD

2026-12-01 * "Sold the camera"
    Bank:Checking            25000 NTD
    Assets:Equipment            -1 camera-01 {30000 NTD}
    Expenses:DisposalLoss     5000 NTD
```

With `camera-01` in item mode, `Assets:Equipment` holds 1 camera-01 after 2026-10-12 and 0 after 2026-12-01. Recording the sale a second time on 2026-12-02 is `item.invalid-balance`, with a message naming `Assets:Equipment` and 2026-12-02.

```hueke
commodity TWSE
    display-name Taiwan Stock Exchange
    precision 0
    format {amount} shares ({leaf})
commodity TWSE:0050
    display-name Yuanta Taiwan 50
commodity CELSIUS
    format "{amount} degrees Celsius"

2026-11-03 * "Buy"
    Assets:Broker      1000 TWSE:0050 @ 190 NTD
    Bank:Checking   -190000 NTD

2026-11-04 * "Buy"
    Assets:Broker      2000 TWSE:00878 @ 22 NTD
    Bank:Checking    -44000 NTD
```

| Commodity | `parent` | `precision` | `precisionWritten` | `format` | `displayName` | Shown in a CLI table |
| --- | --- | --- | --- | --- | --- | --- |
| `TWSE:0050` | `TWSE` | 0 | true | `{amount} shares ({leaf})` | Yuanta Taiwan 50 | `1,000 shares (0050)` |
| `TWSE:00878` (undeclared; `name.inferred-commodity`) | `TWSE` | 0 | true | `{amount} shares ({leaf})` | absent | `2,000 shares (00878)` |
| `NTD` | absent | 0 | true | absent | absent | `-190,000 NTD` |

A `-5 CELSIUS` posting is shown as `-5 degrees Celsius`.

| Ledger text | Result |
| --- | --- |
| `commodity CAM` with `item`, then `commodity CAM:a7` with `precision 2` | `commodity.item-precision` on `CAM:a7`; `CAM:a7` is an item with precision 0 |
| `format {amount} {amount}` | `parse.syntax`: `{amount}` is written twice |
| `format {qty} shares` | `parse.syntax`: `{qty}` is not a placeholder |
| `format shares` | `parse.syntax`: no `{amount}` |
