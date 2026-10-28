# Command line

`hueke` is a command-line shell around the API: each command reads one ledger, makes one API call and prints the result. This document covers how `hueke` loads a ledger, its commands and filter options, its output formats and its exit status.

## Features

| Feature | Status |
| --- | --- |
| Loading | `specified` |
| Commands | `specified` |
| Filters | `specified` |
| Output | `specified` |
| Exit status | `implemented` |

## Concepts

The command is named `hueke`. It computes nothing the API does not return, and it never writes files.

```text
hueke <command> [arguments] --file <path> [options]
```

## Behavior

### Loading

Status: `specified`

| Option | Meaning |
| --- | --- |
| `--root <dir>` | The ledger's root directory; logical paths start here. Default: the current directory. |
| `--file <path>` | The root file. Required. An absolute path is used as is; any other path starts from the current directory. Either way it must be inside `--root`. |
| `--strict` | Strict mode for every kind, whatever the ledger says, as when creating the ledger with strict mode. |

- Files are read as UTF-8 and parsed. Each is loaded under its path relative to `--root`, with `/` separators.
- Starting from the root file, `hueke` asks which files each module includes and reads them too, until no new file is found; then it initializes the ledger from the root file. An included file that cannot be read is left out, so Core reports `module.missing` for it. A root file that cannot be read is a usage error (see "Exit status").
- When the ledger has diagnostics of severity `warning` or `error`, every command except `check` still runs and prints its result to standard output. After the result, it prints those diagnostics to standard error, in the format `check` uses in a table, so that the user can find what went wrong; `info` diagnostics are left out. The exit status is not changed.

### Commands

Status: `specified`

| Command | Arguments | API |
| --- | --- | --- |
| `check` | None | `check` |
| `balance` | Accounts, sub-accounts included; none means all | `balance` |
| `query` | Accounts, sub-accounts included; none means all | `query(…).postings()` |
| `register` | Accounts, sub-accounts included; none means all | `register` |
| `reconcile` | Exactly one account; `--at` is required | `reconcile` |

- `hueke --help` and `hueke <command> --help` print usage to standard output and exit 0; `-h` is the same as `--help`.
- `hueke` with no command prints the usage to standard error and exits 2.

### Filters

Status: `specified`

`balance`, `query` and `register` build one query from these options. Together they combine with AND.

| Option | Query clause |
| --- | --- |
| Account arguments | `accounts` |
| `--at <time>` | `until` |
| `--period <time>` | `within` |
| `--overlaps <time>` | `overlaps` |
| `--covers <time>` | `covers` |
| `--axis <axis>` | `axis`: `accounting`, `effective` or `txn-effective` |
| `--status <status,…>` | `status`: `none`, `cleared` |
| `--involves <commodity,…>` | `involves` |
| `--planned`, `--cancelled` | `occurrence`; both together list both |

- Each option is written at most once; writing one twice is a usage error.
- Times are text, read as the API reads them (see [core/time.md](core/time.md), "Times given to the API"): `--period 2026-10`, `--at 2026-10-31`, `--period 2026-11..2026-12`. A time the API rejects is a usage error.
- Without `--axis`, these commands use the API's default, `effective` (see [core/query.md](core/query.md), "Axis of a query").
- `--depth <n>` (`balance` only, n from 1) leaves out rows whose account has more than n segments. It changes only what is shown.
- `reconcile` takes no filters: it reads `--at` as its `at`.

### Output

Status: `specified`

`--format table` (default) or `csv`. `reconcile` and `register` have only `table`.

| Command | One row per | Fields |
| --- | --- | --- |
| `check` | Diagnostic | `source`, `line`, `column`, `severity`, `code`, `message` |
| `balance` | Row of `balance`, in its order, and then one line per commodity | `account`, `subtotal`, `depth`, `value`, `commodity` |
| `register` | Row of `register`, in its order, and then one line per commodity; after a row, its postings as `query` rows | Table only |
| `query` | Matched posting, in query order | `date`, `transaction`, `posting`, `occurrence`, `status`, `account`, `value`, `commodity`, `description` |
| `reconcile` | View, one per commodity | The account, commodity and range, opening, the period's postings, closing, asserted, difference, then the uncleared postings as `query` rows |

