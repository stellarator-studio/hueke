# Command line

`hueke` is a command-line shell around the API: each command reads one ledger, calls the API and prints the result. This document covers how `hueke` loads a ledger, its commands and filter options, valuation, metadata columns, its output formats and its exit status.

## Features

| Feature | Status |
| --- | --- |
| Loading | `implemented` |
| Commands | `implemented` |
| `obligations` and `group` | `implemented` |
| Filters | `implemented` |
| Settled obligations and display names | `implemented` |
| `trades` and `holdings` | `specified` |
| Metadata columns | `specified` |
| Output | `implemented` |
| Exit status | `implemented` |

## Concepts

The command is named `hueke`. It computes nothing the API does not return, apart from the running balance of `reconcile --balance`, which it adds up with the API's value arithmetic (see [core/values.md](core/values.md), "Arithmetic"), and it never writes files.

```text
hueke <command> [arguments] --file <path> [options]
```

## Behavior

### Loading

Status: `implemented`

| Option | Meaning |
| --- | --- |
| `--root <dir>` | The ledger's root directory; logical paths start here. Default: the current directory. |
| `--file <path>` | The root file. Required. An absolute path is used as is; any other path starts from the current directory. Either way it must be inside `--root`. |
| `--strict` | Strict mode for every kind, whatever the ledger says, as when creating the ledger with strict mode. |

- Files are read as UTF-8 and parsed. Each is loaded under its path relative to `--root`, with `/` separators.
- Starting from the root file, `hueke` reads every file the modules include, and every group ledger that shared accounts refer to, as `referencedSources` lists them (see [core/modules.md](core/modules.md), "API"); then it initializes the ledger from the root file. An included file that cannot be read is left out, so Core reports `module.missing` for it; a group ledger that cannot be read, `shared.unknown-module`. A root file that cannot be read is a usage error (see "Exit status").
- When the ledger has diagnostics of severity `warning` or `error`, every command except `check` still runs and prints its result to standard output. After the result, it prints those diagnostics to standard error, in the format `check` uses in a table, so that the user can find what went wrong; `info` diagnostics are left out. The exit status is not changed.

### Commands

Status: `implemented`

| Command | Arguments | API |
| --- | --- | --- |
| `check` | None | `check` |
| `balance` | Accounts, sub-accounts included; none means all | `balance` |
| `query` | Accounts, sub-accounts included; none means all | `query(…).postings()` |
| `register` | Accounts, sub-accounts included; none means all | `register` |
| `reconcile` | Exactly one account; `--at` is required | `reconcile` |

- `obligations` and `group` are described in "`obligations` and `group`".
- `hueke --help` and `hueke <command> --help` print usage to standard output and exit 0; `-h` is the same as `--help`.
- `hueke` with no command prints the usage to standard error and exits 2.

### `obligations` and `group`

Status: `implemented`

| Command | Arguments | API |
| --- | --- | --- |
| `obligations` | Obligation accounts or obligations, sub-accounts included; none means every obligation account | `obligations` |
| `group` | Exactly one tag written in full, `#<scope>:<anchor>`, or one primary tag, `^anchor` or `^shared:<name>` | `query(…).ids(…)` for the anchor's record, and `query(…).tags(…)` or `query(…).primaryTag(…)` for the members |

- `obligations` takes `--at`, `--who` with one entity, `--all` and `--name`. It reads `--at` as its `at`; without `--at`, it counts the whole ledger.
- `group` takes no options besides loading and output. It lists the anchor's record, when one defines the anchor, then the group's members (see [core/anchors.md](core/anchors.md), "Groups"). The anchor's record is looked up among `occurred` transactions, and then among `planned` and `cancelled` ones when none matched; members are `occurred` transactions.
- A tag without a scope, such as `#travel`, is a usage error: write `#tag:travel`.
- In a shell, quote an argument that starts with `#` or `^`: `hueke group '#refund:t_book' --file main.hueke`.

