# Valuation

**Valuation** expresses what one commodity is worth in another, using only the prices and costs written on postings; a ledger has no separate price records. For one pair of commodities, the held commodity and the **quote** commodity it is reported in, Core lists the **trades** between them with their cost and realized gain, and the **holdings** at a point with their quantity, average cost and, when asked, their value and unrealized gain. Valuation is a view: it generates no postings, and other queries never convert or value anything. This document covers how a price is chosen, where a value comes from, cost and gains, and the functions `trades` and `holdings`.

## Features

| Feature | Status |
| --- | --- |
| Prices from the ledger | `specified` |
| Value sources | `specified` |
| Cost and gains | `specified` |
| `trades` | `specified` |
| `holdings` | `specified` |

## Concepts

All amounts in these rows are in the quote commodity; quantities are in the held commodity.

**Trade row** (one row of `trades`)

| Field | Meaning |
| --- | --- |
| `transaction`, `posting` | The IDs of the transaction and of the posting on the held commodity. |
| `effective` | The posting's effective time. |
| `quantity` | The change in the held commodity: positive for a purchase, negative for a sale. |
| `unitPrice`, `total` | The price per unit and in total; absent when the posting has no price in the quote commodity. |
| `cost` | The cost of what was bought, or of the part sold; absent when it cannot be known. |
| `realized` | For a sale only: what it was sold for minus `cost`. |
| `averageCost` | The average cost per unit after this row; absent when it cannot be known. |

**Holding** (one row of `holdings`)

| Field | Meaning |
| --- | --- |
| `commodity`, `quote` | The held commodity and the quote commodity. |
| `at` | The point. |
| `quantity` | The quantity held at `at`. |
| `cost`, `averageCost` | The cost of what is held, and per unit; absent when it cannot be known. |
| `unitPrice`, `value` | The price per unit and the value of the quantity; absent without valuation or without a price. |
| `unrealized` | `value − cost`; absent when either is. |
| `valueSource` | Where the value came from: `table`, `ledger` or `cost`; absent without valuation. |

**Price table**: a map from commodity to a unit price in the quote commodity, given to `holdings` as the prices at its point. It is a query argument and is never written to the ledger.

## Behavior

### Prices from the ledger

Status: `specified`

The price of commodity X in commodity Q at a point is taken from the latest posting, at or before the point, that involves both X and Q through its amount and its price or cost.

- A posting with both a price and a cost gives its price: the price is this trade's, the cost an earlier one's.
- The unit price is the total price over the quantity. Either side may be X: `1000 NTD @@ 4600 JPY` also gives the price of JPY in NTD, as the reciprocal.
- "Latest" compares effective times as UTC moments. Among postings at the same moment, the one whose ID sorts last wins.
- Without a direct price, the price goes through other commodities, such as AAPL to USD to NTD, along the path with the fewest steps. Among paths of the same length, the one whose commodity codes sort first, step by step, is used.
- The price along a path is exact: each step's total over quantity is multiplied as a fraction, and the result is divided once at the end and kept to 28 significant digits, rounded half up. Rounding to precision is the presentation's job.
- Only `occurred` postings give prices.
- When no path exists, X is not valued, and `valuation.missing-price` (warning) is returned with the result.

### Value sources

Status: `specified`

`holdings` values nothing unless asked: by default it gives quantity and cost only, and never `valuation.missing-price`. When asked, the value comes from one source:

| Source | `value` | Unit price and value |
| --- | --- | --- |
| Price table | A price table | The table's price for X when it has one; otherwise the ledger's, as in "Prices from the ledger" |
| Ledger | `ledger` | The ledger's prices only |
| Cost | `cost` | Value = cost and unit price = average cost, so `unrealized` is zero; nothing when the cost is not known |

- A table price is only for the commodity it lists; it is never a step in a path for another commodity.
- `trades` takes no value source: its prices are those of each posting.

### Cost and gains

Status: `specified`

Cost and gains are computed for one held commodity X and one quote Q, over the accounts given, taken together as one holding with one average cost.

- The postings in X on those accounts are taken in the order of their effective times as UTC moments, then their IDs. Only `occurred` postings count. Within one transaction, moves between the given accounts offset each other and do not change the cost.
- **Purchase** (X increases): the cost is the posting's weight in Q: its cost when written, otherwise its price. Fees in the same transaction are not included; to include them, write the cost.
- **Sale** (X decreases): the cost of the part sold is the posting's cost when written, otherwise the average cost times the quantity. `realized` is the price, the amount sold for, minus that cost. A sale without a price is sold at cost: `realized` is zero.
- **Average cost** is the total cost held over the quantity held. A purchase adds its cost; a sale removes the cost of the part sold. When the quantity returns to zero, the average starts over.
- **Costs in other commodities.** A posting whose weight is not in Q, or that has neither price nor cost, such as an opening balance moved in from another account, adds its quantity but no cost; `cost` and `averageCost` are then unknown from that point until the quantity returns to zero, and `valuation.incomplete-cost` (warning) is returned with the result. With the option `convert`, a weight in another commodity is converted to Q at the price of the posting's own time, as in "Prices from the ledger"; when that fails, the same warning.
- **Negative quantities** (short positions) are not covered: while the quantity is below zero, no cost or gain is computed, and `valuation.negative-position` (warning) is returned with the result. A posting that takes the quantity from below zero to above it is split at zero: the part up to zero closes the negative stretch; the part above zero is a new purchase, with the matching proportion of the posting's cost.
- Balancing does not change: a sale without a written cost still balances at its price. The average cost exists only in this view; a gain is recorded in the ledger only when the user writes it.

