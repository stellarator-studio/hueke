# Balance assertions and reconciliation

A **Balance assertion** states the balance an account should have at a point. A `hard` Balance only checks it; a `pad` Balance makes the account reach it by generating a transaction. Together with each posting's status, Balances make up reconciliation, and the **reconciliation view** shows one account as a statement. This document covers both kinds of Balance, how pads are expanded, Balances limited to one entity, Balances on obligations, and the view.

## Features

| Feature | Status |
| --- | --- |
| Balance assertions | `implemented` |
| `hard` assertions | `implemented` |
| `pad` assertions | `implemented` |
| Point-by-point expansion | `implemented` |
| Entities in Balance assertions | `implemented` |
| Obligations in Balance assertions | `implemented` |
| Reconciliation view | `implemented` |

## Concepts

Reconciliation has no record of its own. It is made of three things:

1. the **status** of each posting, checked one by one (see [transactions.md](transactions.md), "Status and occurrence");
2. **Balance assertions**, written when a statement has been checked: the balance an account should have at a point;
3. the **reconciliation view**, derived from both.

**Balance**

| Field | Meaning |
| --- | --- |
| `source`, `span`, `origin` | Where it was written and its Raw record. |
| `account` | The account asserted. Its sub-accounts are included. |
| `entity` | The entity the assertion is limited to, if written (see "Entities in Balance assertions"). |
| `effective` | The point asserted (see [time.md](time.md), "Points and periods"). Always one day. |
| `accounting` | The accounting time written, if any; used only for the transaction a `pad` generates. |
| `amount` | The asserted balance, in one commodity. Only that commodity is asserted. |
| `mode` | `hard` or `pad`. |
| `pad` | The padding written, on the asserted account, signed, in the asserted commodity; absent when not written. |
| `padPrice` | The total price of the padding, across commodities, if written. |
| `padAccount` | The counter-account written, if any (see "`pad` assertions" for the defaults). |
| `meta` | Metadata, such as a `document` naming the statement file. A Balance has no tags. |

**Reconciliation view**

| Field | Meaning |
| --- | --- |
| `account` | The account reconciled. |
| `commodity` | The one commodity the view covers. |
| `range` | The period `(after, until]`: `after` is absent when the period starts at the beginning of the ledger. |
| `opening` | The balance at `after`, in the view's commodity. |
| `postings` | The IDs of the account's postings in the view's commodity in the period, in effective order. |
| `closing` | The balance at `until`, in the view's commodity. |
| `uncleared` | The IDs of the account's postings in the view's commodity with status `none` up to `until`, earlier periods included. |
| `asserted` | The amount of the Balance at `until` in the view's commodity, if one sits there. |
| `difference` | Recorded minus asserted: `closing − asserted`, when there is an assertion. |

## Behavior

### Balance assertions

Status: `implemented`

- The point is `effective` (see [time.md](time.md), "Points and periods"). Only postings on the effective axis count.
- `effective` is one day: precision `day`. A week, month, year, interval or time of day is `balance.invalid-effective`, and the Balance is not loaded.
- A Balance may also carry an accounting time, written as on a transaction header (`2026-10-31=2026-10`). It never changes what is asserted; it only becomes the accounting time of the transaction a `pad` generates.
- The account includes its sub-accounts.
- All `occurred` postings count, cleared or not.
- Only the asserted commodity is checked. An account holding NTD and USD, with a Balance in NTD, has only its NTD balance checked; its USD is not looked at.
- **Tolerance.** A balance passes when it is within half a unit of the asserted commodity's precision: |recorded − asserted| ≤ 0.5 × 10^−p, where p is the commodity's precision, declared or inferred (see [commodities.md](commodities.md)). The same tolerance holds wherever these rules compare a balance with `amount`.

### `hard` assertions

Status: `implemented`

The default. The computed balance must equal `amount`, within the tolerance.

- A difference beyond the tolerance is `balance.mismatch`. Nothing is generated.
- The message gives the asserted amount, the recorded amount, the difference (recorded minus asserted), and the uncleared postings (date and amount) since the previous Balance of the same account and commodity, `hard` or `pad`, to help find the error. Postings at the previous Balance's point are not listed, since that Balance already counted them. A Balance with an entity counts as previous only for Balances with the same entity, and one without only for those without. Of two Balances at the same point, the one earlier in source position is the previous one.
- `hard` Balances are checked in validation against the final state, after every `pad` has been expanded.

### `pad` assertions

Status: `implemented`