### Filters

Status: `implemented`

`balance`, `query` and `register` build one query from these options. Together they combine with AND.

| Option | Query clause |
| --- | --- |
| Account arguments | `accounts` |
| `--at <time>` | `until` |
| `--period <time>` | `within` |
| `--overlaps <time>` | `overlaps` |
| `--covers <time>` | `covers` |
| `--axis <axis>` | `axis`: `accounting`, `effective`, `txn-effective`, or `meta:<key>` [specified] (see [core/query.md](core/query.md), "Metadata axes") |
| `--status <status,…>` | `status`: `none`, `cleared` |
| `--involves <commodity,…>` | `involves` |
| `--planned`, `--cancelled` | `occurrence`; both together list both |
| `--id <id,…>` | `ids`: anchors or generated IDs |
| `--who <entity,…>` | `entities` |
| `--tag <tag,…>` | `tags`, each written in full as in the API, with or without `#`: `--tag tag:travel,refund:t_book` |
| `--primary <anchor>` | `primaryTag` |
| `--breakdown <name,…>` | `breakdown`: the posting has a breakdown line with one of the names, matched exactly as written (see [core/query.md](core/query.md), "Breakdown lines"); a name with `,` cannot be given |

- Each option is written at most once; writing one twice is a usage error.
- Times are text, read as the API reads them (see [core/time.md](core/time.md), "Times given to the API"): `--period 2026-10`, `--at 2026-10-31`, `--period 2026-11..2026-12`. A time the API rejects is a usage error.
- Without `--axis`, these commands use the API's default, `effective` (see [core/query.md](core/query.md), "Axis of a query").
- `--depth <n>` (`balance` only, n from 1) leaves out rows whose account has more than n segments. It changes only what is shown.
- `reconcile` takes no filters; `--at` is its `at`.

### Settled obligations and display names

Status: `implemented`

- `--all` (`balance`, `register` and `obligations`) also lists settled obligations (see [core/obligations.md](core/obligations.md), "Hiding settled obligations").
- `--name` (`balance`, `register`, `query` and `obligations`) shows each account's and entity's display name in place of its ID, when it has one (see [core/entities.md](core/entities.md), "Display names"). It changes only what is shown; arguments and filters still take IDs.
- `--balance` (`reconcile` only) adds the balance after each of the period's postings, and moves opening and closing into that balance column. It changes only what is shown.

### `trades` and `holdings`

Status: `specified`

| Command | Arguments | API |
| --- | --- | --- |
| `trades` | The held commodity, then accounts, sub-accounts included; no accounts means all | `trades` |
| `holdings` | Optionally the held commodity, then accounts, sub-accounts included; no accounts means all | `holdings` |

| Option | Commands | Meaning |
| --- | --- | --- |
| `--in <commodity>` | Both; required | The quote commodity |
| `--period <time>` | `trades` | The range of rows listed |
| `--at <time>` | `holdings`; required | The point |
| `--convert` | Both | Convert costs in other commodities to the quote |
| `--value ledger`, `--value cost` | `holdings` | Value from the ledger's prices, or at cost |
| `--price <commodity>=<unit price>` | `holdings`; may repeat | A price table entry, such as `--price AAPL=175`; commodities not listed are valued from the ledger. Not together with `--value` |

- The first argument of `holdings` is the held commodity when its first segment is not the first segment of any account of the ledger; otherwise every argument is an account, and every commodity held is listed.
- What they compute is described in [core/valuation.md](core/valuation.md). The `valuation.*` warnings of the result are printed to standard error after it, in the format of ledger diagnostics, without a place.
- `--price` and `--value` written together, or a price that is not a number, is a usage error.

### Metadata columns

Status: `specified`

