# Time

Every time written in a ledger is a **time value**: a point or an interval at some precision, in some IANA time zone. Records carry time on two **axes**: the effective time, when something happened or hit an account, and the accounting time, the period a transaction belongs to. This document covers how time values are written and read, time zones and daylight saving time, weeks, the axes, how times are compared, and the time predicates queries use.

## Features

| Feature | Status |
| --- | --- |
| Time values | `implemented` |
| Daylight saving time | `implemented` |
| Default time zone | `implemented` |
| Weeks | `implemented` |
| Time axes | `implemented` |
| Comparing times | `implemented` |
| Points and periods | `implemented` |
| Time predicates | `implemented` |
| Times given to the API | `implemented` |

## Concepts

A time value becomes a UTC half-open interval `[start, end)`, while the local dates it covers are kept for calendar comparisons.

**Time value**

| Field | Meaning |
| --- | --- |
| `literal` | The text as written, such as `2026-12` or `2026-10-10..2026-10-13`. |
| `precision` | `year`, `month`, `week`, `day` or `time` (a time of day, to the minute): that of the first point of an interval. |
| `timezone` | The IANA zone name the value was read in. |
| `localDate` | The first local date covered. |
| `localEnd` | The last local date covered, inclusive. |
| `start`, `end` | The UTC interval `[start, end)`, to the minute, such as `2026-10-11T16:00Z`. |

Which axis a report uses decides which records fall in a period.

## Behavior

### Time values

Status: `implemented`

| Written | Precision | Interval |
| --- | --- | --- |
| `2026` | year | The whole year |
| `2026-10` | month | The whole month |
| `2026-W05` | week | The whole week (see "Weeks") |
| `2026-10-12` | day | The whole calendar day |
| `2026-10-12T09:30` | time | A point: an interval of length 0 |
| `a..b` | that of `a` | From the start of `a` to the end of `b` |

- A time of day is written to the minute and has precision `time`. Seconds are not written: `2026-10-12T09:30:15` is `parse.invalid-time`.
- A value may carry a zone (see [../dsl/records.md](../dsl/records.md), "Time values"), such as `2026-10-21T00:30[Asia/Tokyo]`. Zones are IANA names, never offsets. A value without a zone uses the ledger's default time zone. Each point of an interval may carry its own zone.
- `a..b` where `b` ends before `a` starts is `parse.invalid-time`.
- Values wrong from their text alone (`2026-13`, `2026-02-30`, `W00`, `W54`, `T25:00`) and unknown zones are `parse.invalid-time`.
- A record with a time error is not loaded; an error in a posting's time drops the whole transaction.

### Daylight saving time

Status: `implemented`

- A local time that does not exist in its zone (America/New_York 2026-03-08T02:30) is `time.nonexistent-local-time`.
- A local time that occurs twice (America/New_York 2026-11-01T01:30) is `time.ambiguous-local-time`. Write its UTC offset to pick one: `2026-11-01T01:30-04:00[America/New_York]` is the first, `-05:00` the second.
- A UTC offset may follow any time of day, and only a time of day: one on a date alone (`2026-10-12+08:00`), or one of 24 hours or more, is `parse.invalid-time`. It never changes the zone; it only has to be an offset the zone has at that local time, or the value is `time.offset-mismatch`: `2026-10-12T09:00+08:00` is valid with the default zone Asia/Taipei, `+09:00` is not.
- Date-only values are never affected.

### Default time zone

Status: `implemented`

| Source | Used when |
| --- | --- |
| The ledger setting `timezone` | Written once, with a known zone |
| The `timezone` option given when creating the ledger | The ledger sets none, or its setting is invalid or duplicated |
| UTC | Neither; `option.missing-timezone` (warning) is reported when the ledger does not write `timezone` at all, and the creation options give none. A `timezone` that is written but invalid or repeated does not report it |

- See [settings.md](settings.md), "Errors in settings", for errors in the setting itself.
- The `timezone` option given when creating the ledger is not checked. When it is not a known zone and the ledger sets none, every time without its own zone is `parse.invalid-time`.

### Weeks

Status: `implemented`

- The first day of the week is the ledger setting `week-start`, any weekday, default `monday`.
- Week 1 is the week that contains January 1, counted from `week-start`. The week that contains the next January 1 is week 1 of the next year, so a year has 52 or 53 weeks and the last days of December may belong to the next year's week 1 (2026-12-29 can be 2027-W01).
- This rule applies to `monday` too; ISO 8601 week numbering is not used.
- A week that does not exist in its year under the ledger's week start (such as `W53` in a 52-week year) is `time.nonexistent-week`.

### Time axes

Status: `implemented`

