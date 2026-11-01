# Transactions, postings and breakdowns

A **transaction** records one event; its **postings** change the balances of accounts, and their **breakdown** lines describe amounts without affecting balances. This document covers what a transaction and a posting hold, their occurrence and status, how a transaction must balance, how an omitted amount is filled in, and the transactions Core generates.

## Features

| Feature | Status |
| --- | --- |
| Transactions | `implemented` |
| Order of transactions | `implemented` |
| Tags, references and anchors | `implemented` |
| Status and occurrence | `implemented` |
| Balancing | `implemented` |
| Filling in an omitted amount | `implemented` |
| Postings | `implemented` |
| Breakdowns | `implemented` |
| System-generated transactions | `implemented` |

## Concepts

Posting amounts are signed: debit positive, credit negative. Breakdown lines are, for example, the items on a receipt.

Each transaction has an **occurrence** (did it happen?) and each posting a **status** (has it been checked against a statement?).

**Transaction**

| Field | Meaning |
| --- | --- |
| `id` | Its ID (see [ledger.md](ledger.md), "IDs"). |
| `source` | The module it was written in; for a generated transaction, the module of the record that generated it. |
| `span` | The place it was written; absent on generated transactions. |
| `origin` | The Raw record it came from; absent on generated transactions. |
| `effective` | The time at the start of the header. |
| `accounting` | The accounting time; the effective time when not written. |
| `description` | The quoted description, if any. |
| `occurrence` | `occurred` (default), `planned` or `cancelled`. |
| `status` | `none` (default) or `cleared`: the default for its postings. |
| `primaryTag` | The name after `^`, if any: what the transaction is mainly about. |
| `primaryTarget` | The ID of the record the primary tag names, if one defines it (see [anchors.md](anchors.md)). |
| `tags` | Its tags, each a scope and an anchor; the scope is `tag` unless written. A tag also has a `target` when a record defines its anchor (see [anchors.md](anchors.md), "Concepts"). |
| `refs` | Its entity references, each a role and an entity; the role is `person` unless written. |
| `meta` | Its metadata: a map from key to string. |
| `postings` | Its postings, in written order. |

**Posting**

| Field | Meaning |
| --- | --- |
| `id` | Its ID (see [ledger.md](ledger.md), "IDs"). |
| `span`, `origin` | Where it was written and its Raw record; absent on generated postings. |
| `transaction` | The ID of the transaction it belongs to. |
| `account` | The account's ID. |
| `amount` | The amount: its total change to the account. |
| `price`, `cost` | Totals, if written (see [values.md](values.md), "Prices and costs"). |
| `status` | Its own status when written, else the transaction's. |
| `effective` | Its own effective time when written, else the transaction's. |
| `tags` | Its own tags plus the transaction's. Its own tags alone are in `origin`. |
| `refs` | Its own entity references. Queries fall back to the transaction's (see [query.md](query.md), "Matched postings"). |
| `meta` | Its own metadata. Queries fall back to the transaction's, per key (see [query.md](query.md), "Matched postings"). |
| `breakdown` | Its breakdown lines. |

**Breakdown line**

| Field | Meaning |
| --- | --- |
| `name` | The name, such as `Bubble tea`. Always present. |
| `quantity` | The quantity, if written: a number, and a unit when one is written, a text label such as `cups`. |
| `unitPrice` | The unit price, if written: a number, and a commodity when one is written. |
| `total` | The total, if written: a number, and a commodity when one is written. |

## Behavior

### Transactions

Status: `implemented`

- A transaction may have zero postings. It never changes a balance by itself; only its postings do.
- Times, and how a posting's time is inherited, are described in [time.md](time.md), "Time axes".

### Order of transactions

Status: `implemented`

- The ledger keeps transactions in order of their effective time. Each time sorts at its **end**, in UTC; a point sorts at its moment. So within one day, records with a time of day come before date-only ones, and a month comes after every day in it.
- When two ends are equal:
  1. intervals come before points, because a point at that moment starts the next period;
  2. among intervals, the shorter one, with the later start, comes first: a day before the month that ends with it;
  3. a generated transaction comes after the source transactions, because it stands for the state at the end of its point;
  4. then source position.
- Sorting uses the actual UTC moment. After filtering by date, a record from another time zone may come before one with an earlier local date.
- Every list of transactions or postings that the API returns uses the same rule.

### Tags, references and anchors

Status: `implemented`