- `--meta <key,…>` (`query`, `register` and `group`) adds one column per key, after `description`, with each posting's metadata value for the key, else its transaction's (see [core/query.md](core/query.md), "Matched postings"); empty when neither has one. It changes only what is shown.
- Without `--meta`, the keys come from the metadata `view_meta`, a comma-separated list of keys, such as `;; view_meta: summary,memo`: in `query` and `register` with exactly one account argument, that account's; in `group`, the anchor's record's. Otherwise no column is added. Core keeps `view_meta` as any other metadata and gives it no meaning.
- In CSV, each column's header is `meta:<key>`.

### Output

Status: `implemented`

`--format table` (default) or `csv`. `reconcile` and `register` have only `table`.

| Command | One row per | Fields |
| --- | --- | --- |
| `check` | Diagnostic | `source`, `line`, `column`, `severity`, `code`, `message` |
| `balance` | Row of `balance`, in its order, and then one line per commodity | `account`, `subtotal`, `depth`, `value`, `commodity` |
| `register` | Row of `register`, in its order, and then one line per commodity; after a row, its postings as `query` rows | Table only |
| `query` | Matched posting, in query order | `date`, `transaction`, `posting`, `occurrence`, `status`, `account`, `value`, `commodity`, `description`, then the metadata columns [specified] |
| `trades` [specified] | Trade row, in its order | `date`, `transaction`, `posting`, `quantity`, `commodity`, `unit_price`, `total`, `cost`, `realized`, `average_cost`, `quote` |
| `holdings` [specified] | Holding, in its order | `commodity`, `quantity`, `cost`, `average_cost`, `unit_price`, `value`, `unrealized`, `value_source`, `quote` |
| `obligations` | Row of `obligations`, in its order | `account`, `commodity`, `entities` (separated by `,`), `original`, `repaid`, `remaining`, `settled`, `last_repaid` |
| `group` | The anchor's record, then each member transaction in query order | `role` (`anchor` or `member`), `date`, `kind`, `id`, `description`. The date is the effective time, a posting's own for a posting; a posting's `description` is its transaction's; for an account, `date` and `description` are empty. A table shows the same columns, without a header |
| `reconcile` | View, one per commodity | The account, commodity and range, opening, the period's postings, closing, asserted, difference, then the uncleared postings as `query` rows. With `--balance`, each posting of the period also shows the balance after it, and the amounts of opening and closing are shown in that column |

- `date` is the posting's time on the query's axis, as written, as `timeOnAxis` gives it (see [core/time.md](core/time.md), "API"). In `reconcile`, it is always the posting's effective time.
- **Tables.** Each table is aligned on its own: in `register`, the account rows share one alignment and each row's postings another; in `reconcile`, each view has its own. Amounts are written as `valueText` and `formatText` write them (see [core/commodities.md](core/commodities.md), "API"), never rounded: `12,300 NTD`, or `12.300,50 EUR` with decimal mark `,` and group mark `.`; a fraction as `28,300/3 NTD`; through a format, `1,000 shares (0050)` or `-$1,234.50`. Where the commodity has a column of its own, as in `obligations`, the value is written alone and no format is used; a `reconcile` view names its commodity in its heading by code, and its amounts still use the format. `balance` indents each account two spaces per segment after the first and marks subtotal rows `(total)`. `query` shows a mark: `!` planned, `#` cancelled, `*` cleared. `check` prints `<source>:<line>:<column>: <severity> <code>: <message>`. Several `reconcile` views are separated by a blank line.
- In `obligations`, `settled` is shown as `settled` or `open` in tables, and as `true` or `false` in CSV; `last_repaid` is the time as written, empty when there is none.
- **CSV.** A header row, then the fields as plain text; amounts are the API's values, with `.` as the decimal mark, no group mark and no padding. Fields containing `,`, `"` or a line break are quoted.
- In `trades` and `holdings`, a field the API leaves out is empty. [specified]
- JSON output is not available.

### Exit status

Status: `implemented`