- The generated transaction has the Balance's effective time as its effective time, the Balance's accounting time as its accounting time when one is written, otherwise the effective time, and the tag `system:balance`. Its postings inherit the effective time, which is one day, so they always satisfy the rule for a posting's effective time (see [time.md](time.md), "Time axes"). The asserted account gets the padding, priced at `padPrice` when one is written; the counter-account gets the negated padding, or the negated `padPrice`.
- **Padding not written**: padding = `amount` − recorded balance. A difference within the tolerance generates nothing.
- **Padding written**: recorded balance + padding must equal `amount` within the tolerance, otherwise `balance.mismatch` and nothing is generated; its difference is recorded balance + padding − `amount`. If an earlier entry is later corrected, the assertion fails loudly instead of silently absorbing the difference. Padding of zero generates nothing.
- A pad fills only the asserted commodity. Written padding in another commodity is `balance.pad-commodity`, and nothing is generated. `padPrice` may be in another commodity. Whether the account may hold a commodity is not checked.
- The counter-account is, in this order: the Balance's `padAccount`; the asserted account's `padAccount`, declared or inherited from an obligation account (see [accounts.md](accounts.md), "Obligation and pad settings"); the ledger's `pad-account`. With none, `balance.missing-pad-account` and nothing is generated.
- The generated postings have status `none`. The transaction is a system-generated one (see [transactions.md](transactions.md), "System-generated transactions"). Later Balances see it.

### Point-by-point expansion

Status: `implemented`

1. Sort every `pad` Balance by its point, then by source position.
2. Process them in order. Each sees every posting up to its point, plus the transactions generated so far.
3. A generated transaction uses its Balance's effective time, so a `hard` Balance at the same point or later sees it.
4. Pads at the same point must not affect each other, because the result would then depend on their order. Pad A affects pad B when A's padding or counter-account, in B's commodity, is on B's account or one of its sub-accounts, whatever A's difference turns out to be. This covers a pad on a parent and one on its sub-account (`Assets` and `Assets:Cash`), and a counter-account inside the other pad's account. When A affects B or B affects A, neither generates anything, and **each** of them is `balance.pad-conflict`, with a message naming the other's account. A pad in conflict with several others is reported once, naming the first of them in the order of step 1.
5. A pad whose counter-account is its own account or one of its sub-accounts, in the asserted commodity, moves amounts inside the account and can never reach `amount`. It is `balance.pad-conflict` and generates nothing. A pad that is also in conflict under step 4 is reported once, with the message of step 4.
6. Entities are not looked at: pads at the same point on the same account conflict even when their entities differ.

### Entities in Balance assertions

Status: `implemented`

`balance <account> @<entity> <amount>` asserts only the postings of that entity: the group (account, entity, commodity). Obligations follow their own rule (see "Obligations in Balance assertions").

- A posting belongs to the entity when its references include it, read as queries read them: the posting's own, else its transaction's (see [query.md](query.md), "Matched postings"). So on an account above an obligation account, such as `balance Assets @NAT`, a posting on an obligation belongs to the obligation's entities (see [obligations.md](obligations.md), "Entities of an obligation").
- A Balance without an entity asserts every posting of the account, whatever its entity.
- A Balance takes at most one entity. Its role is always `person` (see [entities.md](entities.md), "References and roles"); with another role, the reference is skipped and the Balance asserts every posting.
- A pad with an entity puts the entity on the posting it generates on the asserted account; the counter-account's posting has none.
- The reconciliation view does not look at Balances with an entity (see "Reconciliation view").

### Obligations in Balance assertions

Status: `implemented`

Obligations are checked and closed with Balances (see [obligations.md](obligations.md), "Settling an obligation").

- A Balance on an obligation account or an obligation asserts whole obligations; an entity never narrows it.
- Only a pad on one obligation may write `@<entity>`: it asserts the whole obligation, and puts the entity on the posting it generates there, to say who the write-off is with. Any other Balance on an obligation account or inside one with an entity, such as a `hard` Balance or one on the obligation account itself, is `balance.obligation-entity` (error), and the Balance is not loaded.
- A pad on an obligation account, an obligation, or an account inside one must write its padding. Without it, the pad would quietly cover a repayment left unrecorded, so it is `balance.pad-needs-amount` (error), and nothing is generated.
- A pad must close one obligation. On the obligation account itself, it is `balance.ambiguous` (error), and nothing is generated.
- When both apply, only `balance.pad-needs-amount` is reported.
- The generated posting on the obligation is a repayment or a lending by its sign, like any posting.

