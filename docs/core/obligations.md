# Obligations

An **obligation** is money someone owes you, or you owe someone: a lunch paid for a friend, a loan. Obligations live under an **obligation account**, an account declared `receivable` or `payable`; each direct sub-account of it is **one obligation**. Postings that open an obligation are **lending**, postings that reduce it are **repayment**. Whether an obligation is settled depends only on its own postings; the entities on them only say who it is with. This document covers obligation accounts, lending and repayment, the entities of an obligation, its progress, hiding settled obligations, settling with `balance`, and `obligations`.

## Features

| Feature | Status |
| --- | --- |
| Obligation accounts | `implemented` |
| Lending and repayment | `implemented` |
| Entities of an obligation | `implemented` |
| Progress | `implemented` |
| Hiding settled obligations | `implemented` |
| Settling an obligation | `implemented` |
| `obligations` | `implemented` |

## Concepts

An obligation has no record of its own. It is made of the postings on one sub-account of an obligation account, and everything about it is derived from them.

**Obligation account**: an account declared with `obligation receivable` (others owe you) or `obligation payable` (you owe others) (see [accounts.md](accounts.md), "Obligation and pad settings").

**Obligation**: a direct sub-account of an obligation account, such as `Assets:Receivable:lunch-1011`. The last segment is only a name.

**Progress** (one row of `obligations`): one obligation in one commodity.

| Field | Meaning |
| --- | --- |
| `account` | The obligation. |
| `commodity` | The commodity. |
| `entities` | The entities of the obligation (see "Entities of an obligation"), sorted by ID. |
| `original` | The sum of the lending postings, made positive. |
| `repaid` | The sum of the repayment postings, made positive. |
| `remaining` | `original − repaid`. Negative when more was repaid than lent. |
| `settled` | Whether `remaining` is zero, within the tolerance (see "Progress"). |
| `lastRepaid` | The effective time of the latest repayment posting; absent when there is none. |
| `postings` | The IDs of the obligation's postings in this commodity, in effective order: its history. |

## Behavior

### Obligation accounts

Status: `implemented`

- An obligation account's sub-accounts inherit its `obligation` and its `pad-account`. They need no declaration, even when strict mode covers accounts; declare one only to give it a display name or metadata.
- A posting on the obligation account itself, not on one of its sub-accounts, is `obligation.root-posting` (error). It counts in balances, but belongs to no obligation.
- Obligations have one level: an obligation has no sub-accounts. Use a reference, `@NAT`, to say who it is with, not a sub-account. Anything written on an account inside an obligation, such as `Assets:Receivable:NAT:snack-1012`, is `obligation.nested` (error), reported on what was written:
  - a posting on it: the posting counts in balances but belongs to no obligation;
  - an `account` declaration of it;
  - a Balance on it, `pad` included. The posting a pad generates there is not reported again, since it has no place in the files; it counts in balances but belongs to no obligation.
- An `obligation` declared on an account inside an obligation account is also `obligation.nested`, and that declaration's `obligation` takes no effect. A declaration that is both inside an obligation and declares `obligation` is reported once.
- An account inside an obligation inherits like any other sub-account (see above); `obligation.nested` already reports everything written on it.
- An obligation account may stand under any root, whatever its type, or under an unknown root. Its type changes nothing about obligations; rules that depend on type still apply to its postings, such as `posting.pnl-effective` under an expense root.
- An obligation opens with its first posting; it needs no declaration. It may have several lending postings.
- The same last segment under a receivable and under a payable account, such as `Assets:Receivable:tokyo-trip` and `Liabilities:Payable:tokyo-trip`, gives two obligations that never offset each other.

### Lending and repayment

Status: `implemented`

- The obligation account decides the direction. On `receivable`, a positive posting is lending and a negative one is repayment. On `payable`, a negative posting is lending and a positive one is repayment.
- A posting of zero is neither lending nor repayment. It is one of the obligation's postings, but adds nothing to its progress and gives it no entity, even when it is the only posting that names anyone.
- Any posting that reduces an obligation is a repayment, with or without money moving: offsetting what someone owes you against what you owe them is two repayment postings in one transaction.
- One payment covering several obligations is one transaction with a repayment posting on each. One obligation repaid in parts is several repayment postings on it.
- Only `occurred` postings count, as for balances.

### Entities of an obligation