| Written | Kept in | Described in |
| --- | --- | --- |
| `%anchor` | The record's ID (see [ledger.md](ledger.md), "IDs") | [anchors.md](anchors.md), "Anchors" |
| `^anchor` (primary tag) | `primaryTag`, `primaryTarget` | [anchors.md](anchors.md), "Primary tags" |
| `#tag`, `#scope:anchor` | `tags` | [anchors.md](anchors.md), "Resolving tags", "Scopes" |
| `@entity`, `@role:entity` | `refs` | [entities.md](entities.md), "References and roles" |

- Queries can filter and group by tags, the primary tag and references (see [query.md](query.md)).
- A tag or a reference skipped for an error is not in the derived record; its Raw record still has it.

### Status and occurrence

Status: `implemented`

| Field | Question | Values | Written |
| --- | --- | --- | --- |
| `occurrence` | Did it happen? | `occurred` (default), `planned`, `cancelled` | `!` (planned) or `#` (cancelled) after the header's time |
| `status` | Has it been checked against a statement? | `none` (default), `cleared` | `*` after the header's time, or `*` at the start of a posting line |

- Only `occurred` transactions count toward balances. `planned` and `cancelled` ones are kept but never counted.
- For `occurred` postings, `none` and `cleared` count exactly the same; `cleared` only records that the user has checked the posting.
- The transaction's `status` is the default; a posting may set its own. The posting's value is the only source of truth.
- `cleared` makes sense only for `occurred`. A `planned` or `cancelled` transaction with a cleared posting is `txn.cleared-not-occurred`; every posting is loaded as `none`.
- A mistake is corrected by marking the wrong transaction cancelled and writing the right one. The cancelled one stays in the ledger and can still be queried.

### Balancing

Status: `implemented`

A transaction with postings must balance.

1. Each posting has a **weight**: its `cost` if present, else its `price`, else its own amount. A weight from `cost` or `price` takes the sign of the posting's amount: `-2000 JPY @@ 433 NTD` weighs −433 NTD.
2. Weights are summed per commodity. No conversion is made between commodities.
3. Each sum must satisfy |sum| ≤ 0.5 × 10^−p × k, where p is that commodity's precision and k is the number of weights in the group that came from a price or cost (at least 1).

- Without prices, k = 1, so a whole-number currency must balance exactly. Each price conversion allows one more half unit of rounding.
- A transaction that does not balance is `txn.unbalanced`; the message lists each commodity's sum. Its postings still count with the amounts written.
- Generated transactions are not checked; they balance by construction.

### Filling in an omitted amount

Status: `implemented`

- At most one posting in a transaction may omit its amount.
- The other postings' weights must all be in one commodity, and there must be at least one. The omitted amount is the negated sum of those weights, in that commodity. Example: beside `100 USD @ 32 NTD`, the omitted line becomes −3200 NTD.
- Otherwise, including when no other posting has an amount, the whole transaction is `txn.amount-not-inferable` and is not loaded.
- The filled-in posting keeps its own effective time if one is written.

### Postings

Status: `implemented`

- A posting line holds only a total. Quantity times unit price is written as a breakdown.
- An amount with more decimal places than its commodity's **declared** precision is `posting.excess-precision` (warning) and is used as written. Inferred precision never triggers it; item commodities, prices, costs and filled-in amounts are never checked.

### Breakdowns

Status: `implemented`

A breakdown line is a note for display, such as one item on a receipt. It need not be complete.

- Core never computes with breakdowns. They never affect balances, income or balancing. No total is computed from quantity and unit price, and nothing checks that the two agree or that the lines add up to the posting's amount.
- Every part except the name is optional, and only what is written is kept. A commodity is never taken from the posting: a figure written without one has none.
- Numbers are read with the ledger's marks (see [values.md](values.md), "Numbers as written"). Expressions are not allowed. Decimal places are not checked against precision.
- A commodity written in a breakdown is not a use of it: it creates no commodity, is never `strict.undeclared` or `name.inferred-commodity`, and does not affect inferred precision. An alias is read as its commodity's code; any other code is kept as written.
- A figure that cannot be read, such as a number that does not fit the marks, an expression, parts out of order, or an alias on the wrong side, is `breakdown.invalid-figure` (warning). The line keeps its name and drops all its figures; the transaction loads.
- The commodities written on the unit price, on the total and on the posting's amount must all be the same; only those written are compared, so an omitted posting amount does not take part. The posting's amount counts, not its price or cost: under `1200 JPY @@ 260 NTD`, a breakdown in JPY agrees. A difference is `breakdown.commodity-mismatch` (error); the line is kept as written and the transaction loads.

### System-generated transactions

Status: `implemented`

- Transactions generated by Core carry a `system:<kind>` tag, such as `system:balance` for `pad` (see [balance.md](balance.md)). There is no separate flag.
- They have no `span` or `origin`, are never cleared automatically, and are never written back to the user's files.

