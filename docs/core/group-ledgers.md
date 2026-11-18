# Group ledgers and shared accounts

A **group ledger** records what a group of people spent together, such as a trip: one file that every member's ledger refers to. In a member's own ledger, a **shared account** refers to the group ledger and names which member is the ledger's owner, its **self**; each group transaction is then **converted** into a transaction of the owner's ledger, holding the owner's share and the money the owner paid. The shared account's balance is the owner's **position** in the group: what the group owes the owner, or, when negative, what the owner owes the group. This document covers group ledgers, shared accounts and their mappings, conversion, naming the account a payment actually came from, the group a group ledger forms in the owner's ledger, closing a shared account, and opening a group ledger as a ledger of its own.

## Features

| Feature | Status |
| --- | --- |
| Group ledgers | `implemented` |
| Shared accounts | `implemented` |
| Conversion | `implemented` |
| Actual payments | `implemented` |
| Closing a shared account | `implemented` |
| A group ledger on its own | `implemented` |
| Group tags | `implemented` |

## Concepts

A group ledger is a module that starts with a `module shared` declaration (see [modules.md](modules.md), "Referenced modules"). It is not part of the ledger that refers to it: it has its own settings, account roots, commodities, accounts, entities and anchors, and reaches the owner's ledger only through conversion. It records no settlement plan: who pays whom is up to the members, and a payment between them is one more group transaction.