Status: `implemented`

- The entities of an obligation are those accumulating it: the entities in the own references of its `occurred` lending postings, anywhere in the ledger. When no lending posting names anyone, as with a prepayment never followed by lending, the own references of its repayment postings are used instead. A transaction's references are never used, because the header usually names the shop.
- In queries, every posting on an obligation, its repayments included, takes the obligation's entities as its references (see [query.md](query.md), "Matched postings"). So `entities("NAT")`, or `--who NAT`, gives the whole chain of every obligation NAT accumulates, and grouping by entity puts each obligation's postings under those entities.
- **Every obligation is with at least one entity.** An obligation whose postings name no one at all is `obligation.missing-entity` (error), reported once, on its first posting in transaction order; it counts as written. `check` lists every such obligation, and `obligations` without an entity lists their rows with empty `entities`.
- A single posting may leave its reference out, lending or repayment, as long as the obligation has an entity. A repayment that writes one keeps it in its `refs`; it adds to the obligation's entities only when no lending posting names anyone.
- Entities do not depend on time. They are collected once from the whole ledger, not as of the point a query or `obligations` looks at, because what matters is who the obligation is with and whether it is settled. Example: NAT sends 500 NTD to `trip-1001` on 2026-10-01 as a prepayment, a repayment posting, and the first lending posting `@NAT` comes on 2026-10-05. `trip-1001` has the entity NAT throughout, so `obligations` with `entity` NAT at 2026-10-01 already lists it, with `remaining` −500, and `--who NAT` matches the 2026-10-01 posting.
- A posting may name several entities, and an obligation may be with several people. Entities never split an obligation: its progress and whether it is settled are computed over all its postings, whoever they name.
- To follow what each person owes separately, give each person an obligation of their own, such as `dinner-1013-amy` and `dinner-1013-bob`.

### Progress

Status: `implemented`

- Progress is computed per obligation and commodity, never converted between commodities. A debt in THB repaid in NTD is repaid with a THB posting priced in NTD (`3000 THB @@ 2700 NTD`).
- `original` and `repaid` are made positive according to the direction. On a payable obligation with 5000 lent and 2000 repaid, `original` is 5000, `repaid` 2000 and `remaining` 3000, although the account's balance is −3000.
- `settled` means `remaining` is zero within the tolerance of Balance assertions (see [balance.md](balance.md), "Balance assertions"). A difference that small is ignored, so a `balance <obligation> 0 <commodity>` that passes always leaves the obligation settled. `remaining` itself is shown as computed. Everything else is open, including a negative `remaining`, such as a prepayment not yet used up. There are no separate states for "not repaid", "partly repaid" or "overpaid": look at whether `repaid` is zero and at the sign of `remaining`.
- An obligation is **settled** when it is settled in every commodity it has.
- An obligation has no due date, so it is never overdue.
- When one obligation has several commodities and none of its postings has a price or a cost, that is `obligation.unlinked-commodity` (warning): a repayment was probably written in the wrong commodity. Each commodity is computed as usual. It is reported once per obligation, on its first posting, in transaction order, in a commodity other than the obligation's first commodity.
- An obligation's entities, `obligation.missing-entity` and `obligation.unlinked-commodity` look only at `occurred` postings, as progress does. `obligation.root-posting` and `obligation.nested` are about where a record is written, so they look at every posting, whatever its occurrence.

### Hiding settled obligations

Status: `implemented`

Obligations keep piling up, so settled ones are hidden by default.

- `balance` and `register` leave out the row of an obligation that is settled at the end of the query's range: the point of `until`, or the end of a period; with several time clauses, the earliest of their ends; without a time clause, the end of the ledger. Postings are compared on their effective time, whatever the query's axis, as `obligations` does. Whether it is settled looks at all its postings up to that time, not only those the query matches.
- Only the `all` option lists them, even when the query names the obligation itself.
- Hiding changes only which rows are listed, never a total: a parent's subtotal row stays, even when all its obligations are hidden, and still includes them, whose net is zero anyway.
- With `income-expense` on, rows may merge accounts (see [accounts.md](accounts.md), "Combined income and expense"). A row is left out only when every posting it counts is on a settled obligation, so a merged row that also counts another account's postings stays.
- `obligations` hides settled rows in the same way (see "`obligations`").

### Settling an obligation

Status: `implemented`

