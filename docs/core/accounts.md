# Accounts

An **account** is a named place that holds amounts, in any number of commodities. Account names form a hierarchy, and the first segment of a name, the **root**, decides the account's type. This document covers the hierarchy, account and root declarations, combined income and expense accounts, and accounts whose root is unknown. Obligation accounts are described in [obligations.md](obligations.md). Declarations of accounts and commodities alike, strict mode and duplicates, are described in [ledger.md](ledger.md); only the root module's declarations take effect (see [modules.md](modules.md), "Declarations in included modules").

## Features

| Feature | Status |
| --- | --- |
| Accounts and the hierarchy | `implemented` |
| Account declarations | `implemented` |
| Account anchors and display names | `implemented` |
| Obligation and pad settings | `implemented` |
| Account roots | `implemented` |
| Combined income and expense | `implemented` |
| Untyped accounts | `implemented` |

## Concepts

**Account types**: `asset`, `liability`, `equity`, `income`, `expense`.

**Account root**

| Field | Meaning |
| --- | --- |
| `name` | The root's name, the first segment of account names. |
| `type` | The type given to every account under this root. |
| `builtin` | Whether it is one of the built-in roots and was not redeclared. |

**Account**

| Field | Meaning |
| --- | --- |
| `id` | The full name, such as `Bank:Checking`. It is the account's stable ID. |
| `span` | Where it is declared; absent for an account used without a declaration. |
| `type` | From its root; absent when the root is unknown. |
| `parent` | The name without its last segment; absent for a single segment. |
| `anchor` | The anchor written after the name, if any (see [anchors.md](anchors.md)). |
| `displayName` | The name to show in reports, if declared (see [entities.md](entities.md), "Display names"). |
| `primaryCommodity` | The default commodity for display, if declared. |
| `obligation` | `receivable` or `payable`, declared or inherited from an obligation account (see [obligations.md](obligations.md)); absent otherwise. |
| `padAccount` | The default counter-account of a pad on this account, declared or inherited from an obligation account; absent otherwise. |
| `meta` | Metadata written under the declaration. |

## Behavior

### Accounts and the hierarchy

Status: `implemented`

- Names contain no spaces and are unique in the ledger. Records refer to an account by its full name.
- `Bank:Checking` is a sub-account of `Bank`. Filters, balances and Balance assertions on an account include its sub-accounts.
- An account holds any number of commodities; balances are kept per commodity.

### Account declarations

Status: `implemented`

- An account is declared with `account <name>`, optionally followed by `%anchor` (see "Account anchors and display names").
- `primary <commodity>` sets `primaryCommodity`.
- Metadata lines under the declaration go to the account's `meta`, apart from any posting's metadata.
- `display-name`, `obligation` and `pad-account` are described below. Other account properties are reserved (see [diagnostics.md](diagnostics.md), "Unsupported syntax").

### Account anchors and display names

Status: `implemented`

- `account <name> %anchor` gives the account an anchor. It shares the ledger's one namespace of anchors, so tags can name the account (see [anchors.md](anchors.md)). The account is found in the ledger's `accounts` by its `anchor`. The account's ID is still its full name.
- `display-name <text>` sets `displayName`, a name only for showing (see [entities.md](entities.md), "Display names").
- Sub-accounts inherit neither.

### Obligation and pad settings

Status: `implemented`

- `obligation receivable` or `obligation payable` makes the account an obligation account, whatever its type; its direct sub-accounts are obligations (see [obligations.md](obligations.md), "Obligation accounts").
- `pad-account <account>` sets `padAccount`: the counter-account of a pad on this account that names none, before the ledger's `pad-account` (see [balance.md](balance.md), "`pad` assertions"). It is kept as written and not checked when read.
- An obligation's sub-accounts inherit both from the obligation account, and need no declaration even in strict mode. Other sub-accounts inherit neither: a pad on `Bank:Checking` does not use the `pad-account` of `Bank`.

### Account roots

Status: `implemented`

- **Built-in roots**: `Assets` (asset), `Liabilities` (liability), `Equity` (equity), `Income` (income), `Expenses` (expense).
- Other roots, such as `Bank`, are declared with `account-root <name> <type>`, where type is `asset`, `liability`, `equity`, `income` or `expense`. Several roots may share a type.
- A declaration may also change the type of a built-in root; the root is then no longer `builtin`.
- The type is never declared on the account itself.
- An `account-root` with a missing part, an extra word, or a type that is neither one of these nor reserved (see [diagnostics.md](diagnostics.md), "Unsupported syntax") is `parse.syntax`, and the declaration is ignored.

### Combined income and expense

Status: `implemented`