**Group ledger** (one of the ledger's `groups`)

| Field | Meaning |
| --- | --- |
| `path` | The logical path of its module. |
| `name` | Its name in this ledger, the shared account's `as`. Converted IDs and `#shared:` tags use it. A group ledger has no name of its own, so each member's ledger may name it differently. |
| `description` | The description in its `module` declaration, if any. |
| `shares` | Its members and their default ratios, in written order. |
| `account` | The ID of the shared account that refers to it. |

**Postings of a group transaction**, told apart by account type (see [accounts.md](accounts.md), "Account roots"):

| Kind | Condition | Meaning |
| --- | --- | --- |
| **Spending** | An `income` or `expense` account, whatever its references | Spent, or received, by the group as a whole; shared among members |
| **Member money** | Any other account; exactly one entity reference, a member | Money one member actually paid or received |

**Shared account**: an account whose root has type `shared`. Its `shared` field holds:

| Field | Meaning |
| --- | --- |
| `source` | The path of the group ledger, as written; it resolves as an `include` path (see [modules.md](modules.md), "Paths"). |
| `as` | The name to give the group ledger in this ledger. |
| `primary` | `true` when `as` was written with `^`, as in `as ^tokyo-trip`: its transactions take a primary tag (see "Group tags"); left out otherwise. |
| `self` | The member who is this ledger's owner. |
| `accountMap` | Group accounts to accounts of this ledger, each a pair of names, in written order. |
| `entityMap` | Group entities to entities of this ledger. Unlisted entities map to the same ID. |
| `commodityMap` | Group commodities to commodities of this ledger. Unlisted commodities map to the same code. |

A member's **position** in a group is what the member paid minus the member's share of the spending. Positive, the group owes the member; negative, the member owes the group. All positions add up to zero.

## Behavior

### Group ledgers

Status: `implemented`

- A group ledger holds only shared spending. Besides its `module` declaration, it may have `option`, `account-root`, `commodity`, `account` and `entity` declarations, and transactions. Anything else is `module.forbidden-record` (error), and that record is not loaded: a Balance, a rule, `include`, an account property other than `display-name` and metadata, or an account root of type `shared`.
- Its declarations take effect only inside it. Settings it does not write take the referring ledger's values. Its times are read in its own time zone.
- `share @<entity> <ratio>` lines in the `module` declaration give the members and their default ratios. `self` cannot be a member. A ratio that cannot be read is `parse.invalid-number`, and leaves its member out.
- **Shares of spending.** A spending posting is shared by its own `split` when it has one, otherwise by the module's ratios, with the rules of [generators.md](generators.md), "Splits", for amounts, ratios and exact fractions. A split in a group ledger lists only members, with amounts or ratios: `self`, a table, `paid-by` or `->` is `shared.invalid-split`, and the posting is shared by the module's ratios. Ratios adding up to zero is `split.zero-ratio`; in the module's ratios, it stops every transaction of the group from converting. A split of its own with an error, `split.exceeds`, `split.zero-ratio` or an amount that cannot be read (`parse.invalid-number`), is not used either: the posting is shared by the module's ratios. A split naming someone who is not a member is `shared.unknown-member`, and that group transaction is not converted.
- Each group transaction must balance, as any transaction (`txn.unbalanced`).
- A member-money posting's member is read as queries read references: its own, else its transaction's. Without an entity, or with more than one, it is `shared.missing-member`; with an entity that is not a member, `shared.unknown-member`. That group transaction is not converted.
- Accounts, commodities and entities a group ledger uses without declaring them are not created in the owner's ledger, and get no diagnostics, in strict mode or not. Its balancing uses its own commodities' precisions, declared or inferred from its own amounts.
- A group ledger refers to no group ledgers, so `%shared:<name>` in it is `shared.unknown-module`, and the transaction defines no anchor: it converts as one without an anchor. `#shared:` and `^shared:` in it are `tag.wrong-target` (see [anchors.md](anchors.md), "Scoped anchors").
- Diagnostics about a group ledger name its module as their `source`.

### Shared accounts

Status: `implemented`

- An account root of type `shared`, such as `account-root Shared shared`, makes its accounts shared accounts. A shared account is declared with `source` and `self` (see [../dsl/records.md](../dsl/records.md), "Group ledgers and shared accounts"); without either, it is `shared.missing-source`, and nothing is converted for it. The account still loads.
- `source` must resolve to a loaded module that starts with a `module shared` declaration, and `self` must be one of its members; otherwise `shared.unknown-module`, and nothing is converted.
- Each group ledger appears once in a ledger: two shared accounts referring to the same module, or a module both included and referred to, are `module.duplicate` (see [modules.md](modules.md), "Referenced modules").
- Two group ledgers with the same name in this ledger are `module.name-conflict`; neither is converted.
- **Account mapping.** A group account maps by the longest `accountMap` entry that is a prefix of it, segment by segment, and the rest of its name is carried over: with `map Expenses -> Expenses:Travel`, `Expenses` maps to `Expenses:Travel` and `Expenses:Food` to `Expenses:Travel:Food`. `Pay:Cash` maps by an entry for `Pay:Cash` before one for `Pay`. A group account that conversion needs and that no entry maps is `shared.unmapped-account`, and that group transaction is not converted. Every mapping must be written: accounts never map by name.
- Entities and commodities map by `entityMap` and `commodityMap`, or to the same name. Amounts keep their values; the target commodity's precision applies.
- A shared account is not an income or expense account: its postings may have their own effective time. Where it stands in a balance sheet is not decided.

### Conversion

Status: `implemented`

Each group transaction T is converted, for the shared account A with self S, into one transaction of the owner's ledger:

| Posting of T | Converted to |
| --- | --- |
| Spending, amount x, S's share r | The mapped account, x × r; its price and cost are multiplied by r too. Nothing when r is zero |
| Member money of S | The mapped account, the same amount, with the posting's own effective time if it has one |
| Member money of another member | Nothing |
| To balance | A, the negated sum of the weights above, per commodity; nothing for a commodity whose sum is zero |

- The converted transaction keeps T's times, description, primary tag, metadata and tags, with references mapped by `entityMap`, and carries `system:shared`. Its occurrence is T's; its status is `none`. Its `source` is the group ledger's path, and its span is T's. T's tags, and those of its postings, become plain tags: they name nothing in the owner's ledger.
- A converted posting keeps its group posting's metadata, breakdown and references, mapped by `entityMap`; its status is `none`. The postings follow T's order, then A's, by commodity code.
- Its ID is `shared:<name>:<anchor>` when T defines an anchor, such as `shared:tokyo-trip:hotel`; otherwise `shared:<name>:~<n>`, numbering T among the group ledger's transactions without an anchor, as in [ledger.md](ledger.md), "IDs". Its postings are numbered under it.
- When S has no share and paid nothing, nothing is converted.
- Conversion runs first in expansion (see [ledger.md](ledger.md), "Normalization"), so splits, rules, pads and Balances of the owner's ledger see the converted transactions. Converted postings are checked against `allow`, `deny` and `active` like any posting.
- Shares may be fractions, so a shared account may hold fractions; Balances on it use the tolerance of [generators.md](generators.md), "Tolerance for split fractions".

### Actual payments

Status: `implemented`

The owner may have paid from another account than the mapping says, or may already have recorded the payment from a statement. A transaction of the owner's ledger tagged `#shared:<name>:<anchor>` names the group transaction it pays for.

- It replaces S's member money in that group transaction's conversion, and the part of A that balances it. S's share is still converted. The replaced money needs no account mapping.
- It is checked even when nothing of the group transaction converts.
- Any transaction with the tag counts, whatever its occurrence.
- Its postings on A, and on accounts under A, must equal the negated sum of the weights of S's member money in T, per commodity, after `commodityMap`: what A would have balanced in the conversion. A weight is the posting's cost if written, else its price, else its amount, with the posting's sign (see [transactions.md](transactions.md), "Balancing"), so `-7227 JPY @@ 1618 TWD` asks for 1618 TWD. Each commodity may differ by the tolerance of balancing in that commodity of the owner's ledger, with k the number of those weights that came from a price or cost (at least 1). Otherwise `shared.payment-mismatch` (error). It counts as written and still replaces.
- One group transaction is replaced by one transaction at most; each one after the first, in transaction order, is `shared.multiple-replacement` (error). Each counts as written, and the conversion is still replaced.
- **Pairs.** When a converted transaction exists, it and the actual payment that replaced its money name each other: the converted transaction's `payment` is the payment's ID, and the payment's `pays` is the converted transaction's ID. They stay two transactions, with their own times, sources and postings; a reader may show them as one. A payment after the first, or one whose group transaction converts nothing, has no `pays`.
- A `shared` tag stands on a transaction header. A `#shared:<name>:<anchor>` naming anything other than a group transaction with that anchor, or a group transaction without an anchor, is `tag.wrong-target` (see [anchors.md](anchors.md), "Scopes").
- An actual payment is not in the group ledger's group (see "Group tags") unless it is tagged so: `#shared:<name>:<anchor>` and `#shared:<name>` are different tags.

### Group tags

Status: `implemented`

A group ledger forms one group in the owner's ledger, named `shared:<name>` (see [anchors.md](anchors.md), "Scoped anchors" and "Groups"). Its anchor's record is a transaction of the owner's ledger that writes `%shared:<name>`, such as the event of the trip.

- Each converted transaction carries the tag `#shared:<name>`.
- With `as ^<name>`, it carries the primary tag `^shared:<name>` instead. That replaces T's own primary tag, which becomes a plain tag like T's other tags: `^food` on T is `#food` on the converted transaction.
- These tags are added by conversion; they are not plain like T's tags, and link to the transaction that defines `%shared:<name>`, if any.
- Transactions of the owner's ledger tagged `#shared:<name>` or `^shared:<name>` are members too, such as one's own spending on the trip.
- A group ledger opened on its own carries none of these tags.

### Closing a shared account

Status: `implemented`

A shared account is checked and closed with Balances, like an obligation (see [balance.md](balance.md)). A position of zero is settled.

- A `hard` Balance asserts the owner's position.
- Members often pay each other round sums, leaving a small remainder. A pad with written padding closes it: `balance Shared:tokyo-trip 0 NTD pad 3 NTD`. Its counter-account defaults to the shared account's `pad-account`.
- A pad on a shared account must write its padding; otherwise `balance.pad-needs-amount`, and nothing is generated. Without padding, the pad would also cover a group transaction that was never recorded.

### A group ledger on its own

Status: `implemented`

A group ledger can also be opened as a ledger of its own, to see what the group spent and who paid it. The same file may still be referred to by shared accounts of other ledgers; each ledger reads it separately.

- A root whose first record is a `module shared` declaration loads as a group ledger on its own (see [modules.md](modules.md), "Referenced modules"). Its transactions are the ledger's, as written: nothing is converted, and there is no self.
- It holds what a group ledger holds: any other record is `module.forbidden-record`, and is not loaded, as under "Group ledgers".
- Its members, ratios, splits and member money are checked as under "Group ledgers", with the same diagnostics: `parse.invalid-number`, `split.zero-ratio`, `split.exceeds`, `shared.invalid-split`, `shared.missing-member` and `shared.unknown-member`. A transaction they would stop from converting still loads.
- A split stays on its posting: it says how the group shares the spending, and generates nothing.
- Otherwise it loads as any ledger: settings it does not write take their defaults, and accounts, commodities and entities it uses without declaring them are created as usual (see [ledger.md](ledger.md)).
- Its `groups` is empty.

## Examples

These cases do not load the shared declarations. The group ledger is `trips/tokyo.hueke`:

```hueke
module shared "Tokyo trip"
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
    source trips/tokyo.hueke as ^tokyo-trip
    self @SUBANG
    map Expenses -> Expenses:Travel
    map Pay:Cash -> Assets:Cash
    map Pay:Transfer -> Bank:Checking
    map Pay:Card -> Liabilities:Card
    pad-account Expenses:Rounding

2026-10-18..2026-10-20 %shared:tokyo-trip "Tokyo trip" #travel

2026-11-01 balance Shared:tokyo-trip 0 NTD pad 3 NTD
```

Converted transactions, generated in SUBANG's ledger, each with the primary tag `shared:tokyo-trip`. `map Expenses -> Expenses:Travel` maps each group expense account under `Expenses:Travel`, keeping the rest of its name:

| ID | Postings |
| --- | --- |
| `shared:tokyo-trip:hotel` | `Expenses:Travel:Lodging` 10000/3, `Liabilities:Card` −10000, `Shared:tokyo-trip` 20000/3 |
| `shared:tokyo-trip:dinner` | `Expenses:Travel:Food` 1500, `Assets:Cash` −3000, `Shared:tokyo-trip` 1500 |
| `shared:tokyo-trip:taxi` | `Expenses:Travel:Transport` 200, `Shared:tokyo-trip` −200 |
| `shared:tokyo-trip:pay-amy` | `Bank:Checking` 4430, `Shared:tokyo-trip` −4430 |
| `shared:tokyo-trip:pay-bob` | `Bank:Checking` 3540, `Shared:tokyo-trip` −3540 |

| Call | Result |
| --- | --- |
| `check(ledger)` | No diagnostics |
| `balance(ledger, query(ledger).accounts("Shared:tokyo-trip").until("2026-10-20"))` | 23900/3 NTD |
| The same until 2026-10-31 | −10/3 NTD |
| The same until 2026-11-01 | 0 NTD: the pad of 3 NTD differs from 10/3 by 1/3, within one unit, and pads the actual 10/3 |
| `balance(ledger, query(ledger).accounts("Expenses").within("2026-10").axis("accounting"))` | `Expenses:Travel:Food` 1500 NTD, `Expenses:Travel:Lodging` 10000/3 NTD, `Expenses:Travel:Transport` 200 NTD |
| `balance(ledger, query(ledger).accounts("Liabilities:Card", "Assets:Cash", "Bank:Checking").until("2026-10-31"))` | `Liabilities:Card` −10000 NTD, `Assets:Cash` −3000 NTD, `Bank:Checking` 7970 NTD |
| `query(ledger).accounts("Shared:tokyo-trip")` | The five converted transactions, each tagged `system:shared`, then the pad's on 2026-11-01 |
| `query(ledger).primaryTag("shared:tokyo-trip")` | The five converted transactions; each has `primaryTarget` `shared:tokyo-trip`, the event's ID |
| `query(ledger).ids("shared:tokyo-trip")` | The event |

**An actual payment**

Added to `main.hueke`:

```hueke
2026-10-18 * "Hotel" #shared:tokyo-trip:hotel
    Shared:tokyo-trip    10000 NTD
    Liabilities:Card    -10000 NTD [2026-10-20]
```

`shared:tokyo-trip:hotel` now converts to `Expenses:Travel:Lodging` 10000/3 and `Shared:tokyo-trip` −10000/3 only; its `payment` is the added transaction's ID, `~1`, whose `pays` is `shared:tokyo-trip:hotel`. `Liabilities:Card` is 0 NTD until 2026-10-19 and −10000 NTD from 2026-10-20; the position on 2026-10-20 is still 23900/3 NTD.

| Change | Result |
| --- | --- |
| Without `map Pay:Transfer -> Bank:Checking` | `shared.unmapped-account` on `shared:tokyo-trip:pay-amy` and `shared:tokyo-trip:pay-bob`; neither is converted |
| The actual payment's amounts are 9000 NTD | `shared.payment-mismatch`: SUBANG's money in `shared:tokyo-trip:hotel` is 10000 NTD |
| SUBANG's money in the hotel written `-1500000 KRW @@ 10000 NTD` | No diagnostic: the payment of 10000 NTD equals the money's weight |
| The same money written `-1500000 KRW @ 0.0066667 NTD`, a weight of 10000.05 NTD | No diagnostic: 0.05 NTD is within the tolerance, half a unit of NTD |
| The money written `-1500000 KRW @@ 10000 NTD`, with the payment's amounts 1500000 KRW | `shared.payment-mismatch`: it should pay 10000 NTD, the money's weight, not its amount |
| `2026-10-31 balance Pay:Cash 0 NTD` in the group ledger | `module.forbidden-record` |
| The Balance in `main.hueke` written `pad -> Expenses:Rounding`, without padding | `balance.pad-needs-amount` |
| `self @CAROL` | `shared.unknown-module`: CAROL is not a member; nothing is converted |
| `as tokyo-trip`, without `^` | The converted transactions have no primary tag, and carry the tag `#shared:tokyo-trip` instead |
| `^food` on the dinner in the group ledger | The converted `shared:tokyo-trip:dinner` still has the primary tag `shared:tokyo-trip`, and the plain tag `#food` |
| The event written `%shared:kyoto-trip` | `shared.unknown-module`; the converted transactions' primary tag is plain |
| `%shared:tokyo-trip:hotel` on a transaction of `main.hueke` | `parse.syntax`; the transaction is not loaded |
| `split self @AMY` under the dinner in the group ledger | `shared.invalid-split`; the dinner is shared by the module's ratios, 1000 NTD each |