| Axis | On | Meaning |
| --- | --- | --- |
| `accounting` | Transaction and Balance | The period the transaction belongs to. May be a month, a year or an interval. On a Balance, it is only the accounting time of the transaction its `pad` generates (see [balance.md](balance.md), "`pad` assertions"). |
| `effective` | Transaction, posting and Balance | On a transaction: when it happened. On a posting: when the amount actually hit that account (bank value date, card posting date). |
| `txn-effective` | Transaction | The transaction's own effective time, ignoring the postings' own times. Used for calendar views. |

- **Inheritance.** A transaction without an accounting time uses its effective time. A posting without an effective time uses its transaction's.
- **A posting's effective time is one day or one moment**: precision `day` or `time`. It is never a week, a month, a year or an interval (`a..b`), not even an interval within one day. The rule applies to the time the posting uses, whether written on it or inherited from its transaction. A violation is `posting.invalid-effective`, and the transaction is not loaded.
  - A transaction whose effective time is a period may have postings only when each of them writes its own time. Income and expense postings cannot, so such a transaction writes the period as its accounting time instead: `2026-10-01=2026-10`.
  - A transaction with no postings may have any effective time. The accounting time is not restricted.
- Postings have no accounting time of their own: all postings of a transaction share one accounting period, so income, expenses and equity agree.
- Postings on income and expense accounts (types `income` and `expense`) cannot have their own effective time, because they follow only the transaction's accounting time. Writing one is `posting.pnl-effective`; the written time is ignored. Accounts without a type are not checked.
- Metadata may hold dates, but a metadata date is never a time axis.

**Axis by use**

The API defaults to `effective` (see [query.md](query.md), "Axis of a query"). Uses that need another axis, such as the income statement and primary-tag reports, must set it.