Obligations are checked and closed with `balance` (see [balance.md](balance.md), "Obligations in Balance assertions").

- **Checking**: `balance <obligation> <amount>` asserts one obligation's balance at a point; `balance <obligation account> <amount>`, the total of its obligations. Entities never narrow these assertions (see [balance.md](balance.md), "Obligations in Balance assertions"). Closing is always done on one obligation, one Balance each.
- **Closing**: an amount nobody will pay is written off with `balance <obligation> [@<entity>] 0 <commodity> pad <padding>`. The padding must be written, and `@<entity>` says who the write-off is with (see [balance.md](balance.md), "Obligations in Balance assertions"). The generated posting goes to the same obligation carrying `@<entity>`, and is a repayment or a lending by its sign; the counter-account is the `pad-account` inherited from the obligation account unless `->` names one.
- A pad may carry a price, as a posting does, to settle a debt in another commodity.
- An obligation can also be closed by an ordinary transaction moving the remainder to an income or expense account; the only difference is that nothing is asserted.

### `obligations`

Status: `implemented`

- It takes the accounts to look at, an entity, a point `at`, and the option `all`, all optional. The accounts are obligation accounts or obligations, sub-accounts included; without accounts, or with an empty list, every obligation account. An account that is neither, and is not inside one, matches nothing.
- With an entity, it lists the obligations whose entities include it, each in full (see "Entities of an obligation").
- It counts the postings on the effective axis up to `at`; without `at`, every posting in the ledger, which tells which obligations are settled as recorded.
- It returns one row per obligation and commodity. It leaves out the rows of settled obligations unless `all` is set; an obligation open in one commodity keeps all its rows. Rows are sorted by account, segment by segment as in the account tree (see [query.md](query.md), "Account tree"), then by commodity, comparing code points.
- An obligation's full history is its rows' `postings`, or a query on the obligation, iterated (see [query.md](query.md)). A running remainder is the presentation layer's job.

## API

- `obligations(ledger, { accounts, entity, at, all })` returns the rows of "`obligations`". Every argument is optional; `at` is a time read as in [time.md](time.md), "Times given to the API". It throws when `at` is rejected, and before initialization.
- `balance` and `register` take the option `all` (see [query.md](query.md), "API").

## Examples

The examples in this document also load these declarations:

```hueke
account Assets:Receivable
    obligation receivable
    pad-account Expenses:WriteOff
account Liabilities:Payable
    obligation payable
    pad-account Expenses:WriteOff
```

**Lending and repayment**

```hueke
2026-10-11 * "Lunch" @starbucks_xinyi
    Expenses:Food                   600 NTD
    Assets:Receivable:lunch-1011    400 NTD @NAT
    Assets:Cash                   -1000 NTD

2026-10-15 * "NAT pays back"
    Bank:Checking                   250 NTD
    Assets:Receivable:lunch-1011   -250 NTD

2026-10-20 * "NAT pays the rest"
    Bank:Checking                   150 NTD
    Assets:Receivable:lunch-1011   -150 NTD @NAT
```

No diagnostics: the 2026-10-15 repayment needs no reference. The obligation's `entities` is `NAT`; `starbucks_xinyi`, on the header, is not one of them.

| Call | Result |
| --- | --- |
| `obligations(ledger, { entity: "NAT", at: "2026-10-11" })` | `lunch-1011`, NTD, `entities` NAT: `original` 400, `repaid` 0, `remaining` 400, open |
| `obligations(ledger, { entity: "NAT", at: "2026-10-15" })` | `original` 400, `repaid` 250, `remaining` 150, open, `lastRepaid` 2026-10-15 |
| `obligations(ledger, { entity: "NAT", at: "2026-10-20" })` | No rows |
| `obligations(ledger, { entity: "NAT", at: "2026-10-20", all: true })` | `original` 400, `repaid` 400, `remaining` 0, settled, `lastRepaid` 2026-10-20 |

```hueke
2026-10-13 * "Dinner, I paid 1200"
    Expenses:Food                     400 NTD
    Assets:Receivable:dinner-1013     800 NTD @AMY @BOB
    Assets:Cash                     -1200 NTD

2026-10-20 * "AMY pays back"
    Bank:Checking                     400 NTD
    Assets:Receivable:dinner-1013    -400 NTD @AMY

2026-10-20 * "BOB pays back"
    Bank:Checking                     300 NTD
    Assets:Receivable:dinner-1013    -300 NTD @BOB
```

