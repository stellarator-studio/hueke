# Splits and rules

A **generator** adds postings computed from postings the user wrote. A **split** shares one posting among several people and records what each one owes; a **rule** computes an amount from each posting tagged with it, such as a tax withheld or a card fee, and adds it to the same transaction. Generated postings exist only in the derived model and are never written back; writing the same postings by hand stays valid. This document covers splits, `paid-by`, split tables, per-posting rules, posting templates, where generated postings go, and the tolerance for the fractions splits produce.

## Features

| Feature | Status |
| --- | --- |
| Splits | `specified` |
| Paid by someone else | `specified` |
| Split tables | `specified` |
| Per-posting rules | `specified` |
| Rule amounts: rate, fixed, caps, minimums, rounding | `specified` |
| Posting templates | `specified` |
| Generated postings | `specified` |
| Tolerance for split fractions | `specified` |

## Concepts

A split and a rule both read an **input** posting and add postings to the input's transaction. They never chain: a generated posting is never the input of another split or rule.

| Generator | Input | Generates | Tag on generated postings |
| --- | --- | --- | --- |
| Split | The posting it is written under | One posting per other person, on an obligation | `system:split` |
| Rule | Each posting tagged `#rule:<id>` | The rule's template postings | `system:rule` |

**Split** (a posting's `split`)

| Field | Meaning |
| --- | --- |
| `members` | The people sharing the posting, each with an entity, or `self` for the ledger's owner, and an amount or a ratio. Absent when `table` is given. |
| `table` | The anchor of a split table to share by. Absent when `members` is given. |
| `paidBy` | The entity who actually paid, if someone else did. |
| `account` | The obligation the generated postings go to, if written. |

**Split table** (a transaction's `splitTable`)

| Field | Meaning |
| --- | --- |
| `shares` | Each member's ratio: an entity, or `self`, and a ratio. |
| `into` | The obligation account that receivables go under, if written. |

**Rule** (one of the ledger's `rules`)

| Field | Meaning |
| --- | --- |
| `id` | Its anchor, written after `rule`. `#rule:<id>` names it. |
| `source`, `span`, `origin` | Where it was written and its Raw record. |
| `description` | The description, if any. It is only a note. |
| `capGroup` | The ID of the main rule whose caps this rule shares, if written. |
| `segments` | Its segments, in written order (see below). |
| `postings` | The posting template (see "Posting templates"). |

**Rule segment**: one part of a rule's life, with its own amounts.

| Field | Meaning |
| --- | --- |
| `active` | When the segment applies: `from`, `until`, or both (see [accounts.md](accounts.md), "Active periods", for how they are read). |
| `rate` | A ratio, as an exact value, such as `"1/100"` for `1%` or `"1/30"` for `1 MILE per 30 NTD`. Absent when `fixed` is given. |
| `output` | The commodity a rate produces, when it names one, as `MILE` in `1 MILE per 30 NTD`. |
| `input` | The commodity a rate takes, when it names one, as `NTD` in `1 MILE per 30 NTD`. |
| `fixed` | A fixed amount, and the window it is produced once per; without a window, once per input. Absent when `rate` is given. |
| `caps` | Upper limits on what is produced, each an amount and a window. |
| `minimums` | Thresholds on the input, each an amount and a window. |
| `rounding` | The window rounding applies over, and the mode: `half-up` (default), `half-even` or `down`. |

**Window**: the range over which a cap, a minimum, a fixed amount or rounding accumulates.

| Window | Covers |
| --- | --- |
| `posting` | Each input on its own |
| `day`, `week`, `month`, `quarter`, `year` | The calendar period of the input's effective time, in local dates; weeks follow `week-start` |
| An interval, such as `2026-10-01..2026-12-31` | That interval; inputs outside it are not limited by it |

A window is independent of segments: a monthly cap counts every input of the month, even across a change of segment.

## Behavior

### Splits

Status: `specified`

A split is written under a posting (see [../dsl/records.md](../dsl/records.md), "Splits"). It keeps the ledger owner's share on the posting and turns the others' shares into receivables.

- **Shares.** Members written with an amount take that amount. What remains is shared by ratio among the members written without one and the owner; a member written without amount or ratio has ratio 1, and the owner, `self`, has ratio 1 unless written. So `split @AMY @BOB` shares equally among three.
- Member amounts are in the posting's **settlement commodity**: its price's commodity when it has a price, otherwise its own.
- **Exact values.** Shares are computed exactly and kept as fractions when need be, such as 1000/3; they are never rounded, so they add up to the posting exactly (see [values.md](values.md), "Amounts").
- **Expansion.** The posting keeps the owner's share: its amount becomes the owner's share. For each other member, a posting with that member's share is generated on the obligation, with a reference to the member.
- **Prices.** When the posting has a price, the receivables are in the price's commodity, and the posting keeps its own commodity with its price reduced in proportion. `3000 JPY @@ 650 NTD` shared among three generates two receivables of 650/3 NTD, and the posting becomes `1000 JPY @@ 650/3 NTD`.
- **The obligation.** `account`, written after `->`, must be an obligation, a direct sub-account of an obligation account (see [obligations.md](obligations.md), "Obligation accounts"), and a receivable one; otherwise `split.not-obligation`. Without `account` and without a table, it is `split.missing-account`. With a table, see "Split tables".
- Member amounts adding up to more than the posting is `split.exceeds`. Ratios adding up to zero while an amount remains to share is `split.zero-ratio`.
- A split under a posting whose amount is omitted is `split.input-amount-omitted` (error), and the transaction is not loaded: the omitted amount is only known after expansion.
- A split with an error is not expanded; the posting counts as written. When its transaction then does not balance, that is `txn.unbalanced` besides.
- A posting takes at most one `split` or `paid-by` line.
- Splits are computed again at every load. Changing a split's amount or members changes every receivable it generated; Balances already written then report `balance.mismatch` where they no longer hold.

### Paid by someone else

Status: `specified`

`paid-by @<entity>` says that someone else paid. Nothing is generated as a receivable; instead, what the owner owes the payer is generated as a payable.

| Written | The posting keeps | Generated |
| --- | --- | --- |
| `paid-by @AMY -> <obligation>` alone | Its whole amount: all of it is the owner's | A payable of the whole amount to AMY |
| `split … paid-by @AMY` | The owner's share | A payable of the owner's share to AMY |

- The generated payable is the negated amount the posting keeps, on the obligation, with a reference to the payer. Other members' shares are between them and the payer, and are not in this ledger.
- The obligation must be a payable one; otherwise `split.not-obligation`. Without one, `split.missing-account`, unless a table gives it (see "Split tables").
- It also fits a bill received and not paid yet: `paid-by @power-company -> Liabilities:Payable:power-2026-10`.
- Before expansion, such a transaction may have the expense line only; it balances once the payable is generated.

### Split tables

Status: `specified`

A **split table** gives the shares of an event once, such as a trip, so each split names the table instead of its members. It is written on a transaction with no postings, which also describes the event and defines the table's anchor.

- `split <anchor>` shares by the table that transaction defines. The owner's ratio is 1 when the table does not list `self`; `share self 0` leaves the owner out. Ratios are zero or positive, and may have decimals.
- A table cannot be changed for one posting. When one posting is shared differently, it lists its members and names the same obligation: `split @AMY @BOB -> Assets:Receivable:tokyo-trip`.
- Without `->`, the obligation is `<obligation account>:<anchor>`, where the obligation account is:
  - without `paid-by`: the table's `into`; without it, the ledger's only `obligation receivable` account;
  - with `paid-by`: the ledger's only `obligation payable` account.
  When there is no such account, or several, the split is `split.missing-account`.
- One event may have both: what the owner paid for others is a receivable, and what others paid for the owner a payable. They are two obligations, such as `Assets:Receivable:tokyo-trip` and `Liabilities:Payable:tokyo-trip`, and do not offset each other.
- A table on a transaction with postings is `split.table-with-postings`; the table is ignored and the postings count.
- `split <anchor>` naming anything but a transaction with a table is `split.unknown-table`, and the split is not expanded.

### Per-posting rules

Status: `specified`

A rule is declared once (see [../dsl/records.md](../dsl/records.md), "Rules") and applies to every posting tagged `#rule:<id>`. Its postings are added to the input's own transaction.

- **Inputs** are tagged by hand; an account has no default rule, so whether a payment or a refund counts is decided per posting. A `rule` tag stands on a posting, of any account, income and expenses included; on a transaction header it is `tag.wrong-level` (see [anchors.md](anchors.md), "Scopes"). A posting may carry several rule tags, and each applies.
- The **input amount** is in the posting's settlement commodity: the price, signed as the posting, when it has one, otherwise its amount. A posting that also has a split counts with its amount as written, before the split.
- An input posting whose amount is omitted is `rule.input-amount-omitted` (error), and the transaction is not loaded.
- **Segments.** An input belongs to the segment whose `active` holds its effective time. An input outside every segment produces nothing. Two segments that overlap are `rule.segment-overlap`.
- **Inputs in order.** Inputs are taken in the order of their effective times, then source position, as transactions are ordered (see [transactions.md](transactions.md), "Order of transactions"). Caps and minimums over a window accumulate in this order, so recording an earlier input later changes what later inputs in the same window produce.
- `planned` and `cancelled` transactions are expanded too. Only `occurred` inputs accumulate toward caps and minimums; another input sees the `occurred` inputs before it, and never counts toward any other.
- A rule with an error (`rule.segment-overlap`, `rule.amount-missing`, `rule.cap-group-unknown`, `rule.cap-group-chain`, `template.unknown-slot`, `template.missing-slot`) produces nothing; its inputs count as written.

### Rule amounts: rate, fixed, caps, minimums, rounding

Status: `specified`

The amount a segment produces for one input is its **slot value**, `amount` in the template.

1. **Rate**: input amount × `rate`, signed as the input, so a refund produces the opposite. With `output`, the result is in that commodity, and the input must be in `input`; an input in another commodity is `rule.input-commodity` and produces nothing. Without them, the result is in the input's commodity.
2. **Fixed**: without a window, the fixed amount for every input, signed as the input. With a window, the fixed amount once per window that has inputs, produced by the window's first input.
3. **Minimums**: a window whose inputs, summed in the input's commodity, do not reach the minimum produces nothing. A minimum per `posting` checks each input on its own. Inputs of a window are known once the ledger is loaded, so a later input that reaches a minimum makes the earlier ones of its window produce too.
4. **Caps**: what is produced in a window never exceeds the cap; an input that would exceed it produces the rest up to the cap. Caps are compared on absolute values, so refunds count against the cap too.
5. **Shared caps**: a rule with `capGroup` counts toward the main rule's caps as well as its own. When one input meets several rules of a group and they exceed the cap, the rules are cut back from the last by rule ID. A main rule may not itself have `capGroup` (`rule.cap-group-chain`), and `capGroup` must name a rule (`rule.cap-group-unknown`).
6. **Rounding** to the precision of the produced commodity, declared or inferred, by `rounding`'s mode. Over a window other than `posting`, each input produces the rounded running total of the window minus the rounded running total before it, so the window's total is the running total rounded once.

- A segment with both `rate` and `fixed`, or neither, is `rule.amount-missing`.
- A window that spans two segments accumulates across them, using the values of the segment each input belongs to.

### Posting templates

Status: `specified`

A rule's postings are written as a **template**: posting lines whose amount may be a slot.

| Template line field | Meaning |
| --- | --- |
| `account` | The account. |
| `amount` | A constant amount, a slot (`amount`, or `-amount` for its negation), or omitted. |
| `price` | A price, only with a constant amount. |
| `refs`, `tags`, `meta` | Given to the generated posting. |

- A rule's only slot is `amount`. Any other slot, such as `interest` or `fee`, is `template.unknown-slot`; a template that never uses `amount` is `template.missing-slot`.
- One line at most omits its amount; it takes the negated sum of the template's other lines, as in [transactions.md](transactions.md), "Filling in an omitted amount".
- A rule's template lines need not balance. They join the input's transaction, which must balance after expansion. A common form generates only the computed line and leaves the transaction's own counter-line without an amount, so it is filled in after expansion.
- A `rule` tag on a template line is `tag.wrong-level`, since generated postings never chain.

### Generated postings

Status: `specified`

- Generated postings are added to the input's transaction after its written postings: first those of each split, in the order of the postings they are written under; then those of rules, in the order of their inputs, and for one input by rule ID. Their IDs continue the transaction's numbering (see [ledger.md](ledger.md), "IDs").
- They carry `system:split` or `system:rule`, plus the transaction's tags; they have no `span` or `origin`, and their status is `none`.
- **Time.** A generated posting takes its input's own effective time when the input has one; otherwise none, so it inherits the transaction's. On an income or expense account it never has one (see [time.md](time.md), "Time axes"). To book a computed amount on another day, let the rule generate only the income or expense line, and write the counter-line with `[date]` and no amount.
- Their amounts are not checked against precision (`posting.excess-precision` concerns written amounts only), but they are checked against the account's `allow`, `deny` and `active` (see [accounts.md](accounts.md)).
- An omitted amount is filled in after expansion, so it accounts for generated postings (see [transactions.md](transactions.md), "Filling in an omitted amount"), and balancing is checked after expansion (see [ledger.md](ledger.md), "Normalization").

### Tolerance for split fractions

Status: `specified`

A split, or a group ledger's conversion (see [group-ledgers.md](group-ledgers.md)), may leave fractions on an account, such as 1000/3 NTD.

- A Balance whose asserted postings, up to its point, include an amount with no finite decimal form that a split or a conversion generated passes when it is within one unit of the commodity's precision, 10^−p, instead of half a unit (see [balance.md](balance.md), "Balance assertions").
- The same holds for a pad with written padding: recorded balance + padding may differ from `amount` by one unit. The generated transaction pads the actual difference, so the balance after it is exactly `amount`.

## Examples

These cases add to the shared declarations:

```hueke
account Assets:Receivable
    obligation receivable
account Liabilities:Payable
    obligation payable
```

**Splits**

```hueke
2026-10-13 * "Dinner"
    Expenses:Food   1200 NTD
        split @AMY @BOB -> Assets:Receivable:dinner-1013
    Assets:Cash    -1200 NTD
```

| Split written | Result after expansion |
| --- | --- |
| `split @AMY @BOB -> …` | `Expenses:Food` 400 NTD; `Assets:Receivable:dinner-1013` 400 NTD `@AMY` and 400 NTD `@BOB`, tagged `system:split` |
| `split @AMY 500 @BOB 300 -> …` | `Expenses:Food` 400 NTD; AMY 500 NTD, BOB 300 NTD |
| `split @AMY *2 @BOB -> …` | `Expenses:Food` 300 NTD; AMY 600 NTD, BOB 300 NTD |
| `split @AMY 500 @BOB -> …` | `Expenses:Food` 350 NTD; AMY 500 NTD, BOB 350 NTD |
| `split self *2 @AMY -> …` | `Expenses:Food` 800 NTD; AMY 400 NTD |
| `split @AMY @BOB` (no `->`) | `split.missing-account`; `Expenses:Food` 1200 NTD as written |
| `split @AMY 1000 @BOB 300 -> …` | `split.exceeds`; nothing generated |
| `split @AMY @BOB -> Assets:Cash` | `split.not-obligation` |
| The same, with `Expenses:Food 1000 NTD` | `Expenses:Food` 1000/3 NTD; AMY and BOB 1000/3 NTD each |

The generated postings are `~1.3` and `~1.4`. `obligations(ledger, { at: "2026-10-31" })` lists `Assets:Receivable:dinner-1013`, original 800 NTD, entities AMY and BOB.

**A price**

```hueke
2026-10-14 * "Ramen in Tokyo"
    Expenses:Food   3000 JPY @@ 650 NTD
        split @AMY @BOB -> Assets:Receivable:ramen
    Assets:Cash     -650 NTD
```

`Expenses:Food` becomes `1000 JPY @@ 650/3 NTD`; AMY and BOB owe 650/3 NTD each. The transaction balances in NTD.

**Paid by someone else**

```hueke
2026-10-12 * "Lunch, AMY paid"
    Expenses:Food   180 NTD
        paid-by @AMY -> Liabilities:Payable:lunch-1012

2026-10-15 * "Taxi, AMY paid"
    Expenses:Transport   600 NTD
        split @BOB paid-by @AMY -> Liabilities:Payable:taxi-1015
```

The lunch generates `Liabilities:Payable:lunch-1012` −180 NTD `@AMY`. The taxi keeps 300 NTD on `Expenses:Transport` and generates `Liabilities:Payable:taxi-1015` −300 NTD `@AMY`; BOB's share is not in this ledger.

**A split table**

```hueke
2026-10-18 %tokyo-trip "Tokyo trip"
    ;; budget: 60000 NTD
    share self 1
    share @AMY 1
    share @BOB 2
    into Assets:Receivable

2026-10-19 * "Dinner, I paid"
    Expenses:Food   3200 NTD
        split tokyo-trip
    Assets:Cash    -3200 NTD

2026-10-20 * "Hotel, AMY paid"
    Expenses:Lodging   9000 NTD
        split tokyo-trip paid-by @AMY
```

| Result | Value |
| --- | --- |
| Dinner | `Expenses:Food` 800 NTD; `Assets:Receivable:tokyo-trip` 800 NTD `@AMY` and 1600 NTD `@BOB` |
| Hotel | `Expenses:Lodging` 2250 NTD; `Liabilities:Payable:tokyo-trip` −2250 NTD `@AMY` |
| Without `into`, and a second account with `obligation receivable` | The dinner's split is `split.missing-account` |
| `split tokyo-trip` with `%tokyo-trip` on a transaction that has postings | `split.table-with-postings` on that transaction; the dinner's split is `split.unknown-table` |

**Per-posting rules**

```hueke
rule %withhold-5 "Income tax withheld"
    active 2026-01-01..
    rate 5%
    Expenses:Tax  -amount

rule %fx-fee "Foreign card fee"
    active 2026-01-01..
    rate 1.5%
    Expenses:Fees  amount

2026-10-05 * "October salary" @acme
    Income:Salary   -55000 NTD #rule:withhold-5
    Bank:Checking

2026-10-21 * "Ramen, paid by card abroad"
    Expenses:Food   1200 JPY @@ 260 NTD #rule:fx-fee
    Liabilities:Card  [2026-10-23]
```

| Result | Value |
| --- | --- |
| Salary | `Expenses:Tax` 2750 NTD, tagged `system:rule`; `Bank:Checking` filled in as 52250 NTD |
| Ramen | `Expenses:Fees` 4 NTD (260 × 1.5% = 3.9, rounded half up); `Liabilities:Card` filled in as −264 NTD, on 2026-10-23 |
| `#rule:fx-fee` moved to the `Liabilities:Card` line | `rule.input-amount-omitted`; the transaction is not loaded |
| `#rule:fx-fee` on the header | `tag.wrong-level`; the tag is skipped, nothing generated |
| `#rule:no-such-rule` on a posting | `tag.wrong-target`; the tag is skipped |

**Rates, caps and rounding**

```hueke
rule %miles "Miles"
    active 2026-01-01..
    rate 1 MILE per 30 NTD
    rounding per posting down
    Assets:Miles   -amount
    Income:Miles    amount

rule %cashback "Card cashback"
    active 2026-01-01..2026-06-30
    rate 1%
    cap 100 NTD per month
    active 2026-07-01..
    rate 0.5%
    cap 100 NTD per month
    Income:Cashback   amount
    Assets:CashbackDue

2026-10-21 * "Supermarket"
    Expenses:Groceries   800 NTD
    Liabilities:Card    -800 NTD #rule:miles
```

- The miles rule turns −800 NTD into −800/30 MILE, rounded down to −26: `Income:Miles` −26 MILE, `Assets:Miles` 26 MILE.
- With `#rule:cashback` on card postings of −15000 NTD on 2026-10-03 and −8000 NTD on 2026-10-20, the first produces −75 NTD and the second −25 NTD, reaching the cap of 100 NTD for October.
- A rule whose two segments both cover 2026-07 is `rule.segment-overlap`; a template line `Expenses:Fees  fee` is `template.unknown-slot`; a template with only constant amounts is `template.missing-slot`.

**Tolerance**

With two dinners of 100 NTD each, both `split @AMY @BOB -> Assets:Receivable:dinner-1013`, the obligation holds 400/3 NTD. `2026-10-31 balance Assets:Receivable:dinner-1013 134 NTD` passes: it differs by 2/3, more than half a unit but within one. `135 NTD` is `balance.mismatch`.
