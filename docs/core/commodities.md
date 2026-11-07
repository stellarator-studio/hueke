# Commodities

A **commodity** is what an amount is counted in: a currency, a security, loyalty points, or a single item such as a camera. Each commodity has a code, a **precision** that is declared or inferred, and optional **aliases** that may stand for the code in amounts; **item mode** adds rules for things counted one by one. This document covers commodity declarations, aliases, precision and item mode.

## Features

| Feature | Status |
| --- | --- |
| Commodity declarations | `implemented` |
| Commodity aliases | `implemented` |
| Precision | `implemented` |
| Inferred precision | `implemented` |
| Item mode | `implemented` |

## Concepts

**Commodity**

| Field | Meaning |
| --- | --- |
| `id` | The code, such as `NTD`, `AAPL`, `camera-01`. Records always refer to a commodity by its code. |
| `span` | Where it is declared; absent for a commodity used without a declaration. |
| `item` | Item mode, for things counted one by one. Default false. |
| `precision` | Decimal places. It sets the balancing tolerance (see [transactions.md](transactions.md), "Balancing") and the padding of amounts for display. Always 0 in item mode. |
| `precisionWritten` | Whether the precision was declared, not inferred. Always true in item mode. |
| `aliases` | Other ways to write the commodity in amounts, each a text and a position, `prefix` or `suffix`. An alias in conflict is still listed, though it is not used. |
| `meta` | Free metadata, such as `category: camera`. |

## Behavior

### Commodity declarations

Status: `implemented`

- A commodity is declared with `commodity <code>`; its properties are written on the lines below (see [../dsl/records.md](../dsl/records.md), "Declarations").
- A commodity used without a declaration, in an amount, a price or a cost, is created during normalization (see [ledger.md](ledger.md), "Declarations and strict mode").
- Only the root module's declarations take effect (see [modules.md](modules.md), "Declarations in included modules"). A commodity declared twice is described in [ledger.md](ledger.md), "Duplicate declarations"; a malformed `precision` or `alias` line in [../dsl/records.md](../dsl/records.md), "Declarations".

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

### Inferred precision

Status: `implemented`

- When `precision` is not declared, including for undeclared commodities, the precision is the largest number of decimal places among that commodity's posting and Balance amounts as written. An expression's decimal places are counted as in [values.md](values.md), "Arithmetic".
- Only records that are loaded count. A transaction that is not loaded (for example `txn.amount-not-inferable`) does not affect the precision.
- Prices and costs are not counted, because unit prices often carry more places. A commodity used only in prices and costs has precision 0.
- Amounts filled in for an omitted amount are not counted.

### Item mode

Status: `implemented`

Item mode is for things counted one by one: a camera, a book lent to a friend. Ordinary consumables such as milk or fuel use the normal mode.

- `precision` is fixed at 0 and cannot be written (`parse.unexpected-property`).
- Every posting amount written in an item commodity must be a whole number (`item.fractional`). Balances and generated postings are not checked.
- No account may hold a negative quantity of an item at any point, in effective-time order (`item.invalid-balance`, reported once per account and item, naming the account and the date).

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
