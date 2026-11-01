# Queries

A **query** selects transactions and postings, then optionally groups and aggregates them: **filter → group → aggregate**. Listing the matched records gives them one by one; grouping and summing them is a report. `balance` and `register` lay the matched postings out on the **account tree**. This document covers the filter clauses, which postings match, ordering, grouping keys, aggregation, the account tree, `balance` and `register`.

## Features

| Feature | Status |
| --- | --- |
| Filtering | `implemented` |
| Matched postings | `implemented` |
| Axis of a query | `implemented` |
| Ordering | `implemented` |
| Grouping | `implemented` |
| Account tree | `implemented` |
| Aggregation | `implemented` |
| `balance` | `implemented` |
| `register` | `implemented` |
| Settled obligations in `balance` and `register` | `implemented` |

## Concepts

**Group** (one row of a grouped result)

| Field | Meaning |
| --- | --- |
| `key` | The group's value for each grouping key, by key name. A missing value is the "none" group, written as null. |
| `value` | The aggregate: a list of amounts for `sum`, a number for `count`. |

**Account tree row** (one row of `balance` or `register`)

| Field | Meaning |
| --- | --- |
| `account` | The account's name, as shown in the tree (see "Account tree"). |
| `depth` | The number of name segments of the account (1 for a root). |
| `subtotal` | Whether the row includes the sub-accounts. |
| `amounts` | The sum of the row's postings: one total per commodity, sorted by commodity. |
| `postings` | `register` only: the matched postings the row counts, in "Ordering" order. Empty on a subtotal row. |

## Behavior

### Filtering

Status: `implemented`

| Clause | Level | Meaning |
| --- | --- | --- |
| `axis` | — | Which time the time clauses compare: `accounting`, `effective` or `txn-effective` (see [time.md](time.md), "Time axes"). |
| `within`, `overlaps`, `covers`, `until` | By axis | Time predicates (see [time.md](time.md), "Time predicates"). |
| `accounts` | Posting | Account IDs, sub-accounts included. |
| `entities` | Posting | Entity IDs in the posting's references (see "Matched postings"). |
| `ids` | By ID | Transaction and posting IDs: anchors or generated IDs. A transaction's ID is a transaction-level condition; a posting's ID is a posting-level one (see [anchors.md](anchors.md), "Looking up by ID"). |
| `tags` | Posting | The posting's tags (see "Matched postings"). A tag is given as a tag, or as text written in full, `<scope>:<anchor>`, with or without `#`: `tag:travel`, `#system:balance`, `shared:trip:hotel`. Text without a scope, such as `travel`, throws `query.tag-without-scope`. Text matches a tag exactly, period included: `tag:trip` does not match `#trip/2026-10`. |
| `status` | Posting | The posting's status: `none`, `cleared`. |
| `primaryTag` | Transaction | The transaction's primary tag. |
| `involves` | Transaction | Each listed commodity appears in the amount of some posting. Prices and costs are not looked at. |
| `occurrence` | Transaction | Not called: `occurred` only, including system-generated transactions such as `pad`. Called: only the listed `planned` and `cancelled`; with no arguments, both. Occurred and not-occurred records never mix in one query. |

- Different clauses combine with AND. Values within one clause combine with OR, except `involves`, which is AND.
- Calling a time clause again adds another condition; calling any other clause again replaces it.
- There is no filtering by account type. List the accounts with `accounts`.
- An account, entity or commodity that the ledger does not have is not an error; it matches nothing.
- `tags` matches tags whether anchored or plain, and never a tag skipped for a scope error (see [anchors.md](anchors.md), "Scopes").
- `accounts` also accepts the merged income and expense root and its accounts, such as `IncomeExpenses:Food` (see [accounts.md](accounts.md), "Combined income and expense").
- `occurrence("occurred")`, and calling `axis` after a time clause, are not settled. [draft]

### Matched postings

Status: `implemented`

**A transaction matches when one of its postings, or its empty posting, meets every clause.** The postings that meet every clause are its matched postings.

- **Every clause is checked on one posting.** Example: filtering a card account by effective date checks the card posting's date, not any posting's.
- Transaction-level clauses (`primaryTag`, `involves`, `occurrence`, and time clauses on `accounting` and `txn-effective`) give the same answer for every posting of a transaction. With only such clauses, every posting of a matching transaction matches.
- **A posting's values in a query.** Filtering and grouping read the same values from a posting:

| Value | Taken from |
| --- | --- |
| Tags | The posting's own tags plus its transaction's |
| References | The posting's own references; its transaction's when the posting has none. On an obligation, the obligation's entities instead, whatever the posting or its transaction names (see [obligations.md](obligations.md), "Entities of an obligation") |
| Metadata | For each key, the posting's value; its transaction's when the posting has none |
| Status, effective time | The posting's (see [transactions.md](transactions.md), "Concepts") |