`obligations(ledger, { entity: "AMY", at: "2026-10-20" })` returns `dinner-1013`, `entities` AMY and BOB, `original` 800, `repaid` 700, `remaining` 100, open: AMY's repayment is in, but the obligation is not settled. To see each share apart, write two obligations, `dinner-1013-amy` and `dinner-1013-bob`, each with one person.

```hueke
2026-09-01 * "Paid AMY's dinner"
    Assets:Receivable:dinner-0901     300 NTD @AMY
    Assets:Cash                      -300 NTD

2026-09-15 * "Borrowed 200 from AMY"
    Assets:Cash                       200 NTD
    Liabilities:Payable:loan-0915    -200 NTD @AMY

2026-10-31 * "Offset with AMY"
    Liabilities:Payable:loan-0915     200 NTD
    Assets:Receivable:dinner-0901    -200 NTD
```

`obligations(ledger, { entity: "AMY", at: "2026-10-31" })` returns `dinner-0901`, `remaining` 100. `loan-0915` is settled. `Assets:Cash` is −100 NTD.

```hueke
2026-10-01 * "NAT sends trip money first"
    Bank:Checking                   500 NTD
    Assets:Receivable:trip-1001    -500 NTD @NAT

2026-10-05 * "Train ticket for NAT"
    Assets:Receivable:trip-1001     300 NTD @NAT
    Assets:Cash                    -300 NTD

2026-10-10 * "Hotel for NAT"
    Assets:Receivable:trip-1001     500 NTD @NAT
    Assets:Cash                    -500 NTD
```

| `at` | `trip-1001` |
| --- | --- |
| 2026-10-01 | `original` 0, `repaid` 500, `remaining` −500, open |
| 2026-10-05 | `original` 300, `repaid` 500, `remaining` −200, open |
| 2026-10-10 | `original` 800, `repaid` 500, `remaining` 300, open |

**Several commodities**, with `commodity THB` and `precision 2` added:

```hueke
2026-09-10 * "AMY paid my hotel in Bangkok"
    Expenses:Lodging                  3000 THB
    Liabilities:Payable:hotel-0910   -3000 THB @AMY

2026-10-05 * "Paid AMY back in NTD"
    Liabilities:Payable:hotel-0910    3000 THB @@ 2700 NTD
    Bank:Checking                    -2700 NTD
```

`obligations(ledger, { entity: "AMY", at: "2026-10-04" })` returns `hotel-0910` in THB, `remaining` 3000; at 2026-10-05, no rows. `Bank:Checking` is −2700 NTD.

| Instead of the repayment above | Result |
| --- | --- |
| `2026-10-05 balance Liabilities:Payable:hotel-0910 0 THB pad 3000 THB @@ 2700 NTD -> Bank:Checking` | A `system:balance` transaction: `Liabilities:Payable:hotel-0910` 3000 THB @@ 2700 NTD, `Bank:Checking` −2700 NTD. The same rows as above |
| A transaction on 2026-10-01: `Liabilities:Payable:hotel-0910 3000 THB @@ 2700 NTD` and `Liabilities:Payable:hotel-0910 -2700 NTD`; then on 2026-10-05: `Liabilities:Payable:hotel-0910 2700 NTD` and `Bank:Checking -2700 NTD` | At 2026-10-01: two rows, THB `remaining` 0 and NTD `remaining` 2700, since the obligation is still open in NTD. At 2026-10-05: no rows |
| `Liabilities:Payable:hotel-0910 2700 NTD` and `Bank:Checking -2700 NTD` | `obligation.unlinked-commodity`. At 2026-10-05: THB `remaining` 3000, NTD `remaining` −2700, both open |

**Closing**

```hueke
2026-10-11 * "Lunch"
    Expenses:Food                   600 NTD
    Assets:Receivable:lunch-1011    400 NTD @NAT
    Assets:Cash                   -1000 NTD

2026-10-15 * "NAT pays back 350"
    Bank:Checking                   350 NTD
    Assets:Receivable:lunch-1011   -350 NTD
```