| Status | When |
| --- | --- |
| 0 | Success. For `check`: no diagnostic of severity `error`. For the other commands, also when the ledger has errors (see "Loading"). |
| 1 | `check` found an error. |
| 2 | A usage error: an unknown command or option, an option written twice, an option that does not apply to the command, an argument the command does not take, such as one after `check`, a missing `--file`, a root file outside `--root` or that cannot be read, or an invalid value such as a time the API rejects. Any other error thrown while running a command is treated the same way. The message goes to standard error as `hueke: <message>`, except with no command (see "Commands"). |

## Examples

`main.hueke`:

```hueke
option timezone Asia/Taipei
account-root Bank asset
commodity NTD
    precision 0

2026-10-01 * "Opening"
    Bank:Checking     12300 NTD
    Equity:Opening   -12300 NTD

2026-10-03 "Bookstore"
    Expenses:Other     500 NTD
    Bank:Checking     -500 NTD

2026-10-12 * "Supermarket"
    Expenses:Groceries     2700 NTD
    Bank:Checking         -2700 NTD [2026-10-14]

2026-10-25 balance Bank:Checking 9100 NTD
```

```text
$ hueke balance --file main.hueke --at 2026-10-31
  9,100 NTD  Bank (total)
  9,100 NTD    Bank:Checking
-12,300 NTD  Equity (total)
-12,300 NTD    Equity:Opening
  3,200 NTD  Expenses (total)
  2,700 NTD    Expenses:Groceries
    500 NTD    Expenses:Other
```

```text
$ hueke query Bank --file main.hueke --axis effective --period 2026-10-10..2026-10-20
2026-10-14  *  Bank:Checking  -2,700 NTD  Supermarket
```

```text
$ hueke register Bank --file main.hueke --axis effective --period 2026-10-10..2026-10-20
-2,700 NTD  Bank (total)
-2,700 NTD    Bank:Checking
2026-10-14  *  Bank:Checking  -2,700 NTD  Supermarket
```

```text
$ hueke reconcile Bank:Checking --file main.hueke --at 2026-10-25
Bank:Checking  NTD  start .. 2026-10-25
opening             0 NTD
2026-10-01  *  12,300 NTD  Opening
2026-10-03       -500 NTD  Bookstore
2026-10-14  *  -2,700 NTD  Supermarket
closing         9,100 NTD
asserted        9,100 NTD
difference          0 NTD

uncleared
2026-10-03    Bank:Checking  -500 NTD  Bookstore
```

```text
$ hueke reconcile Bank:Checking --file main.hueke --at 2026-10-25 --balance
Bank:Checking  NTD  start .. 2026-10-25
opening                         0 NTD
2026-10-01  *  12,300 NTD  12,300 NTD  Opening
2026-10-03       -500 NTD  11,800 NTD  Bookstore
2026-10-14  *  -2,700 NTD   9,100 NTD  Supermarket
closing                     9,100 NTD
asserted        9,100 NTD
difference          0 NTD

uncleared
2026-10-03    Bank:Checking  -500 NTD  Bookstore
```

| Command | Result |
| --- | --- |
| `hueke check --file main.hueke` | No output, status 0 |
| `hueke balance --file main.hueke --at 2026-10-31`, with the Balance changed to 9000 NTD | The same rows on standard output; `main.hueke:18:1: error balance.mismatch: …` on standard error; status 0 |
| `hueke balance --root ledger --file ledger/main.hueke` | Reads `ledger/main.hueke`, loaded as `main.hueke` |
| `hueke balance --root ledger --file main.hueke` | Status 2: `main.hueke` in the current directory is outside `--root` |
| `hueke balance Expenses --file main.hueke --period 2026-10 --depth 1` | One row: `3,200 NTD  Expenses (total)` |
| `hueke query --file main.hueke --status none --format csv` | A header and the two `Bookstore` postings |
| `hueke reconcile Bank:Checking --file main.hueke --at 2026-10-25 --balance` | The view with the balance after each posting, as above |
| `hueke balance --file main.hueke --balance` | Status 2: `hueke: --balance does not apply to balance` |
| `hueke reconcile --file main.hueke --at 2026-10-25` | Status 2: `hueke: reconcile takes exactly one account` |
| `hueke balance --file main.hueke --format xml` | Status 2: `hueke: unknown format "xml"` |
| `hueke balance --file main.hueke --period 2026-13` | Status 2; the message names `parse.invalid-time` |
| `hueke balance --file main.hueke --at 2026-10-31T12:00` | Status 2; the message names `query.time-of-day` |
| `hueke balance --file main.hueke --at 2026-10-31 --at 2026-11-30` | Status 2: `--at` is written twice |
| `hueke forecast --file main.hueke` | Status 2: `hueke: unknown command "forecast"` |