- **The empty posting.** A transaction with no postings is checked as one empty posting that carries the transaction's values and has no account and no amount. An `accounts` clause never matches it, so a query that names accounts leaves such transactions out. A transaction matched this way appears when iterating the query, but never in `postings()`, in groups or in `balance`.

### Axis of a query

Status: `implemented`

- Without an axis, every use of a query (listing transactions, listing postings, grouping, `balance` and `register`) uses `effective`. The `accounting` and `txn-effective` axes are used only when the query sets them.

### Ordering

Status: `implemented`

| Output | Ordered by |
| --- | --- |
| Transactions | The transaction's time on the axis: its accounting time for `accounting`, its effective time otherwise |
| Postings | The posting's time on the axis: its own effective time for `effective`, its transaction's time otherwise |

- Each time sorts at its end, and ties are broken, as in [transactions.md](transactions.md), "Order of transactions".
- A running balance is built by the presentation layer: start from `balance` at the beginning of the range and add each posting in order.

### Grouping

Status: `implemented`

Only matched postings are grouped.

| Key | Groups by |
| --- | --- |
| `account` | The posting's account |
| `entity` | The posting's references (see "Matched postings") |
| `commodity` | The commodity of the posting's amount |
| `tag` | The posting's tags (see "Matched postings"), as `<scope>:<anchor>` |
| `primaryTag` | The transaction's primary tag |
| `day`, `week`, `month`, `quarter`, `year` | Local dates on the query's axis; weeks follow `week-start`. Labels: `2026-10-11`, `2027-W01`, `2026-10`, `2026-Q4`, `2026` |
| `meta:<key>` | The posting's metadata value for `key` (see "Matched postings") |

- Several keys combine into nested groups; a key given twice counts once. With no key, there is one group, whose `key` is empty.
- A posting with no value for a key falls in the "none" group.
- A posting with several values (several tags, several references, a time spanning several buckets) belongs to each of them, so such groups may add up to more than the whole. A record spanning several buckets counts in full in each one it overlaps. When the query has a time range, only buckets inside it are listed.
- Rows are sorted by their key values in key order, comparing code points; the "none" group comes first.
- The account tree is not a grouping key; it is laid out by `balance` and `register` (see "Account tree").

### Account tree

Status: `implemented`

The account tree lays matched postings out by account, with subtotals for parent accounts. `balance` and `register` use it.

- Each account with postings of its own has a row with `subtotal` false, holding only those postings.
- A parent account gets a row with `subtotal` true that includes all its sub-accounts, but only when some sub-account has postings of its own.
- So an account with postings of its own and sub-accounts with postings has two rows: its subtotal, then its own.
- Rows are sorted by account name segment by segment, comparing each segment's code points, so that `Assets:Cash` follows `Assets` before `Assets-X`; for the same account, the subtotal comes first.
- With `income-expense` on, income and expense accounts appear under the merged root, by their merged names (see [accounts.md](accounts.md), "Combined income and expense").

### Aggregation

Status: `implemented`

| Function | Result per group |
| --- | --- |
| `sum` | One total per commodity, sorted by commodity; never converted. A commodity whose total is zero is kept |
| `count` | The number of distinct transactions |

### `balance`

Status: `implemented`

`balance` sums the matched postings on the account tree.

- On the default `effective` axis, each posting counts on the day it hit its account, so account balances agree with the bank. On `accounting`, whole transactions move together, so all accounts add up to zero and income agrees with equity.
- It is a period report: `within` is read as `overlaps`, so a record whose time spans the period's boundary still shows, in full. A query listing keeps `within` literal.

### `register`

Status: `implemented`

`register` gives the same rows as `balance` for the same query, and each row that is not a subtotal also lists the postings it counts. It reads `within` as `balance` does.

### Settled obligations in `balance` and `register`

Status: `implemented`

- `balance` and `register` leave out the rows of settled obligations unless the option `all` is set, as described in [obligations.md](obligations.md), "Hiding settled obligations".
- Subtotal rows stay, including a parent all of whose obligations are hidden.

## API

