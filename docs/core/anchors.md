# Anchors and tags

An **anchor** names a record: it is the record's ID, and other records refer to it by that name. A **tag** puts a record in a group named by an anchor; when a record defines that anchor, the tag also links to it. A **scope**, defined by Core, gives a tag a meaning, such as `refund`. The **primary tag** says what a transaction is mainly about. This document covers anchors and their namespace, how tags resolve, scopes and where they may stand, primary tags, groups, refunds, and looking records up by their IDs.

## Features

| Feature | Status |
| --- | --- |
| Anchors | `implemented` |
| Resolving tags | `implemented` |
| Scopes | `implemented` |
| Primary tags | `implemented` |
| Groups | `implemented` |
| Refunds | `implemented` |
| Looking up by ID | `implemented` |

## Concepts

**Anchor**: a name written after `%`, such as `%t_book`. Transactions, postings and accounts may define one. A transaction's or posting's anchor is its ID (see [ledger.md](ledger.md), "IDs"); an account keeps its full name as its ID and has the anchor besides. Which names are allowed is in [../dsl/lexical.md](../dsl/lexical.md), "Identifiers".

**Tag**

| Field | Meaning |
| --- | --- |
| `scope` | What the tag means, one of the scopes in "Scopes"; `tag` unless written. |
| `ref` | The anchor it names. |
| `target` | The ID of the record that defines the anchor; absent when no record does. |

- A tag with a `target` is **anchored**; one without is **plain**. A plain tag is a tag like any other: it is in the record's tags, groups its members, and is filtered, grouped and listed exactly as an anchored one. The only difference is that no record is linked, so a listing of its group has no anchor record first.
- Transactions and postings carry any number of tags. A posting's tags are its own plus its transaction's (see [transactions.md](transactions.md), "Concepts"). Balances carry none.

**Primary tag**: at most one per transaction, written `^name`. Its scope is always `tag`. The transaction's `primaryTag` holds the anchor's name and `primaryTarget` the ID of the record that defines it, when one does.

**Group**: the records that carry a tag, or a primary tag. They are its **members**. The record the anchor names is not a member.

## Behavior

### Anchors

Status: `implemented`

- Anchors share one namespace across the whole ledger: transactions, postings and accounts, in the root module and in every included module.
- An anchor is defined at most once. When it is defined more than once, each definition after the first in source order is `anchor.duplicate` (error), naming the first as `<module>:<line>`. **None** of the definitions defines the anchor: each transaction or posting takes the ID it would have without one, an account has no anchor, and tags naming it are plain. So the result does not depend on which definition comes first.
- Anchors are compared by their text (see `anchorKey` in [ledger.md](ledger.md), "API"), case included.
- A transaction dropped while loading, such as one with `txn.amount-not-inferable` or with syntax reported as `syntax.unsupported`, still defines its anchors and those of its postings, so they count toward `anchor.duplicate` and serve as IDs (see [ledger.md](ledger.md), "IDs"). No record is linked, though: tags naming such an anchor are plain, and a tag whose scope needs a record, such as `#refund:<anchor>`, is `tag.wrong-target`. A block that could not be parsed defines nothing.
- An anchor whose name breaks the rules for anchors, such as `%lunch.1005` or `#refund:lunch.1005`, is `anchor.invalid-name` (error), reported by the parser, and the block is not loaded (see [../dsl/lexical.md](../dsl/lexical.md), "Identifiers").
- An anchor followed by a period, such as `%rent/2026-11`, is reserved (see [diagnostics.md](diagnostics.md), "Unsupported syntax").

### Resolving tags

Status: `implemented`

- After every anchor is collected, each tag and each primary tag is resolved: when a record defines its anchor, `target` is that record's ID; otherwise the tag is plain.
- A plain tag is not an error. Writing an anchor later anchors every tag that names it, with no diagnostic.
- A tag whose `target` is the record it is written on is `tag.self-reference` (error), and the tag is skipped. A posting tagged with its own transaction's anchor, or the other way round, is not a self-reference.
- A tag with a period, such as `#statement:card/2026-10`, is reserved (see [diagnostics.md](diagnostics.md), "Unsupported syntax").