| Balance added | Result |
| --- | --- |
| `2026-10-20 balance Assets:Receivable:lunch-1011 0 NTD pad -50 NTD` | A `system:balance` transaction on 2026-10-20: `Assets:Receivable:lunch-1011` −50 NTD, `Expenses:WriteOff` 50 NTD. No rows for NAT at 2026-10-20; at 2026-10-19, `remaining` 50 |
| `2026-10-20 balance Assets:Receivable:lunch-1011 0 NTD pad -50 NTD -> Expenses:Discount` | The same, with `Expenses:Discount` 50 NTD |
| `2026-10-20 balance Assets:Receivable:lunch-1011 0 NTD pad -40 NTD` | `balance.mismatch`: asserted 0, recorded 50, padding −40, off by 10; nothing generated |
| `2026-10-20 balance Assets:Receivable:lunch-1011 0 NTD pad -> Expenses:ReconcileDiff` | `balance.pad-needs-amount`; nothing generated |
| `2026-10-20 balance Assets:Receivable 0 NTD pad -50 NTD` | `balance.ambiguous`: the pad is on the obligation account, not on one obligation; nothing generated |
| `2026-10-20 balance Assets:Receivable:lunch-1011 @NAT 0 NTD pad -50 NTD` | The same transaction as the first row, its `Assets:Receivable:lunch-1011` posting with `@NAT` |
| `2026-10-20 balance Assets:Receivable @NAT 50 NTD` | `balance.obligation-entity`; the Balance is not loaded. Write `balance Assets:Receivable 50 NTD`, or one Balance per obligation |
| `2026-10-20 balance Assets:Receivable:lunch-1011 0 NTD pad -50 NTD` and `2026-10-20 balance Assets:Receivable 0 NTD` | No diagnostics: the hard Balance sees the generated transaction |

With `commodity USD` and `precision 2`, an obligation lent `10.004 USD` and repaid `10.00 USD` has `remaining` 0.004 USD and is settled; `balance … 0 USD` on it passes.

With NAT paying 450 instead of 350, `remaining` is −50 and open; `2026-10-20 balance Assets:Receivable:lunch-1011 0 NTD pad 50 NTD -> Income:Other` closes it with `Assets:Receivable:lunch-1011` 50 NTD and `Income:Other` −50 NTD.

```hueke
account Assets:Parcels
    obligation receivable

2026-10-11 * "Parcel paid for NAT"
    Assets:Parcels:parcel-1011     200 NTD @NAT
    Assets:Cash                   -200 NTD

2026-10-20 balance Assets:Parcels:parcel-1011 0 NTD pad -200 NTD
```

`balance.missing-pad-account`: neither the account nor the ledger has a `pad-account`, and the pad names none.

**History**

```hueke
2026-10-11 * "Lunch for NAT"
    Assets:Receivable:trip-1011     400 NTD @NAT
    Assets:Cash                    -400 NTD

2026-10-12 * "Ticket for NAT"
    Assets:Receivable:trip-1011     300 NTD @NAT
    Assets:Cash                    -300 NTD

2026-10-15 * "NAT pays part"
    Bank:Checking                   500 NTD
    Assets:Receivable:trip-1011    -500 NTD

2026-10-20 * "NAT pays more"
    Bank:Checking                   180 NTD
    Assets:Receivable:trip-1011    -180 NTD

2026-10-25 balance Assets:Receivable:trip-1011 0 NTD pad -20 NTD
```

`query(ledger).accounts("Assets:Receivable:trip-1011").postings()` gives +400, +300, −500, −180 and −20 NTD, the last one tagged `system:balance`. `obligations(ledger, { accounts: ["Assets:Receivable:trip-1011"], at: "2026-10-25", all: true })` gives `original` 700, `repaid` 700, `remaining` 0, settled. `register` on the obligation lists it only with `all`.

**One person's obligations**, with THB added:

```hueke
2026-10-09 * "Movie tickets"
    Expenses:Entertainment           100 NTD
    Assets:Receivable:movie-1009     100 NTD @NAT
    Assets:Cash                     -200 NTD

2026-10-11 * "Lunch"
    Expenses:Food                    600 NTD
    Assets:Receivable:lunch-1011     400 NTD @NAT
    Assets:Cash                    -1000 NTD

2026-10-12 * "NAT paid my massage in Bangkok"
    Expenses:Other                    800 THB
    Liabilities:Payable:massage-1012 -800 THB @NAT

2026-10-14 * "Borrowed from NAT"
    Bank:Checking                    5000 NTD
    Liabilities:Payable:loan-1014   -5000 NTD @NAT

2026-10-15 * "NAT pays for the movie and part of lunch"
    Bank:Checking                     350 NTD
    Assets:Receivable:movie-1009     -100 NTD @NAT
    Assets:Receivable:lunch-1011     -250 NTD @NAT

2026-10-30 * "Paid NAT back in part"
    Liabilities:Payable:loan-1014    2000 NTD @NAT
    Bank:Checking                   -2000 NTD
```