- `date` is the time on the query's axis, as written: the transaction's accounting time on `accounting`, the posting's effective time on `effective`, the transaction's effective time on `txn-effective` (see [core/time.md](core/time.md), "API"). In `reconcile`, it is always the posting's effective time.
- **Tables.** Each table is aligned on its own: in `register`, the account rows share one alignment and each row's postings another; in `reconcile`, each view has its own. Amounts are padded with zeros to the commodity's precision and never rounded. `balance` indents each account two spaces per segment after the first and marks subtotal rows `(total)`. `query` shows a mark: `!` planned, `#` cancelled, `*` cleared. `check` prints `<source>:<line>:<column>: <severity> <code>: <message>`. Several `reconcile` views are separated by a blank line.
- **CSV.** A header row, then the fields as plain text; amounts are not padded. Fields containing `,`, `"` or a line break are quoted.
- JSON output is not available.

### Exit status

Status: `implemented`

| Status | When |
| --- | --- |
| 0 | Success. For `check`: no diagnostic of severity `error`. For the other commands, also when the ledger has errors (see "Loading"). |
| 1 | `check` found an error. |
| 2 | A usage error: an unknown command or option, an option written twice, an option that does not apply to the command, a missing `--file`, a root file outside `--root` or that cannot be read, or an invalid value such as a time the API rejects. Any other error thrown while running a command is treated the same way. The message goes to standard error as `hueke: <message>`, except with no command (see "Commands"). |

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
  9100 NTD  Bank (total)
  9100 NTD    Bank:Checking
-12300 NTD  Equity (total)
-12300 NTD    Equity:Opening
  3200 NTD  Expenses (total)
  2700 NTD    Expenses:Groceries
   500 NTD    Expenses:Other
```

```text
$ hueke query Bank --file main.hueke --axis effective --period 2026-10-10..2026-10-20
2026-10-14  *  Bank:Checking  -2700 NTD  Supermarket
```

```text
$ hueke register Bank --file main.hueke --axis effective --period 2026-10-10..2026-10-20
-2700 NTD  Bank (total)
-2700 NTD    Bank:Checking
2026-10-14  *  Bank:Checking  -2700 NTD  Supermarket
```

```text
$ hueke reconcile Bank:Checking --file main.hueke --at 2026-10-25
Bank:Checking  NTD  start .. 2026-10-25
opening            0 NTD
2026-10-01  *  12300 NTD  Opening
2026-10-03      -500 NTD  Bookstore
2026-10-14  *  -2700 NTD  Supermarket
closing         9100 NTD
asserted        9100 NTD
difference         0 NTD

uncleared
2026-10-03    Bank:Checking  -500 NTD  Bookstore
```

| Command | Result |
| --- | --- |
| `hueke check --file main.hueke` | No output, status 0 |
| `hueke balance --file main.hueke --at 2026-10-31`, with the Balance changed to 9000 NTD | The same rows on standard output; `main.hueke:18:1: error balance.mismatch: …` on standard error; status 0 |
| `hueke balance --root ledger --file ledger/main.hueke` | Reads `ledger/main.hueke`, loaded as `main.hueke` |
| `hueke balance --root ledger --file main.hueke` | Status 2: `main.hueke` in the current directory is outside `--root` |
| `hueke balance Expenses --file main.hueke --period 2026-10 --depth 1` | One row: `3200 NTD  Expenses (total)` |
| `hueke query --file main.hueke --status none --format csv` | A header and the two `Bookstore` postings |
| `hueke reconcile --file main.hueke --at 2026-10-25` | Status 2: `hueke: reconcile takes exactly one account` |
| `hueke balance --file main.hueke --format xml` | Status 2: `hueke: unknown format "xml"` |
| `hueke balance --file main.hueke --period 2026-13` | Status 2; the message names `parse.invalid-time` |
| `hueke balance --file main.hueke --at 2026-10-31T12:00` | Status 2; the message names `query.time-of-day` |
| `hueke balance --file main.hueke --at 2026-10-31 --at 2026-11-30` | Status 2: `--at` is written twice |
| `hueke obligations --file main.hueke` | Status 2: `hueke: unknown command "obligations"` |