### Scopes

Status: `implemented`

Scopes are defined by Core; a ledger cannot add any.

| Scope | Written on | Its anchor names | Rule |
| --- | --- | --- | --- |
| `tag` (default) | Transaction, posting | Any record, or none | None |
| `refund` | Transaction | An `occurred` transaction | See "Refunds" |
| `system` | Transaction, posting | Nothing | Only on generated transactions, such as `system:balance` (see [transactions.md](transactions.md), "System-generated transactions") |

- A scope that Core does not define, such as `#category:camera`, is `tag.unknown-scope` (error).
- A tag written where its scope may not stand, such as `#refund:x` on a posting, is `tag.wrong-level` (error). Only where a tag is written counts: a transaction's tags are also a posting's tags, and are not checked again there.
- A tag whose anchor does not name the record its scope needs is `tag.wrong-target` (error). For `refund`, this includes an anchor no record defines, and one that names a posting, an account, or a `planned` or `cancelled` transaction.
- A `system` tag written in a ledger is `tag.reserved-scope` (error).
- In all four cases the tag is skipped: it is not in the derived record's tags, and the record loads. The Raw record keeps it, as written (see [ledger.md](ledger.md), "Concepts"). The diagnostic is reported on the record the tag is written on: the transaction for a tag on its header, the posting for a tag on a posting line.
- The scopes `installment`, `statement`, `fulfills`, `rule` and `shared` are reserved (see [diagnostics.md](diagnostics.md), "Unsupported syntax").

### Primary tags

Status: `implemented`

- A transaction has at most one primary tag, so primary tags never overlap: grouping by primary tag gives totals that add up to the whole, with the transactions that have none in the "none" group (see [query.md](query.md), "Grouping").
- Tags may overlap: one transaction can carry several, so totals by tag may add up to more than the whole.
- A primary tag resolves as a tag does (see "Resolving tags"). Like a tag, it exists whether or not a record defines its anchor: `^trip` groups, filters and totals the same with or without `%trip`, and `primaryTarget` only says whether the anchor is mounted on a record. It is never checked against a scope, because its scope is always `tag`.
- A primary tag naming the transaction it is written on, such as `%trip … ^trip`, is `tag.self-reference` (error): the anchor's record is never a member of its own group. `primaryTag` and `primaryTarget` are left out.
- A second `^` on one header is `txn.multiple-primary-tag` (error), reported by the parser; the block is not loaded.

### Groups

Status: `implemented`

- The members of a tag are found with the `tags` clause of a query, written in full as `<scope>:<anchor>`, such as `tag:travel` or `refund:t_book`; those of a primary tag with the `primaryTag` clause (see [query.md](query.md), "Filtering"). A tag on a posting makes that posting a matched posting; a tag on a transaction makes every posting of it one.
- The record the anchor names is found with the `ids` clause (see "Looking up by ID"). It is not a member, even when it carries the tag itself.
- When a group is listed, as the CLI's `group` does (see [../cli.md](../cli.md)), the anchor's record comes first, marked as the anchor, and is not counted as a member.
- To give a group information, such as a budget, write a transaction with no postings that defines the anchor, and put the information in its metadata.

### Refunds

Status: `implemented`

A **refund** is money that actually comes back. It is a new transaction tagged `#refund:<anchor>`, naming the original transaction; the original is never changed. A mistake is not a refund: it is corrected by cancelling the wrong transaction (see [transactions.md](transactions.md), "Status and occurrence").