- `query(ledger)` starts a query over the ledger with no clauses.
- Each clause in "Filtering" is a method of the same name that returns a new query. Time clauses take a time and throw when it is rejected (see [time.md](time.md), "Times given to the API"). `ids`, `accounts`, `entities`, `tags`, `status`, `involves` and `occurrence` take any number of values.
- Iterating a query yields the matching transactions, whole and with metadata, in "Ordering" order.
- `postings()` returns the matched postings, in "Ordering" order.
- `groupBy(...keys)` returns a grouped query with `sum()` and `count()`, each returning a list of groups.
- `balance(ledger, query?, options?)` returns the account tree rows of `balance`; without a query, it covers the whole ledger. The option `all` also lists settled obligations.
- `register(ledger, query?, options?)` returns the account tree rows of `register`; without a query, it covers the whole ledger. It takes the same option `all`.
- The rows of an obligation's progress come from `obligations` (see [obligations.md](obligations.md), "API"); `query` has no aggregate for them.

Which axis suits which use is described in [time.md](time.md), "Time axes".

| Use | Query |
| --- | --- |
| Account balances at a point | `balance(ledger, query(ledger).until(at))` |
| Cash flow | `balance(ledger, query(ledger).accounts(…asset accounts).within(period))` |
| Income statement | `balance(ledger, query(ledger).accounts(…income and expense accounts).within(period).axis("accounting"))` |
| Primary-tag totals | `query(ledger).axis("accounting").within(period).groupBy("primaryTag").sum()` |
| Register of an account in a period | `query(ledger).accounts(id).within(period)` |
| Register laid out by account | `register(ledger, query(ledger).within(period))` |
| Calendar view | `query(ledger).axis("txn-effective").overlaps(month)` |
| Members of a group | `query(ledger).tags("<scope>:<anchor>")` or `query(ledger).primaryTag(name)`; the anchor's record with `query(ledger).ids(anchor)` (see [anchors.md](anchors.md), "Groups") |

## Examples

```hueke
2026-01-01 * "Opening"
    Bank:Checking      80000 NTD
    Assets:Cash         5000 NTD
    Equity:Opening    -85000 NTD

2026-10-12 "Confirmed with NAT: 800 owed" @NAT
```

| Call | Result |
| --- | --- |
| `balance(ledger, query(ledger).until("2026-01-01"))` | Rows, in this order: `Assets` (subtotal) 5000 NTD, `Assets:Cash` 5000 NTD, `Bank` (subtotal) 80000 NTD, `Bank:Checking` 80000 NTD, `Equity` (subtotal) −85000 NTD, `Equity:Opening` −85000 NTD |
| Iterating `query(ledger).axis("txn-effective").within("2026-10-12")` | The transaction with no postings |
| Iterating `query(ledger).entities("NAT")` | The transaction with no postings |
| Iterating `query(ledger).entities("NAT").accounts("Assets:Cash")` | Nothing |
| `query(ledger).entities("NAT").postings()` | No postings |
| `balance(ledger, query(ledger).accounts("Assets:Cash").until("2025-12-31"))` | No rows |

```hueke
2026-11-01 * "Opening"
    Bank:Checking      50000 NTD
    Equity:Opening    -50000 NTD

2026-11-20 ! "Book to buy"
    Expenses:Other     1000 NTD
    Bank:Checking     -1000 NTD

2026-11-30=2026-12 * "Prepaid December rent"
    Expenses:Housing     15000 NTD
    Bank:Checking       -15000 NTD [2026-12-02]
```

| Call | Result |
| --- | --- |
| Balance of `Bank:Checking` until 2026-11-30 | 50000 NTD: the planned purchase does not count, and the rent hits the bank on 2026-12-02 |
| Balance of `Bank:Checking` until 2026-12-02 | 35000 NTD |
| `balance(ledger, query(ledger).accounts("Bank:Checking").until("2026-11-30").occurrence("planned"))` | `Bank:Checking` −1000 NTD |

```hueke
2026-10-12T12:30 * "Lunch"
    Expenses:Food              180 NTD
    Liabilities:CreditCard    -180 NTD [2026-10-14]

2026-10-12 * "Supermarket"
    Expenses:Groceries     600 NTD
    Assets:Cash           -600 NTD

2026-10-10=2026-10-10..2026-10-13 * "Trip lodging"
    Expenses:Lodging     8000 NTD
    Bank:Checking       -8000 NTD

2026-09-28=2026-09-28..2026-10-03 * "Workshop"
    Expenses:Education     3000 NTD
    Bank:Checking         -3000 NTD

2026-10-01=2026-10 * "October building fee"
    Expenses:Housing     2000 NTD
    Bank:Checking       -2000 NTD
```

The periods are accounting times: a posting's effective time is one day or one moment (see [time.md](time.md), "Time axes"). With `q = query(ledger).axis("accounting")`:

