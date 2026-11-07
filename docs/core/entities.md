# Entities and references

An **entity** is someone a ledger deals with: a person, a shop, a company. Records point at entities through **references**, and a reference's **role** says what the entity is in that record. This document covers entities and their declarations, references and roles, display names, and strict mode for entities.

## Features

| Feature | Status |
| --- | --- |
| Entities | `implemented` |
| Entity declarations | `implemented` |
| References and roles | `implemented` |
| Display names | `implemented` |

## Concepts

**Entity**

| Field | Meaning |
| --- | --- |
| `id` | Its stable ID, the name written in references, such as `NAT`. Two different people with the same name need two IDs. |
| `span` | Where it is declared; absent for an entity used without a declaration. |
| `displayName` | The name to show in reports, if declared. |
| `meta` | Metadata written under the declaration. |

**Reference**

| Field | Meaning |
| --- | --- |
| `role` | What the entity is in this record; `person` unless written. |
| `entity` | The entity's ID. |

- An entity has no roles of its own; a role exists only on a reference.
- References point only at entities. Links between records, such as a refund and its original, are tags (see [anchors.md](anchors.md)).

## Behavior

### Entities

Status: `implemented`

- Unless strict mode covers entities, any entity can be referenced without a declaration. Its ID is the name referenced, and it has no `displayName`.
- In strict mode for entities (see [ledger.md](ledger.md), "Declarations and strict mode"), referencing an undeclared entity is `strict.undeclared`; the ledger is computed as in normal mode.
- The ledger's `entities` lists the declared entities first, in declaration order, then those used without a declaration, in the order of their first use in the source.
- Entities never change balances. They take part in filtering and grouping (see [query.md](query.md)), in Balance assertions (see [balance.md](balance.md), "Entities in Balance assertions") and in obligations (see [obligations.md](obligations.md)).

### Entity declarations

Status: `implemented`

- An entity is declared with `entity <id>`, followed by optional `display-name <text>` and metadata lines (see [../dsl/records.md](../dsl/records.md), "Declarations").
- `display-name` sets `displayName`.
- `type` under an entity is reserved (see [diagnostics.md](diagnostics.md), "Unsupported syntax").
- Duplicate declarations, and declarations in included modules, follow the rules for every declaration (see [ledger.md](ledger.md), "Duplicate declarations", and [modules.md](modules.md), "Declarations in included modules").

### References and roles

Status: `implemented`

- Transactions and postings carry any number of references. A posting's own references are in its `refs`; queries fall back to its transaction's when it has none (see [query.md](query.md), "Matched postings").
- Roles are defined by Core; a ledger cannot declare any. There is one role:

| Role | Written on | Meaning |
| --- | --- | --- |
| `person` (default) | Transaction, posting | The entity the record deals with |

- A reference with any other role, such as `@payee:xx_breakfast`, is `name.unknown-role` (error). The reference is skipped: it is not in the derived record's references, but the Raw record keeps it, as written. The record loads.

### Display names

Status: `implemented`

- Accounts (see [accounts.md](accounts.md), "Account declarations") and entities may have a display name, written `display-name`, so it is not mistaken for the ID.
- A display name is only for showing. It never identifies anything: records, queries and the API always use the ID. It may contain spaces.
- The CLI shows display names instead of IDs with `--name` (see [../cli.md](../cli.md)).
- Renaming an account or merging two entities has no mechanism of its own: change the text.

## Examples

```hueke
entity KEN
    display-name Ken Chen

2026-10-05 * "October salary" @acme
    Bank:Checking              52000 NTD
    Expenses:HealthInsurance    1500 NTD
    Expenses:IncomeTax          1500 NTD
    Income:Salary             -55000 NTD
```

No diagnostics. The ledger's `entities` lists `KEN` (`displayName` "Ken Chen"), then `acme` (no `displayName`). Iterating `query(ledger).entities("acme")` gives the salary; `query(ledger).entities("acme").postings()` gives all four postings, which have no references of their own.

| Ledger text | `check` |
| --- | --- |
| The salary above with `option strict entity` | `strict.undeclared` for `acme` |
| `2026-10-13 * "Dinner" @payee:xx_breakfast` with postings | `name.unknown-role`; the transaction loads with no references |
| `entity KEN` twice | `declaration.duplicate` on the second |