### `trades`

Status: `specified`

- It lists the transactions that involve both X and Q (as the query clause `involves` does), restricted to the given accounts, one row per posting in X on those accounts, in the order of "Cost and gains".
- A range limits which rows are listed; the average cost is still computed from the beginning of the ledger.

### `holdings`

Status: `specified`

- It gives the holding of X at a point, `at`, on the given accounts.
- Without X, it gives one row for each commodity other than Q that the accounts hold in a quantity other than zero at `at`, sorted by commodity code. Each row is computed as if it had been asked for alone.
- With a value source, each row adds `unitPrice`, `value`, `unrealized` and `valueSource`, as in "Value sources". `valueSource` is the source the value actually came from: `ledger` for a commodity a table did not list.

## API

- `trades(ledger, { commodity, quote, accounts, range, convert })` returns `rows`, the trade rows, and `diagnostics`, the `valuation.*` warnings of this result. `accounts` defaults to every account; `range` is a time or an interval, read as `within` is; `convert` defaults to false. It throws before initialization and when a time is rejected (see [time.md](time.md), "Times given to the API").
- `holdings(ledger, { commodity, quote, accounts, at, convert, value })` returns `holdings`, the holding rows, and `diagnostics`. `at` is required; `commodity` is optional; `value` is a price table, `"ledger"` or `"cost"`, and without it nothing is valued. It throws as `trades` does, and when a price in the table is not a value (see [values.md](values.md), "Arithmetic").
- The `valuation.*` warnings are never returned by `check` (see [diagnostics.md](diagnostics.md), "Codes returned with results").

## Examples

With the shared declarations:

```hueke
2026-10-01 * "Buy"
    Assets:Broker    10 AAPL @ 150 USD
    Bank:USD       -1500 USD

2026-10-05 * "Buy more"
    Assets:Broker    10 AAPL @ 170 USD
    Bank:USD       -1700 USD

2026-10-10 * "Sell"
    Assets:Broker    -5 AAPL @ 180 USD
    Bank:USD         900 USD

2026-10-12 * "Exchange"
    Bank:USD        -100 USD @ 32 NTD
    Bank:Checking   3200 NTD
```

| Call | Result |
| --- | --- |
| `trades(ledger, { commodity: "AAPL", quote: "USD", accounts: ["Assets:Broker"] })` | Three rows: +10, cost 1500, average 150; +10, cost 1700, average 160; −5, unit price 180, total 900, cost 800, realized 100, average 160 |
| `holdings(ledger, { commodity: "AAPL", quote: "USD", accounts: ["Assets:Broker"], at: "2026-10-12" })` | Quantity 15, cost 2400, average cost 160; no value |
| The same with `value: "ledger"` | Unit price 180, value 2700, unrealized 300, `valueSource` `ledger` |
| The same with `value: { AAPL: "175" }` | Unit price 175, value 2625, unrealized 225, `valueSource` `table` |
| The same with `value: "cost"` | Value 2400, unrealized 0 |
| `holdings(ledger, { commodity: "AAPL", quote: "NTD", accounts: ["Assets:Broker"], at: "2026-10-12", value: "ledger" })` | Cost and average cost absent, with `valuation.incomplete-cost`: the costs are in USD. The value goes AAPL → USD → NTD: 15 × 180 × 32 = 86400 NTD |
| The same with `convert: true` | Each cost converted at the USD price of its own time. No price of USD in NTD exists before 2026-10-12, so `valuation.incomplete-cost` remains |
| `holdings(ledger, { quote: "USD", accounts: ["Bank:USD"], at: "2026-10-12" })` | No rows: `Bank:USD` holds only USD |

**A price written on the other side, and two prices at once**

```hueke
2026-10-29 * "Got yen"
    Assets:Cash    10000 JPY
    Income:Other  -10000 JPY

2026-10-30 * "Changed some back"
    Bank:Checking   1000 NTD @@ 5000 JPY
    Assets:Cash    -5000 JPY
```

`holdings(ledger, { commodity: "JPY", quote: "NTD", accounts: ["Assets:Cash"], at: "2026-10-31", value: "ledger" })` gives quantity 5000, unit price 0.2, value 1000 NTD, with `valuation.incomplete-cost`: the income has no price in NTD.

Two exchanges on 2026-10-01 without a time of day, `%fx-a` at 32.0 NTD and `%fx-b` at 32.5 NTD per USD, are at the same moment: the price is 32.5, from `fx-b`, whose ID sorts last. Writing times on the headers decides the order instead.

A purchase of `1.250 GOLD @@ 3250000 KRW` in a ledger with no trade between KRW and NTD, valued in NTD, gives no value for GOLD and `valuation.missing-price`.