| Use | Axis |
| --- | --- |
| Income statement, primary-tag reports | `accounting` |
| Account balances and details, cash flow | `effective` (each posting's own time) |
| Balance assertions, reconciliation | `effective` |
| Calendar views | `txn-effective` |

### Comparing times

Status: `implemented`

- A query time is compared with a record by local dates: the record's local dates in its own time zone, whatever the record's precision. Query times never have a time of day (see "Times given to the API").
- **Calendar comparison.** A record is compared by the date written in the ledger. Example: a purchase in Tokyo at 2026-10-21T00:30 (UTC 2026-10-20T15:30) has local date 2026-10-21. A query for 2026-10-21 finds it; the balance at the end of 2026-10-20 does not include it.
- Sorting is described in [transactions.md](transactions.md), "Order of transactions".

### Points and periods

Status: `implemented`

- **A point** used by a balance or a Balance assertion is the **end** of its time value. A date D means the end of day D.
- `until(D)` counts a record when it has ended by the end of D: its last local date (`localEnd`) is D or earlier. On the effective axis that is every posting whose local date is D or earlier, since a posting's effective time is one day or one moment. On the accounting axis, an interval or a month counts only once it has ended.
- **Period reports do not spread amounts.** A record whose time is an interval (a yearly premium with accounting time `2026-07..2027-06`) shows in full in every period it overlaps. Such amounts cannot be added across periods.

### Time predicates

Status: `implemented`

A time filter compares the record's interval R on the query's axis with the query time Q.

| Predicate | Matches when |
| --- | --- |
| `within(Q)` | R lies entirely inside Q |
| `overlaps(Q)` | R and Q share some time |
| `covers(Q)` | R contains Q |
| `until(t)` | R has ended by the end of t: from the start of the ledger up to t (see "Points and periods") |

- A record that is a point is inside Q when its local date falls in Q; then both `within(Q)` and `overlaps(Q)` hold, and otherwise neither does.
- A record that is a point (length 0) never covers a query time.
- A week (`2026-W01`) in a query is shorthand for the interval of days it covers. Quarters exist only as grouping labels (see [query.md](query.md)), not as query times.

### Times given to the API

Status: `implemented`

- Wherever the API takes a time, it accepts a time value or its text.
- Text is read with the ledger's default time zone and week start, and checked by exactly the rules for ledger text: `2026-13`, `2026-02-30` and `T25:00` are rejected, never adjusted.
- Text that cannot be read is a misuse of the API: the call throws an error whose message names the diagnostic code the same text would get in a ledger (`parse.invalid-time`, `time.nonexistent-local-time`, `time.ambiguous-local-time`, `time.nonexistent-week`, `time.offset-mismatch`).
- A query time (`within`, `overlaps`, `covers`, `until`, and `reconcile`'s `at`) is a day, a week, a month or a year, or an interval of those. A query time with a time of day is a misuse of the API: the call throws an error whose message names `query.time-of-day`. This code belongs to the API alone: a time of day is valid in a ledger, so `check` never reports it. Records keep their own times of day.
- Text is read before its time of day is checked, so text that cannot be read throws with its ledger code even when it has a time of day: `2026-03-08T02:30[America/New_York]` given to `within` names `time.nonexistent-local-time`. A time value given instead of text is checked only for a time of day.

## API

- `timeOnAxis(transaction, posting, axis)` returns the time a posting has on an axis: the transaction's accounting time for `accounting`, the posting's effective time for `effective` (its own, or its transaction's when it has none), and the transaction's effective time for `txn-effective`. Queries order and filter postings by this time, and the CLI prints it as `date`.

## Examples

The rows whose ledger time zone is not Asia/Taipei are loaded without the shared declarations.

| Ledger time zone | Written | `localDate` | `start` | `end` |
| --- | --- | --- | --- | --- |
| Asia/Taipei | `2026-10-12` | 2026-10-12 | 2026-10-11T16:00Z | 2026-10-12T16:00Z |
| Asia/Taipei | `2026-10` | 2026-10-01 | 2026-09-30T16:00Z | 2026-10-31T16:00Z |
| Asia/Taipei | `2026-10-21T00:30[Asia/Tokyo]` | 2026-10-21 | 2026-10-20T15:30Z | 2026-10-20T15:30Z |
| None, none given when creating the ledger | `2026-10-12` | 2026-10-12 | 2026-10-12T00:00Z, with `option.missing-timezone` | 2026-10-13T00:00Z |
| None, Asia/Tokyo given when creating the ledger | `2026-10-12` | 2026-10-12 | 2026-10-11T15:00Z | 2026-10-12T15:00Z |
| America/New_York | `2026-03-07T12:00`, `2026-03-09T12:00` | — | 2026-03-07T17:00Z, 2026-03-09T16:00Z | — |

| Written | Result |
| --- | --- |
| `2026-02-30`, `2026-13`, `2026-10-12T25:00` in a ledger | `parse.invalid-time`; the transaction is not loaded |
| `2026-03-08T02:30[America/New_York]` | `time.nonexistent-local-time` |
| `2026-11-01T01:30[America/New_York]` | `time.ambiguous-local-time` |
| `2026-12-30=2026-W53` | `time.nonexistent-week`: 2026 has 52 weeks |
| `2026-10 * "October building fee"` with postings on `Expenses:Housing` and `Bank:Checking` | `posting.invalid-effective` on the transaction: both postings inherit a month; the transaction is not loaded. `2026-10-01=2026-10` loads |
| `Bank:Checking -100 NTD [2026-10-10..2026-10-12]` | `posting.invalid-effective` on the posting; the transaction is not loaded |
| `2026-13` given to `query(ledger).within(…)` | Throws; the message names `parse.invalid-time` |
| `2026-10-12T09:00..2026-10-12T10:00` given to `query(ledger).within(…)` | Throws; the message names `query.time-of-day` |

```hueke
2026-11-30=2026-12 * "Prepaid December rent"
    Expenses:Housing     15000 NTD
    Bank:Checking       -15000 NTD [2026-12-02]
```

The expense is in December's income statement (`accounting` axis), not November's. `Bank:Checking` is 0 at 2026-12-01 and −15000 at 2026-12-02.

```hueke
2026-07-01=2026-07..2027-06 * "Yearly insurance premium"
    Expenses:Insurance     12000 NTD
    Bank:Checking         -12000 NTD
```

On the `accounting` axis, `overlaps("2026-10")` finds it and `within("2026-10")` does not. The income statements for October and for November each show 12000 NTD.

```hueke
2026-10-12T10:00 * "Coffee"
    Expenses:Food     100 NTD
    Assets:Cash      -100 NTD

2026-10-12T18:00=2026-10-12T09:00..2026-10-12T18:00 * "Shift meal allowance"
    Assets:Cash        200 NTD
    Income:Allowance  -200 NTD
```

The shift is paid at 18:00; the shift itself is its accounting time. On the `accounting` axis, `within("2026-10-12")` and `overlaps("2026-10-12")` find both. `covers("2026-10-12")` compares local dates, so it finds the shift (its local dates are 2026-10-12 to 2026-10-12) but not the coffee, a point.

| Transactions on | `week-start sunday`: `2026-W01` | Default: `2026-W01` | Default: `2025-W52` |
| --- | --- | --- | --- |
| 2025-12-27, 2025-12-28, 2026-01-03, 2026-01-04, 2026-12-28 | 2025-12-28, 2026-01-03 | 2026-01-03, 2026-01-04 | 2025-12-27, 2025-12-28 |

2026-12-28 is in `2027-W01` under both week starts.