## Examples

Commodities: NTD precision 0, JPY precision 0, USD precision 2.

| Postings | Result |
| --- | --- |
| `Expenses:Food 180 NTD`, `Assets:Cash` (no amount) | `Assets:Cash` gets −180 NTD |
| `Expenses:Food 180 NTD`, `Assets:Cash`, `Bank:Checking` (two without amount) | `txn.amount-not-inferable`; not loaded |
| `Bank:USDAccount 100 USD @ 32 NTD`, `Bank:Checking` (no amount) | `Bank:Checking` gets −3200 NTD |
| `Bank:USDAccount 100 USD`, `Bank:JPYAccount 3000 JPY`, `Assets:Cash` (no amount) | `txn.amount-not-inferable` |
| `Expenses:Food 180 NTD`, `Assets:Cash -150 NTD` | `txn.unbalanced`, message includes `30 NTD` |
| `Assets:Cash 1000 JPY`, `Bank:Checking -220 NTD` | `txn.unbalanced`, message includes `1000 JPY` and `-220 NTD` |
| `Bank:USDAccount 3 USD @ 32.123 NTD`, `Bank:Checking -96 NTD` | Balances: off by 0.369, tolerance 0.5 |
| `Bank:USDAccount 3 USD @ 32.123 NTD`, `Bank:Checking -97 NTD` | `txn.unbalanced` |
| `Expenses:Groceries 1 USD @ 32.4 NTD`, `Expenses:Other 1 USD @ 32.4 NTD`, `Bank:Checking -64 NTD` | Balances: off by 0.8, tolerance 1 |
| `Expenses:Groceries 2 USD @ 32.4 NTD`, `Bank:Checking -64 NTD` | `txn.unbalanced`: off by 0.8, tolerance 0.5 |
| `Expenses:Food 180.5 NTD`, `Assets:Cash -180.5 NTD` | `posting.excess-precision` twice; balances −180.5 |

```hueke
2026-10-12 * "Breakfast" @xx_breakfast
    Expenses:Food     200 NTD
        - Bubble tea  3cups * 40 = 120
        - Toast  = 65 NTD
        - Apples  2 kg
        - Discount  = -10
        - Straws
    Assets:Cash      -200 NTD
```

The `Expenses:Food` posting has five breakdown lines: "Bubble tea" with quantity 3 `cups`, unit price 40 and total 120, none of them with a commodity; "Toast" with total 65 NTD; "Apples" with quantity 2 `kg`; "Discount" with total −10; "Straws" with a name only. The posting still counts 200 NTD; that the totals add up to 175 is not checked.

| Breakdown line, under `Expenses:Food 200 NTD` unless said | Result |
| --- | --- |
| `- Ramen  1 * 1200 JPY` | `breakdown.commodity-mismatch`; the line is kept as written and the transaction loads |
| `- Ramen  = 1200 JPY`, under `Expenses:Food 1200 JPY @@ 260 NTD` | No diagnostic: the posting's amount is in JPY |
| `- Toast  1 * 65 NTD = 65 USD` | `breakdown.commodity-mismatch` |
| `- Toast  = (130/2)` | `breakdown.invalid-figure`; the line keeps the name `Toast` and has no figures |
| `- Points  = 40 POINT`, under a posting whose amount is omitted, with `option strict commodity` and `POINT` not declared | No diagnostic, and no commodity `POINT` is created |
| `- Toast 65` (one space) | One line named `Toast 65`, with no figures |

```hueke
2026-10-12 "Supermarket"
    * Expenses:Groceries     300 NTD
    Assets:Cash             -300 NTD

2026-10-13 * "Bookstore"
    Expenses:Other     200 NTD
    Assets:Cash       -200 NTD
```

Posting statuses, in order: `Expenses:Groceries` cleared, `Assets:Cash` none, `Expenses:Other` cleared, `Assets:Cash` cleared. Both transactions count: `Assets:Cash` is −500 NTD.

| Ledger text | Result |
| --- | --- |
| `2026-11-15 ! "Tax due"` with a posting marked `*` | `txn.cleared-not-occurred` |
| `2026-10-15 * ! "Two marks"` | `parse.token-order` |
| A posting line starting with `!` | `parse.syntax`: only `*` can mark a posting |
| `2026-10-12 # "Lunch"` with 180 NTD, and `2026-10-12 * "Lunch (corrected to 150)"` with 150 NTD | `Assets:Cash` is −150 NTD; a query for cancelled transactions lists the 180 NTD lunch |
| `2026-10-13 #travel` (no space) | A tag on the transaction, not a cancel mark |