### Reconciliation view

Status: `implemented`

The view is a statement for one commodity: opening balance, plus the period's postings, gives the closing balance, which is compared with the assertion.

- There is one view per commodity that the account, sub-accounts included, has a posting in up to `at`, or that a Balance on the account asserts up to `at`. Views are sorted by commodity.
- Each commodity has its own period: `after` is the point of the account's latest Balance in that commodity strictly before `at`. Without one, the period starts at the beginning of the ledger. A Balance in another commodity does not start a period.
- Only Balances on exactly this account count, not those on its sub-accounts, nor those with an entity. Postings of sub-accounts are included.
- It always uses the effective axis, and counts only `occurred` postings. A running balance is the presentation layer's job.
- `uncleared` covers the whole ledger up to `at`, because postings left unchecked in earlier periods carry over.
- Reconciling is: mark postings cleared one by one, then write a Balance at the statement's point.

## API

- `reconcile(ledger, { account, at })` returns the account's reconciliation views, one per commodity, `at` being a time (see [time.md](time.md), "Times given to the API"). The list is empty when the account has nothing in any commodity up to `at`. It throws when `at` is rejected (see [time.md](time.md), "Times given to the API").
- Balances themselves are in the ledger's `balances`; their failures come from `check` (see [ledger.md](ledger.md)).

## Examples

```hueke
2026-10-03 "Bookstore"
    Expenses:Other             500 NTD
    Liabilities:CreditCard    -500 NTD

2026-10-12 * "Supermarket"
    Expenses:Groceries         2700 NTD
    Liabilities:CreditCard    -2700 NTD

2026-10-25 balance Liabilities:CreditCard -3200 NTD
```

No diagnostics. `reconcile(ledger, { account: "Liabilities:CreditCard", at: "2026-10-25" })` returns one view: `commodity` NTD, no `after`, `opening` 0 NTD, `postings` the −500 (none) and −2700 (cleared) postings, `closing` −3200 NTD, `asserted` −3200 NTD, `difference` 0 NTD, `uncleared` the −500 posting.

Without the 2026-10-12 transaction, `check` reports `balance.mismatch` with `asserted -3200 NTD`, `recorded -500 NTD`, `off by 2700 NTD` and the uncleared `2026-10-03 -500`.

Opening: `2026-10-01 * "Opening"` with `Bank:Checking 12300 NTD` and `Equity:Opening -12300 NTD`.

| Balance added | Result |
| --- | --- |
| `2026-10-25 balance Bank:Checking 12345 NTD pad -> Expenses:ReconcileDiff` | A `system:balance` transaction on 2026-10-25: `Bank:Checking` 45 NTD and `Expenses:ReconcileDiff` −45 NTD, both `none`. `Bank:Checking` is 12345 NTD. |
| `2026-10-25 balance Bank:Checking 12345 NTD` | `balance.mismatch`, `off by -45 NTD`; nothing generated |
| `option pad-account Expenses:ReconcileDiff` and `2026-10-25 balance Bank:Checking 12345 NTD pad` | The same transaction as the first row |
| `2026-10-25 balance Bank:Checking 12345 NTD pad`, no `pad-account` | `balance.missing-pad-account` |
| `2026-10-25 balance Bank:Checking 12345 NTD pad 45 NTD -> Expenses:ReconcileDiff` | The same transaction as the first row |
| `2026-10-25 balance Bank:Checking 12345 NTD pad 40 NTD -> Expenses:ReconcileDiff` | `balance.mismatch`; nothing generated |
| `2026-10-25 balance Bank:Checking 12345 NTD pad 45 USD -> Expenses:ReconcileDiff` | `balance.pad-commodity`; nothing generated |
| `2026-10-31=2026-10 balance Bank:Checking 12345 NTD pad -> Expenses:ReconcileDiff` | A `system:balance` transaction with effective time 2026-10-31 and accounting time 2026-10; `Bank:Checking` 45 NTD and `Expenses:ReconcileDiff` −45 NTD |
| `2026-10 balance Bank:Checking 12345 NTD` | `balance.invalid-effective`; the Balance is not loaded |
| With `Assets:Cash 500 NTD` also opened: `... Bank:Checking 12345 NTD pad -> Assets:Cash` and `... Assets:Cash 480 NTD pad -> Bank:Checking` at the same point | Two `balance.pad-conflict`, one on each Balance, each naming the other's account; nothing generated |
| With `Assets:Cash 500 NTD` also opened: `... Assets 480 NTD pad -> Expenses:ReconcileDiff` and `... Assets:Cash 450 NTD pad -> Expenses:ReconcileDiff` at the same point | Two `balance.pad-conflict`: the pad on `Assets:Cash` changes the balance of `Assets`; nothing generated |
| `2026-10-25 balance Bank 12345 NTD pad -> Bank:Savings` | `balance.pad-conflict`: the counter-account is inside `Bank`; nothing generated |