- The refund counts with its own postings and its own times, like any transaction. A transaction may be refunded more than once.
- **Refunded amount.** Refunds are measured on the original's income and expense postings, per account and commodity. The **original amount** is the original transaction's net amount on that account in that commodity. The **refunded amount** is the net of every `occurred` refund transaction's postings on the same account and commodity, counted in the opposite direction. Other accounts, such as the bank the money comes back to, and other commodities are not measured.
- When, on some account and commodity, the refunded amount exceeds the original amount by more than the tolerance of [balance.md](balance.md), "Balance assertions", that is `refund.exceeds` (warning). It is a warning about the anchor, so it is reported once per refunded transaction, however many accounts or commodities exceed, on the refund transaction that first makes one exceed, in transaction order. The message names the anchor and, for each account and commodity that exceeds, the original amount and the refunded amount over every `occurred` refund in the ledger, not only those up to the refund it is reported on. A refund beyond the original is allowed, since a shop may add compensation; nothing is changed.
- A fee kept by the shop is a third posting in the refund. The refunded amount is still what was taken off the original's account, so it is not counted as short.

### Looking up by ID

Status: `implemented`

- The `ids` clause of a query (see [query.md](query.md), "Filtering") selects records by their IDs: anchors, or generated IDs such as `~3` or `~3.2` (see [ledger.md](ledger.md), "IDs"). A generated ID changes when records are added before it; an anchor does not.
- An ID names a transaction or a posting; both share one namespace, so the value alone says which. A transaction's ID matches that transaction, with every posting of it matched; a posting's ID matches its transaction, with only that posting matched.
- Like every clause, it follows the query's occurrence: a `planned` or `cancelled` record is found only with the `occurrence` clause.
- An ID no record has, including an anchor defined more than once, matches nothing. It is never a diagnostic.
- Accounts are not query results. An account is found in the ledger's `accounts`, by its `id` or by its `anchor`.

## API

- Records are looked up with the query clause `ids`, and members of a group with `tags` and `primaryTag` (see [query.md](query.md), "API").
- `anchorKey` is described in [ledger.md](ledger.md), "API".

## Examples

```hueke
2026-10-18 %tokyo-trip "Tokyo trip"
    ;; budget: 60000 NTD

2026-10-18 * "Flight" ^tokyo-trip #travel
    Expenses:Transport     12000 NTD
    Bank:Checking         -12000 NTD

2026-10-19 * "Hotel" ^tokyo-trip #travel #claim
    Expenses:Lodging     8000 NTD
    Bank:Checking       -8000 NTD

2026-10-20 * "Lunch" #claim
    Expenses:Food     300 NTD
    Assets:Cash      -300 NTD
```

No diagnostics. With `q = query(ledger).axis("accounting").within("2026-10")`:

| Call | Result |
| --- | --- |
| Iterating `query(ledger).ids("tokyo-trip")` | "Tokyo trip", with `budget` in its metadata |
| Iterating `query(ledger).primaryTag("tokyo-trip")` | Flight, Hotel; the anchor's record is not a member |
| Iterating `query(ledger).tags("tag:travel")` | Flight, Hotel |
| Iterating `query(ledger).tags("tag:claim")` | Hotel, Lunch |
| `query(ledger).tags("travel")` | Throws `query.tag-without-scope`: a tag is written in full |
| `balance(ledger, q.accounts("Expenses").primaryTag("tokyo-trip"))` | `Expenses` (subtotal) 20000 NTD, `Expenses:Lodging` 8000 NTD, `Expenses:Transport` 12000 NTD |
| `balance(ledger, q.primaryTag("tokyo-trip"))` | Also `Bank` (subtotal) −20000 NTD and `Bank:Checking` −20000 NTD: with only transaction-level clauses, every posting matches |
| `q.accounts("Expenses").groupBy("primaryTag").sum()` | The "none" group 300 NTD, then `tokyo-trip` 20000 NTD |
| `balance(ledger, q.accounts("Expenses").tags("tag:claim"))` | `Expenses` (subtotal) 8300 NTD, `Expenses:Food` 300 NTD, `Expenses:Lodging` 8000 NTD |

The flight's and the hotel's primary tag has `primaryTarget` set to the ID of "Tokyo trip", `tokyo-trip`. The `#travel` tags are plain.

```hueke
2026-10-18 * "Flight" #trip-1018
    Expenses:Transport     12000 NTD
    Bank:Checking         -12000 NTD

2026-10-18 %trip-1018 "Tokyo trip"
```

No diagnostics. The flight's tag `trip-1018` is anchored: its `target` is `trip-1018`.