| Call | Result |
| --- | --- |
| `obligations(ledger, { entity: "NAT", at: "2026-10-31" })` | Three rows, in this order: `Assets:Receivable:lunch-1011` 400 / 250 / 150 NTD, `lastRepaid` 2026-10-15; `Liabilities:Payable:loan-1014` 5000 / 2000 / 3000 NTD, `lastRepaid` 2026-10-30; `Liabilities:Payable:massage-1012` 800 / 0 / 800 THB |
| The same with `all: true` | Also `Assets:Receivable:movie-1009` 100 / 100 / 0 NTD, settled, right after `lunch-1011` |
| `obligations(ledger, { at: "2026-10-31" })` | The same three rows: only NAT has obligations |
| `balance(ledger, query(ledger).accounts("Assets:Receivable").entities("NAT").until("2026-10-31"))` | `Assets` (subtotal) 150 NTD, `Assets:Receivable` (subtotal) 150 NTD, `Assets:Receivable:lunch-1011` 150 NTD; `movie-1009` is settled and left out |
| The same with `all` | Also `Assets:Receivable:movie-1009` 0 NTD |
| The same until 2026-10-12 | `Assets` (subtotal) 500 NTD, `Assets:Receivable` (subtotal) 500 NTD, `lunch-1011` 400 NTD, `movie-1009` 100 NTD |
| `balance(ledger, query(ledger).accounts("Assets:Receivable:movie-1009").until("2026-10-31"))` | No rows: the obligation is settled, even though the query names it; with `all`, `Assets:Receivable:movie-1009` 0 NTD |

**Combined income and expense**

```hueke
option income-expense on

account Expenses:Shared
    obligation payable

2026-10-11 * "NAT paid my share"
    Expenses:Shared:a    -100 NTD @NAT
    Assets:Cash           100 NTD

2026-10-15 * "Paid NAT back"
    Expenses:Shared:a     100 NTD
    Assets:Cash          -100 NTD
```

No diagnostics. `Expenses:Shared:a` is an obligation of type `expense`, settled on 2026-10-15.

| Call | Result |
| --- | --- |
| `balance(ledger, query(ledger).accounts("Expenses:Shared"))` | `IncomeExpenses` (subtotal) 0 NTD, `IncomeExpenses:Shared` (subtotal) 0 NTD; the obligation's row is left out |
| The same with `all` | Also `IncomeExpenses:Shared:a` 0 NTD |
| The same until 2026-10-14, without `all` | `IncomeExpenses:Shared:a` −100 NTD, under its subtotals: the obligation is still open |
| `obligations(ledger, { all: true })` | `Expenses:Shared:a`, `remaining` 0, settled |
| With `2026-10-16 * "Sold a ticket"`, `Assets:Cash 50 NTD` and `Income:Shared:a -50 NTD`, added: `balance(ledger)` | `IncomeExpenses:Shared:a` −50 NTD is listed: the row also counts `Income:Shared:a`, which is not an obligation |

**Mistakes**

```hueke
2026-10-11 * "Lunch"
    Expenses:Food                  600 NTD
    Assets:Receivable:lunch-1011   400 NTD
    Assets:Cash                  -1000 NTD

2026-10-12 * "Breakfast"
    Expenses:Food              80 NTD
    Assets:Receivable          80 NTD @NAT
    Assets:Cash              -160 NTD

2026-10-12 * "Late snack"
    Expenses:Food                        120 NTD
    Assets:Receivable:NAT:snack-1012     120 NTD @NAT
    Assets:Cash                         -240 NTD
```

`check` reports `obligation.missing-entity` on `lunch-1011`, whose only posting names no one, `obligation.root-posting` on the breakfast's `Assets:Receivable`, and `obligation.nested` on `Assets:Receivable:NAT:snack-1012`. Every transaction loads and counts in balances.