```hueke
2026-09-01 * "Opening"
    Bank:Checking      1000 NTD
    Equity:Opening    -1000 NTD

2026-09-20 "Withdrawal not yet checked"
    Assets:Cash       100 NTD
    Bank:Checking    -100 NTD

2026-09-30 balance Bank:Checking 900 NTD

2026-10-10 "Transfer not yet checked"
    Expenses:Other     200 NTD
    Bank:Checking     -200 NTD

2026-10-31 balance Bank:Checking 650 NTD
```

`balance.mismatch` for 2026-10-31: `asserted 650 NTD`, `recorded 700 NTD`, `off by 50 NTD`, listing `2026-10-10 -200` and not the 2026-09-20 posting, which is before the previous Balance.

```hueke
2026-09-01 * "Opening"
    Bank:Checking      1000 NTD
    Bank:Checking       100 USD
    Equity:Opening    -1000 NTD
    Equity:Opening     -100 USD

2026-09-30 balance Bank:Checking 1000 NTD
2026-10-15 balance Bank:Checking 100 USD

2026-10-20 * "Fee"
    Expenses:Other     50 NTD
    Bank:Checking     -50 NTD

2026-10-31 balance Bank:Checking 950 NTD
```

No diagnostics: each Balance checks only its own commodity. `reconcile(ledger, { account: "Bank:Checking", at: "2026-10-31" })` returns two views. NTD: `after` 2026-09-30, `opening` 1000 NTD, `postings` the fee, `closing` 950 NTD, `asserted` 950 NTD, `difference` 0 NTD. USD: `after` 2026-10-15, `opening` 100 USD, no `postings`, `closing` 100 USD, no `asserted`.

USD has precision 2, so a Balance passes within 0.005 USD:

| Postings on `Bank:USDAccount` | Balance on 2026-10-31 | Result |
| --- | --- | --- |
| 10.004 USD | `balance Bank:USDAccount 10.00 USD` | Passes; the posting is `posting.excess-precision` |
| 10.004 USD | `balance Bank:USDAccount 10.01 USD` | `balance.mismatch`, off by −0.006 USD |

**Entities**

```hueke
2026-10-01 * "Opening"
    Bank:Checking      1000 NTD
    Equity:Opening    -1000 NTD

2026-10-05 * "October salary" @acme
    Bank:Checking     50000 NTD
    Income:Salary    -50000 NTD

2026-10-08 "Returned shoes" @shop
    Bank:Checking       300 NTD
    Expenses:Other     -300 NTD
```

`Bank:Checking` is 51300 NTD on 2026-10-31.

| Balance added | Result |
| --- | --- |
| `2026-10-31 balance Bank:Checking @acme 50000 NTD` | No diagnostics: only the salary is asserted |
| `2026-10-31 balance Bank:Checking @acme 51000 NTD` | `balance.mismatch`: asserted 51000 NTD, recorded 50000 NTD, off by −1000 NTD |
| `2026-10-31 balance Bank:Checking @shop 200 NTD pad -> Expenses:ReconcileDiff` | A `system:balance` transaction: `Bank:Checking` −100 NTD with `@shop`, `Expenses:ReconcileDiff` 100 NTD with no reference. `Bank:Checking` is 51200 NTD |
| The same, and `2026-10-31 balance Bank:Checking 51200 NTD` | No diagnostics: the Balance without an entity sees the generated posting. `reconcile` at 2026-10-31 has `asserted` 51200 NTD, from that Balance only |
| `2026-10-31 balance Bank:Checking @acme 50000 NTD` alone | `reconcile` at 2026-11-30 has no `asserted`, and its period starts at the beginning of the ledger: a Balance with an entity does not start one. With `2026-10-31 balance Bank:Checking 51300 NTD` instead, `after` is 2026-10-31 and `opening` 51300 NTD |
| `2026-10-31 balance Bank:Checking @payee:shop 300 NTD` | `name.unknown-role`, and the Balance asserts every posting: `balance.mismatch`, recorded 51300 NTD |