| Ledger text | `check` |
| --- | --- |
| `2026-10-03 * %t_book "Bookstore"` and `2026-10-04 * %t_book "Bookstore again"`, each with postings | `anchor.duplicate` on the second, naming the first; the two transactions have IDs `~1` and `~2` |
| The same, and `account Assets:Wallet %t_book` | Two `anchor.duplicate`; no record has the anchor `t_book` |
| `2026-10-05 * %lunch.1005 "Lunch"` with postings | `anchor.invalid-name`; the block is not loaded |

```hueke
2026-10-11 * "Hotel deposit"
    Expenses:Lodging     1000 NTD  %deposit-1011
    Bank:Checking       -1000 NTD

2026-10-12 * "Camera strap" #category:camera
    Expenses:Equipment     900 NTD
    Assets:Cash           -900 NTD

2026-10-15 * "Refund written on a posting"
    Assets:Cash        30 NTD  #refund:t_self
    Expenses:Food     -30 NTD

2026-10-16 * "Refund of the wrong record" #refund:deposit-1011
    Assets:Cash       100 NTD
    Expenses:Food    -100 NTD

2026-10-17 * %t_self "Refund of itself" #refund:t_self
    Assets:Cash        50 NTD
    Expenses:Food     -50 NTD

2026-10-25 * "Hand-written padding" #system:balance
    Bank:Checking              10 NTD
    Expenses:ReconcileDiff    -10 NTD
```

`check` reports `tag.unknown-scope` for `#category:camera`; `tag.wrong-level` for `#refund:t_self` on the 2026-10-15 posting; `tag.wrong-target` for `#refund:deposit-1011`, which names a posting; `tag.self-reference` for 2026-10-17; `tag.reserved-scope` for `#system:balance`. Every transaction loads, without the faulty tag.

**Refunds**

```hueke
2026-10-03 * %t_book "Bookstore"
    Expenses:Other     500 NTD
    Assets:Cash       -500 NTD

2026-10-20 * "Returned one book" #refund:t_book
    Assets:Cash        200 NTD
    Expenses:Other    -200 NTD
```

No diagnostics. `Expenses:Other` totals 300 NTD for October; iterating `query(ledger).tags("refund:t_book")` gives the refund, and iterating `query(ledger).ids("t_book")` the bookstore.

```hueke
2026-10-12 * %t_hp "Headphones"
    Expenses:Equipment     1500 NTD
    Bank:Checking         -1500 NTD

2026-10-18 * "Headphones returned, full refund" #refund:t_hp
    Expenses:Equipment    -1500 NTD
    Bank:Checking          1500 NTD [2026-10-21]
```

No diagnostics. `Expenses:Equipment` totals 0 NTD for October on the accounting axis. `Bank:Checking` is −1500 NTD on 2026-10-20 and 0 NTD on 2026-10-21.

```hueke
2026-10-10 * %t_sofa "Sofa"
    Expenses:Furniture     5000 NTD
    Bank:Checking         -5000 NTD

2026-10-20 * "Sofa returned, 10% restocking fee" #refund:t_sofa
    Bank:Checking          4500 NTD
    Expenses:Fees           500 NTD
    Expenses:Furniture    -5000 NTD
```

No diagnostics: the refunded amount on `Expenses:Furniture` is 5000 NTD, equal to the original. `Expenses:Furniture` totals 0 NTD and `Expenses:Fees` 500 NTD; `Bank:Checking` is −500 NTD on 2026-10-20.

```hueke
2026-10-03 * %t_gift "Gift"
    Expenses:Other     500 NTD
    Assets:Cash       -500 NTD

2026-10-10 * "Partly refunded" #refund:t_gift
    Assets:Cash        300 NTD
    Expenses:Other    -300 NTD

2026-10-20 * "Shop added compensation" #refund:t_gift
    Assets:Cash        300 NTD
    Expenses:Other    -300 NTD
```

One `refund.exceeds` (warning), on the 2026-10-20 transaction: `t_gift`, `Expenses:Other`, original 500 NTD, refunded 600 NTD. `Expenses:Other` totals −100 NTD.
