# Values

An **amount** is an exact decimal value in one commodity (see [commodities.md](commodities.md)). Core never converts between commodities by itself; the only links between commodities are the prices and costs written on postings. This document covers amounts, how numbers are read, arithmetic in amounts and on values, and prices and costs.

## Features

| Feature | Status |
| --- | --- |
| Amounts | `implemented` |
| Numbers as written | `implemented` |
| Arithmetic | `implemented` |
| Prices and costs | `implemented` |

## Concepts

**Amount**

| Field | Meaning |
| --- | --- |
| `value` | The exact value as a string: a decimal such as `"-12.5"`, or a reduced fraction such as `"-1000/3"` when it has no finite decimal form, the sign on the numerator. Trailing zeros are dropped (`1.250` is `"1.25"`), and zero is `"0"`, never `"-0"`. Never a floating-point number. |
| `commodity` | The commodity's code. |

## Behavior

### Amounts

Status: `implemented`

- Amounts are added only to amounts of the same commodity. Totals with several commodities are kept as one amount per commodity, sorted by code.
- Rounding happens only for display, never in computation.
- How a number and its commodity are written together is described in [../dsl/records.md](../dsl/records.md), "Amounts".

### Numbers as written

Status: `implemented`

- The decimal mark and the group mark are ledger settings (see [settings.md](settings.md), "Settings"). They affect only how numbers are read and written, never computation.
- The group mark groups the digits before the decimal mark in threes, the first group having one to three digits: `1,500.25`, or `1.500,25` with decimal mark `,` and group mark `.`. Group marks may be left out. Groups of any other size are `parse.invalid-number`.
- A leading `-` makes a number negative. `+` is not allowed.
- A number or amount that does not fit these rules is `parse.invalid-number`, and its record is not loaded. In a breakdown it is `breakdown.invalid-figure` instead (see [transactions.md](transactions.md), "Breakdowns").

### Arithmetic

Status: `implemented`

- Wherever a number is written in an amount, a price, a cost or a Balance, an expression in parentheses may stand instead; breakdown figures take no expressions: `(1000/3) NTD`, `((100 + 50) * 2) NTD`, `-(12.5 * 4)NTD`.
- The whole number is one pair of parentheses. Inside: numbers in the ledger's marks, `+`, `-`, `*`, `/`, nested parentheses and whitespace. `*` and `/` bind tighter than `+` and `-`; a `-` before a number or a parenthesis negates it. `+` is not a sign.
- The value is exact, a fraction if need be: `(1000/3)` is 1000/3, and three postings of `(1000/3) NTD` add up to exactly 1000 NTD.
- An expression's decimal places, for inferred precision and `posting.excess-precision`, are the most decimal places among the numbers written in it: `(10/4)` has none, `(0.25 * 2)` has two.
- An expression that cannot be read, or that divides by zero, is `parse.invalid-number`.
- Values the API returned are computed with the same exact arithmetic (see "API"). A presentation that works figures out of them, such as a running balance (see [query.md](query.md), "Ordering") or a breakdown's total from its quantity and unit price, uses it, never floating-point numbers.
- Results are written as an amount's `value` is (see "Concepts"): a decimal without trailing zeros, or a reduced fraction. `"1000/3"` added three times is `"1000"`.
- A value given may also have leading or trailing zeros, `-0`, or an unreduced fraction, such as `"1.10"`, `"007"` or `"2/4"`. Other text, such as a group mark, a `+` sign or a zero denominator, is a misuse of the API: the call throws.

### Prices and costs

Status: `implemented`

A posting's `price` is the trade price; its `cost` is the cost of the lot held. How they weigh in balancing is described in [transactions.md](transactions.md), "Balancing".

- A price is written as a unit price (`@`) or a total (`@@`), a cost as a unit cost (`{…}`) or a total (`{{…}}`). Both are stored as totals: a unit price or cost is multiplied by the posting's quantity during normalization.
- Prices and costs are written without a sign (see [../dsl/records.md](../dsl/records.md), "Amounts") and are always positive, even when the quantity is negative. One whose written value is negative, such as `@ -170 USD` or `@ (10 - 20) USD`, is `posting.signed-price` (warning) and is used without the sign. The same holds for the price of a pad (see [balance.md](balance.md)).
- A price or cost on a posting whose amount is omitted is ignored. Ledger text cannot write one (see [../dsl/records.md](../dsl/records.md), "Postings"); only a Raw record changed through the API can hold one.

## API

- `sumValues(values)` returns the exact sum of any number of values; with none, `"0"`.
- `multiplyValues(a, b)` returns the exact product of two values.
- `negateValue(value)` returns the value with its sign changed; zero stays `"0"`.
- `compareValues(a, b)` returns a negative number, zero or a positive number as `a` is below, equal to or above `b`.
- Each throws when a value given is not one (see "Arithmetic").

## Examples

| Posting as written | Amount | Price | Cost | Weight |
| --- | --- | --- | --- | --- |
| `Bank:USDAccount   1000 USD @ 32.10 NTD` | 1000 USD | 32100 NTD | — | 32100 NTD |
| `Expenses:Food   1200 JPY @@ 260 NTD` | 1200 JPY | 260 NTD | — | 260 NTD |
| `Assets:Brokerage   -5 AAPL {150 USD} @ 170 USD` | −5 AAPL | 850 USD | 750 USD | −750 USD |

| Ledger text | Result |
| --- | --- |
| `15,00 HKD` with the default marks | `parse.invalid-number`; the transaction is not loaded |
| `option decimal-mark ,` and `option group-mark .`, then `1.500,25 EUR` | 1500.25 EUR |
| `option decimal-mark ,` and `option group-mark ,` | `option.invalid-number-format`; `12.50 CHF` reads as 12.5 |
| `option decimal-mark ,` alone, then `1.500,25 EUR` | 1500.25 EUR: the group mark becomes `.` |
| `Bank:USDAccount   1000 USD @ -32.10 NTD` | `posting.signed-price`; the price is 32100 NTD |

Arithmetic on values the API returned:

| Call | Result |
| --- | --- |
| `sumValues(["1000/3", "1000/3", "1000/3"])` | `"1000"` |
| `sumValues(["-12.5", "2.25"])` | `"-10.25"` |
| `multiplyValues("3", "1.10")` | `"3.3"` |
| `negateValue("-1000/3")` | `"1000/3"` |
| `compareValues("2.50", "10")` | A negative number |