With these lines added to `main.hueke`:

```hueke
account Assets:Receivable
    obligation receivable
    pad-account Expenses:WriteOff

entity NAT
    display-name Nat Chen

2026-10-11 * %t_lunch "Lunch"
    Expenses:Food                   600 NTD
    Assets:Receivable:lunch-1011    400 NTD @NAT
    Assets:Cash                   -1000 NTD

2026-10-20 * "NAT pays back part" #t_lunch
    Assets:Cash                     250 NTD
    Assets:Receivable:lunch-1011   -250 NTD
```

```text
$ hueke obligations --file main.hueke --at 2026-10-31 --name
Assets:Receivable:lunch-1011  NTD  Nat Chen  400  250  150  open  2026-10-20
```

| Command | Result |
| --- | --- |
| `hueke obligations --file main.hueke` | The same row as with `--at 2026-10-31`: without `--at`, the whole ledger counts |
| `hueke query --file main.hueke --who NAT` | Both `Assets:Receivable:lunch-1011` postings: NAT accumulates the obligation, so its whole chain matches, including the repayment that names no one |
| `hueke group '#tag:t_lunch' --file main.hueke --format csv` | A header, the anchor row `anchor,2026-10-11,transaction,t_lunch,Lunch`, then the member row for 2026-10-20 |
| `hueke group '#tag:travel' --file main.hueke` | No anchor row, no members: no record defines or carries `travel`. With `#travel` on a transaction, that transaction is listed as a member |
| `hueke group '#travel' --file main.hueke` | Status 2: the tag has no scope |
| `hueke balance Assets:Receivable --file main.hueke --at 2026-10-31` | `Assets (total)`, `Assets:Receivable (total)` and `Assets:Receivable:lunch-1011`, each 150 NTD |
| `hueke balance Assets --file main.hueke --who NAT` | The same three rows: only the obligation's postings take NAT |
| `hueke balance --file main.hueke --id t_lunch` | The lunch's accounts: `Assets (total)` −600 NTD, `Assets:Cash` −1,000 NTD, `Assets:Receivable (total)` and `Assets:Receivable:lunch-1011` 400 NTD, `Expenses (total)` and `Expenses:Food` 600 NTD |
| `hueke register Assets --file main.hueke --id t_lunch` | The `Assets` rows above, each row that is not a total followed by its posting of 2026-10-11 |
| `hueke balance --file main.hueke --tag tag:t_lunch` | The repayment's accounts: `Assets (total)` 0 NTD, `Assets:Cash` 250 NTD, `Assets:Receivable (total)` and `Assets:Receivable:lunch-1011` −250 NTD |
| `hueke balance --file main.hueke --tag t_lunch` | Status 2; the message names `query.tag-without-scope` |
| `hueke balance --file main.hueke --primary t_lunch` | No rows: `#t_lunch` is a tag, not a primary tag. With `^t_lunch` in its place on the 2026-10-20 header, the same rows as `--tag tag:t_lunch` |

In CSV:

```text
$ hueke query --file main.hueke --id t_lunch --format csv
date,transaction,posting,occurrence,status,account,value,commodity,description
2026-10-11,t_lunch,t_lunch.1,occurred,cleared,Expenses:Food,600,NTD,Lunch
2026-10-11,t_lunch,t_lunch.2,occurred,cleared,Assets:Receivable:lunch-1011,400,NTD,Lunch
2026-10-11,t_lunch,t_lunch.3,occurred,cleared,Assets:Cash,-1000,NTD,Lunch
```

```text
$ hueke obligations --file main.hueke --format csv --name
account,commodity,entities,original,repaid,remaining,settled,last_repaid
Assets:Receivable:lunch-1011,NTD,Nat Chen,400,250,150,false,2026-10-20
```

With these lines also added to `main.hueke`:

```hueke
2026-10-15 * %lunch "Lunch" @seven
    Expenses:Food       120 NTD
        - Bento  = 95 NTD
        - Egg  = 25 NTD
    Expenses:Drinks      45 NTD
        - Black tea  1 * 45 NTD = 45 NTD
    Assets:Cash        -165 NTD

2026-10-22 %market "Market" @lawson
    Expenses:Drinks      80 NTD
        - Black tea  2 * 40 NTD = 80 NTD
    Expenses:Groceries  120 NTD
        - Apples  2 kg
    Assets:Cash        -200 NTD
```

| Command | Result |
| --- | --- |
| `hueke query --file main.hueke --breakdown 'Black tea'` | The two `Expenses:Drinks` postings |
| `hueke balance Expenses --file main.hueke --breakdown 'Black tea'` | `Expenses (total)` and `Expenses:Drinks`, each 125 NTD: the postings' amounts, not the lines' totals |
| `hueke query Assets --file main.hueke --breakdown 'Black tea'` | No postings: the cash postings have no lines of their own |
| `hueke query --file main.hueke --breakdown 'black tea'` | No postings: names match exactly |

**Valuation and metadata columns** [specified]

With these lines added to `main.hueke`:

```hueke
commodity USD
    precision 2
commodity AAPL
    precision 0

2026-10-01 * %buy "Buy"
    Assets:Broker    10 AAPL @ 150 USD
    Bank:USD       -1500 USD

2026-10-10 * %sell "Sell"
    Assets:Broker    -5 AAPL @ 180 USD
    Bank:USD         900 USD

2026-10-28 * "Rent"
    ;; memo: October rent
    Expenses:Housing   15000 NTD
    Bank:Checking     -15000 NTD
```

| Command | Result |
| --- | --- |
| `hueke trades AAPL Assets:Broker --in USD --file main.hueke --format csv` | A header, then `2026-10-01,buy,buy.1,10,AAPL,150,1500,1500,,150,USD` and `2026-10-10,sell,sell.1,-5,AAPL,180,900,750,150,150,USD` |
| `hueke holdings AAPL Assets:Broker --in USD --at 2026-10-31 --file main.hueke` | 5 AAPL, cost 750 USD, average cost 150 USD |
| The same with `--value ledger` | Also unit price 180 USD, value 900 USD, unrealized 150 USD, source `ledger` |
| The same with `--price AAPL=200` | Unit price 200 USD, value 1,000 USD, unrealized 250 USD, source `table` |
| `hueke holdings Assets:Broker --in USD --at 2026-10-31 --file main.hueke` | The same row: `Assets` is an account's first segment, so every argument is an account |
| `hueke holdings AAPL --in USD --file main.hueke` | Status 2: `--at` is required |
| `hueke holdings AAPL --in USD --at 2026-10-31 --value ledger --price AAPL=200 --file main.hueke` | Status 2 |
| `hueke query Bank:Checking --file main.hueke --meta memo` | The `query` rows of `Bank:Checking` with a `memo` column: `October rent` for the rent, empty for the others |
| `hueke query Bank:Checking --file main.hueke`, with `;; view_meta: memo` under `account Bank:Checking` | The same `memo` column |