| Call | Transactions |
| --- | --- |
| `q.overlaps("2026-10")` | Workshop, Lunch, Supermarket, Trip lodging, October building fee, in this order: each sorts at the end of its time |
| `q.within("2026-10")` | Lunch, Supermarket, Trip lodging, October building fee |
| `q.overlaps("2026-10-12")` | Lunch, Supermarket, Trip lodging, October building fee |
| `q.covers("2026-10-12")` | Supermarket, Trip lodging, October building fee |
| `q.covers("2026-10")` | October building fee |
| `q.overlaps("2026-10-14")` | October building fee: the card posting's own date is not on this axis |
| `balance(ledger, q.accounts("Expenses").until("2026-10-12"))` | `Expenses` (subtotal) 3780 NTD, `Expenses:Education` 3000 NTD, `Expenses:Food` 180 NTD, `Expenses:Groceries` 600 NTD: the lodging and the fee have not ended yet |
| `q.overlaps("2026-10").groupBy("day").count()` | 31 groups, 2026-10-01 to 2026-10-31; 2026-10-12 counts 4 |

```hueke
2026-10-01 * "Opening"
    Bank:Checking      1000 NTD
    Equity:Opening    -1000 NTD

2026-10-25 * "Late transfer"
    Expenses:Other      100 NTD
    Bank:Checking      -100 NTD

2026-10-25 balance Bank:Checking 950 NTD pad -> Expenses:ReconcileDiff
```

`query(ledger).accounts("Bank:Checking").postings()` lists the opening, the late transfer, then the generated 50 NTD padding: it comes after the transfer, which has the same time.

**Grouping and aggregation**

```hueke
2026-10-05 * "October salary" @acme
    Bank:Checking     50000 NTD
    Income:Salary    -50000 NTD

2026-10-12 "Lunch with NAT" @NAT #food
    ;; place: Xinyi
    Expenses:Food      600 NTD
    Assets:Cash       -600 NTD

2026-10-20 * "Dinner with NAT and KEN" @NAT @KEN #food #friends
    Expenses:Food     1200 NTD
        ;; place: Daan
    Assets:Cash      -1200 NTD

2026-11-02 * "Tokyo snacks" #food
    Expenses:Food     1000 JPY @@ 220 NTD
    Assets:Cash       -220 NTD
```

With `e = query(ledger).accounts("Expenses")`, each call returns these groups, in this order:

| Call | Groups |
| --- | --- |
| `e.groupBy().sum()` | One group with an empty `key`: 1000 JPY, 1800 NTD |
| `e.groupBy("account").sum()` | `Expenses:Food`: 1000 JPY, 1800 NTD |
| `e.groupBy("commodity").sum()` | JPY 1000 JPY; NTD 1800 NTD |
| `e.groupBy("entity").sum()` | "none" 1000 JPY; `KEN` 1200 NTD; `NAT` 1800 NTD. The dinner counts for both, so the groups add up to more than the whole |
| `e.groupBy("tag").sum()` | `tag:food` 1000 JPY, 1800 NTD; `tag:friends` 1200 NTD |
| `e.groupBy("meta:place").sum()` | "none" 1000 JPY; `Daan` 1200 NTD, the posting's own value; `Xinyi` 600 NTD, taken from the lunch's transaction |
| `e.groupBy("week").sum()` | `2026-W42` 600 NTD; `2026-W43` 1200 NTD; `2026-W45` 1000 JPY |
| `e.groupBy("month").sum()` | `2026-10` 1800 NTD; `2026-11` 1000 JPY |
| `e.groupBy("quarter").sum()` and `e.groupBy("year").sum()` | One group each, `2026-Q4` and `2026`: 1000 JPY, 1800 NTD |
| `e.groupBy("month", "commodity").sum()` | (`2026-10`, NTD) 1800 NTD; (`2026-11`, JPY) 1000 JPY |
| `e.groupBy("entity", "entity").sum()` | The same groups as `e.groupBy("entity").sum()` |
| `query(ledger).groupBy("entity").count()` | "none" 1; `KEN` 1; `NAT` 2; `acme` 1: transactions, not postings |
| `e.within("2026-10").groupBy("week").sum()` | `2026-W42` 600 NTD; `2026-W43` 1200 NTD: the snacks are outside the range |

| Call | Result |
| --- | --- |
| `query(ledger).status("none").postings()` | The lunch's two postings |
| `query(ledger).status("cleared").postings()` | The postings of the salary, the dinner and the snacks |
| Iterating `query(ledger).involves("JPY")` | The snacks |
| Iterating `query(ledger).involves("JPY", "NTD")` | The snacks: it has amounts in both |
| Iterating `query(ledger).involves("JPY", "USD")` | Nothing |
| Iterating `query(ledger).involves("NTD")` | All four transactions |