With the ledger setting `income-expense on` (see [settings.md](settings.md)), income and expenses are shown together, so that `Income:Food` and `Expenses:Food` read as one account netting both.

- Accounts stay where they are written, under their own roots, with their own types `income` and `expense`. There is no combined account type, and no rule that depends on type changes.
- Every root of type `income` or `expense` is shown under one **merged root**, named `IncomeExpenses` unless the setting gives another name. The name after the root stays: `Income:Food` and `Expenses:Food` are both shown as `IncomeExpenses:Food`, and `Income:Salary`, with no expense counterpart, as `IncomeExpenses:Salary`.
- The merge applies only to the account tree of `balance` and `register` (see [query.md](query.md), "Account tree") and to account filters: `accounts("IncomeExpenses:Food")` matches the postings of `Income:Food` and `Expenses:Food`. The original names still work in filters, and the rows still show the merged names: `accounts("Expenses:Food")` gives the row `IncomeExpenses:Food`. The ledger's `accounts` and each posting's `account` keep the names as written.
- The merged root's name must not equal an account root, built-in or declared, nor the first segment of any account the ledger declares or uses, such as `Flow` in an undeclared `Flow:Food` or in an account `Flow`. Such a name is `option.invalid-root`, and the setting takes no effect.

### Untyped accounts

Status: `implemented`

Unless strict mode covers accounts (see [ledger.md](ledger.md), "Declarations and strict mode"), any account can be used without a declaration, including one whose root is unknown (`Spending:Food` when `Spending` is not a root).

- Such an account has no type, and `name.unknown-root` (info) is reported once per account. When strict mode covers accounts, `name.unknown-root` is not reported: an undeclared account is `strict.undeclared`, and a declared one with an unknown root is `strict.unknown-root`.
- Rules that depend on type do not apply to it. In particular, its postings may have their own effective time. Otherwise it behaves like any other account: it can be posted to, queried, totalled and asserted.
- To give it a type, declare its root with `account-root` or use a known root.

## Examples

| Ledger | Result |
| --- | --- |
| Postings on `Expenses:Food` and `Assets:Cash`, no `account-root` | `Expenses:Food` has type `expense`; no diagnostics |
| `account-root Assets liability`, a posting on `Assets:Cash` | The `Assets` root has type `liability` and `builtin` false; `Assets:Cash` has type `liability` |
| Postings on `Spending:Food`, `Spending` not declared | `name.unknown-root` naming `Spending`; the account has no type and still totals 180 NTD |
| `account Bank:Checking %main-bank` with `display-name Main checking account` | The account's ID is `Bank:Checking`, its `anchor` `main-bank`, its `displayName` "Main checking account" |
| `account Assets:Receivable` with `obligation receivable` and `pad-account Expenses:WriteOff`, and a posting on `Assets:Receivable:lunch-1011` | `Assets:Receivable:lunch-1011` has `obligation` `receivable` and `padAccount` `Expenses:WriteOff`; with `option strict account`, it is not `strict.undeclared` |

```hueke
option income-expense on

2026-10-05 * "October salary"
    Bank:Checking     50000 NTD
    Income:Salary    -50000 NTD

2026-10-10 * "Dinner"
    Expenses:Food     800 NTD
    Assets:Cash      -800 NTD

2026-10-12 * "Dinner, one dish refunded"
    Assets:Cash      200 NTD
    Expenses:Food   -200 NTD

2026-10-20 * "Sold leftover rice to a neighbor"
    Assets:Cash     100 NTD
    Income:Food    -100 NTD
```

`balance(ledger, query(ledger).accounts("IncomeExpenses").within("2026-10"))` returns, in this order: `IncomeExpenses` (subtotal) −49500 NTD, `IncomeExpenses:Food` 500 NTD, `IncomeExpenses:Salary` −50000 NTD. `Expenses:Food` has type `expense` and `Income:Food` type `income`; the ledger's `accounts` lists both under their own names.

| Setting | Result |
| --- | --- |
| `option income-expense on Flow` | The same rows under `Flow` |
| `option income-expense on Expenses` | `option.invalid-root`; the setting takes no effect, so no account is named `IncomeExpenses` and the call returns no rows |
| `account-root Flow asset` and `option income-expense on Flow` | `option.invalid-root` |
| `option income-expense on Flow` and a posting on the undeclared `Flow:Food` | `option.invalid-root`; `Flow:Food` stays a separate account |

```hueke
account Bank:Checking
    ;; bank_code: 808

2026-10-30 * "Deposit"
    Bank:Checking     1000 NTD
        ;; passbook_no: 3
    Assets:Cash      -1000 NTD
```

The account's `meta` is `{ bank_code: "808" }`; the posting's is `{ passbook_no: "3" }`.
