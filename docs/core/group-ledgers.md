# Group ledgers and shared accounts

A **group ledger** records what a group of people spent together, such as a trip: one file that every member's ledger refers to. In a member's own ledger, a **shared account** refers to the group ledger and names which member is the ledger's owner, its **self**; each group transaction is then **converted** into a transaction of the owner's ledger, holding the owner's share and the money the owner paid. The shared account's balance is the owner's **position** in the group: what the group owes the owner, or, when negative, what the owner owes the group. This document covers group ledgers, shared accounts and their mappings, conversion, naming the account a payment actually came from, and closing a shared account.

## Features

| Feature | Status |
| --- | --- |
| Group ledgers | `specified` |
| Shared accounts | `specified` |
| Conversion | `specified` |
| Actual payments | `specified` |
| Closing a shared account | `specified` |

## Concepts

A group ledger is a module that starts with a `module shared` declaration (see [modules.md](modules.md), "Referenced modules"). It is not part of the ledger that refers to it: it has its own settings, account roots, commodities, accounts, entities and anchors, and reaches the owner's ledger only through conversion. It records no settlement plan: who pays whom is up to the members, and a payment between them is one more group transaction.

**Group ledger** (one of the ledger's `groups`)

| Field | Meaning |
| --- | --- |
| `path` | The logical path of its module. |
| `name` | Its name in this ledger: the shared account's `as`, else the name in its `module` declaration. Converted IDs and `#shared:` tags use it. |
| `description` | The description in its `module` declaration, if any. |
| `shares` | Its members and their default ratios, in written order. |
| `account` | The ID of the shared account that refers to it. |

**Postings of a group transaction**, told apart by account type (see [accounts.md](accounts.md), "Account roots"):

| Kind | Condition | Meaning |
| --- | --- | --- |
| **Spending** | An `income` or `expense` account; no entity reference | Spent, or received, by the group as a whole; shared among members |
| **Member money** | Any other account; exactly one entity reference, a member | Money one member actually paid or received |

**Shared account**: an account whose root has type `shared`. Its `shared` field holds:

| Field | Meaning |
| --- | --- |
| `source` | The path of the group ledger, as written; it resolves as an `include` path (see [modules.md](modules.md), "Paths"). |
| `as` | The name to give the group ledger in this ledger, if written. |
| `self` | The member who is this ledger's owner. |
| `accountMap` | Group accounts to accounts of this ledger, each a pair of names, in written order. |
| `entityMap` | Group entities to entities of this ledger. Unlisted entities map to the same ID. |
| `commodityMap` | Group commodities to commodities of this ledger. Unlisted commodities map to the same code. |

A member's **position** in a group is what the member paid minus the member's share of the spending. Positive, the group owes the member; negative, the member owes the group. All positions add up to zero.

## Behavior

### Group ledgers

Status: `specified`

- A group ledger holds only shared spending. Besides its `module` declaration, it may have `option`, `account-root`, `commodity`, `account` and `entity` declarations, and transactions. Anything else is `module.forbidden-record` (error), and that record is not loaded: a Balance, a rule, `include`, an account property other than `display-name` and metadata, or a shared account.
- Its declarations take effect only inside it. Settings it does not write take the referring ledger's values. Its times are read in its own time zone.
- `share @<entity> <ratio>` lines in the `module` declaration give the members and their default ratios. `self` cannot be a member.
- **Shares of spending.** A spending posting is shared by its own `split` when it has one, otherwise by the module's ratios, with the rules of [generators.md](generators.md), "Splits", for amounts, ratios and exact fractions. A split in a group ledger lists only members, with amounts or ratios: `self`, a table, `paid-by` or `->` is `shared.invalid-split`, and the posting is shared by the module's ratios. Ratios adding up to zero is `split.zero-ratio`; in the module's ratios, it stops every transaction of the group from converting.
- Each group transaction must balance, as any transaction (`txn.unbalanced`).
- A member-money posting without an entity is `shared.missing-member`; with an entity that is not a member, `shared.unknown-member`. That group transaction is not converted.
- Diagnostics about a group ledger name its module as their `source`.

### Shared accounts

Status: `specified`

- An account root of type `shared`, such as `account-root Shared shared`, makes its accounts shared accounts. A shared account is declared with `source` and `self` (see [../dsl/records.md](../dsl/records.md), "Group ledgers and shared accounts"); without either, it is `shared.missing-source`, and nothing is converted for it. The account still loads.
- `source` must resolve to a loaded module that starts with a `module shared` declaration, and `self` must be one of its members; otherwise `shared.unknown-module`, and nothing is converted.
- Each group ledger appears once in a ledger: two shared accounts referring to the same module, or a module both included and referred to, are `module.duplicate` (see [modules.md](modules.md), "Referenced modules").
- Two group ledgers with the same name in this ledger are `module.name-conflict`; neither is converted.
- **Account mapping.** A group account maps by the longest `accountMap` entry that is a prefix of it, segment by segment; the rest of its name is not carried over. `Pay:Cash` maps by an entry for `Pay:Cash` before one for `Pay`. A group account that conversion needs and that no entry maps is `shared.unmapped-account`, and that group transaction is not converted. Every mapping must be written: accounts never map by name.
- Entities and commodities map by `entityMap` and `commodityMap`, or to the same name. Amounts keep their values; the target commodity's precision applies.
- A shared account is not an income or expense account: its postings may have their own effective time. Where it stands in a balance sheet is not decided.

### Conversion

Status: `specified`

Each group transaction T is converted, for the shared account A with self S, into one transaction of the owner's ledger:

| Posting of T | Converted to |
| --- | --- |
| Spending, amount x, S's share r | The mapped account, x × r |
| Member money of S | The mapped account, the same amount, with the posting's own effective time if it has one |
| Member money of another member | Nothing |
| To balance | A, the negated sum of the above, per commodity |

- The converted transaction keeps T's times, description, metadata and tags, with references mapped by `entityMap`, and carries `system:shared`. Its occurrence is T's; its status is `none`. Its `source` is the group ledger's path.
- Its ID is `<name>:<anchor>` when T defines an anchor, such as `tokyo-trip:hotel`; otherwise `<name>:~<n>`, numbering T among the group ledger's transactions without an anchor, as in [ledger.md](ledger.md), "IDs". Its postings are numbered under it.
- When S has no share and paid nothing, nothing is converted.
- Conversion runs first in expansion (see [ledger.md](ledger.md), "Normalization"), so splits, rules, pads and Balances of the owner's ledger see the converted transactions. Converted postings are checked against `allow`, `deny` and `active` like any posting.
- Shares may be fractions, so a shared account may hold fractions; Balances on it use the tolerance of [generators.md](generators.md), "Tolerance for split fractions".

### Actual payments

Status: `specified`

The owner may have paid from another account than the mapping says, or may already have recorded the payment from a statement. A transaction of the owner's ledger tagged `#shared:<name>:<anchor>` names the group transaction it pays for.

- It replaces S's member money in that group transaction's conversion, and the part of A that balances it. S's share is still converted.
- Its postings on A must equal the negated sum of S's member money in T, per commodity; otherwise `shared.payment-mismatch` (error). It counts as written and still replaces.
- One group transaction is replaced by one transaction at most; more is `shared.multiple-replacement` (error). Each counts as written, and the conversion is still replaced.
- A `shared` tag stands on a transaction header. Naming anything other than a group transaction with that anchor, or a group transaction without an anchor, is `tag.wrong-target` (see [anchors.md](anchors.md), "Scopes").

### Closing a shared account

Status: `specified`

A shared account is checked and closed with Balances, like an obligation (see [balance.md](balance.md)). A position of zero is settled.

- A `hard` Balance asserts the owner's position.
- Members often pay each other round sums, leaving a small remainder. A pad with written padding closes it: `balance Shared:tokyo-trip 0 NTD pad 3 NTD`. Its counter-account defaults to the shared account's `pad-account`.
- A pad on a shared account must write its padding; otherwise `balance.pad-needs-amount`, and nothing is generated. Without padding, the pad would also cover a group transaction that was never recorded.

## Examples

These cases do not load the shared declarations. The group ledger is `trips/tokyo.hueke`:

```hueke
module shared tokyo-trip "Tokyo trip"
    share @SUBANG 1
    share @AMY 1
    share @BOB 1

option timezone Asia/Taipei
commodity NTD
    precision 0
account-root Pay asset

2026-10-18 * %hotel "Hotel"
    Expenses:Lodging   10000 NTD
    Pay:Card          -10000 NTD @SUBANG

2026-10-19 * %dinner "Dinner, BOB was not there"
    Expenses:Food   3000 NTD
        split @SUBANG @AMY
    Pay:Cash       -3000 NTD @SUBANG

2026-10-20 * %taxi "Taxi"
    Expenses:Transport   600 NTD
    Pay:Cash            -600 NTD @AMY

2026-10-30 * %pay-amy "AMY pays SUBANG"
    Pay:Transfer    4430 NTD @SUBANG
    Pay:Transfer   -4430 NTD @AMY

2026-10-30 * %pay-bob "BOB pays SUBANG"
    Pay:Transfer    3540 NTD @SUBANG
    Pay:Transfer   -3540 NTD @BOB
```

SUBANG's ledger is `main.hueke`:

```hueke
option timezone Asia/Taipei
commodity NTD
    precision 0
account-root Bank asset
account-root Shared shared

account Shared:tokyo-trip
    source trips/tokyo.hueke
    self @SUBANG
    map Expenses -> Expenses:Travel
    map Pay:Cash -> Assets:Cash
    map Pay:Transfer -> Bank:Checking
    map Pay:Card -> Liabilities:Card
    pad-account Expenses:Rounding

2026-11-01 balance Shared:tokyo-trip 0 NTD pad 3 NTD
```

Converted transactions, generated in SUBANG's ledger. `map Expenses -> Expenses:Travel` maps every group expense account to `Expenses:Travel` itself, since the rest of a name is not carried over:

| ID | Postings |
| --- | --- |
| `tokyo-trip:hotel` | `Expenses:Travel` 10000/3, `Liabilities:Card` −10000, `Shared:tokyo-trip` 20000/3 |
| `tokyo-trip:dinner` | `Expenses:Travel` 1500, `Assets:Cash` −3000, `Shared:tokyo-trip` 1500 |
| `tokyo-trip:taxi` | `Expenses:Travel` 200, `Shared:tokyo-trip` −200 |
| `tokyo-trip:pay-amy` | `Bank:Checking` 4430, `Shared:tokyo-trip` −4430 |
| `tokyo-trip:pay-bob` | `Bank:Checking` 3540, `Shared:tokyo-trip` −3540 |

| Call | Result |
| --- | --- |
| `check(ledger)` | No diagnostics |
| `balance(ledger, query(ledger).accounts("Shared:tokyo-trip").until("2026-10-20"))` | 23900/3 NTD |
| The same until 2026-10-31 | −10/3 NTD |
| The same until 2026-11-01 | 0 NTD: the pad of 3 NTD differs from 10/3 by 1/3, within one unit, and pads the actual 10/3 |
| `balance(ledger, query(ledger).accounts("Expenses").within("2026-10").axis("accounting"))` | `Expenses:Travel` 15100/3 NTD |
| `balance(ledger, query(ledger).accounts("Liabilities:Card", "Assets:Cash", "Bank:Checking").until("2026-10-31"))` | `Liabilities:Card` −10000 NTD, `Assets:Cash` −3000 NTD, `Bank:Checking` 7970 NTD |
| `query(ledger).accounts("Shared:tokyo-trip")` | The five converted transactions, each tagged `system:shared`, then the pad's on 2026-11-01 |

**An actual payment**

Added to `main.hueke`:

```hueke
2026-10-18 * "Hotel" #shared:tokyo-trip:hotel
    Shared:tokyo-trip    10000 NTD
    Liabilities:Card    -10000 NTD [2026-10-20]
```

`tokyo-trip:hotel` now converts to `Expenses:Travel` 10000/3 and `Shared:tokyo-trip` −10000/3 only. `Liabilities:Card` is 0 NTD until 2026-10-19 and −10000 NTD from 2026-10-20; the position on 2026-10-20 is still 23900/3 NTD.

| Change | Result |
| --- | --- |
| Without `map Pay:Transfer -> Bank:Checking` | `shared.unmapped-account` on `tokyo-trip:pay-amy` and `tokyo-trip:pay-bob`; neither is converted |
| The actual payment's amounts are 9000 NTD | `shared.payment-mismatch`: SUBANG's money in `tokyo-trip:hotel` is 10000 NTD |
| `2026-10-31 balance Pay:Cash 0 NTD` in the group ledger | `module.forbidden-record` |
| The Balance in `main.hueke` written `pad -> Expenses:Rounding`, without padding | `balance.pad-needs-amount` |
| `self @CAROL` | `shared.unknown-module`: CAROL is not a member; nothing is converted |
| `split self @AMY` under the dinner in the group ledger | `shared.invalid-split`; the dinner is shared by the module's ratios, 1000 NTD each |
