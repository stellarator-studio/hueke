# Hueke documentation

Hueke is a double-entry bookkeeping command line for plain-text ledgers. Its package provides two things: the `hueke` command, which reads ledger files and prints results, and the library the command is built on, for platforms that handle ledgers themselves, such as an editor plugin or a web page.

These documents call the library Core. Core reads ledger text, normalizes it into a model of accounts, commodities, transactions and assertions, checks it, and answers queries. It does no I/O of its own.

These documents are the specification. They are written and settled first; the code is built from them. Where the documents and the code disagree, the documents are right: a feature marked `implemented` that behaves otherwise has a bug.

## Status

Every feature carries one status.

| Status | Meaning |
| --- | --- |
| `implemented` | Settled, and the code behaves as written. |
| `specified` | Settled, but not implemented yet, or the code does not match yet. |
| `draft` | Still under discussion. Do not build on it. |

- Each topic document starts with a table of its features and their status.
- Each feature section has a `Status:` line under its heading. It covers the whole section.
- When one rule in a section has a different status from the section, the rule ends with that status in brackets, such as `[specified]`.

## Documents

| Document | Covers |
| --- | --- |
| [architecture.md](architecture.md) | What the package provides, modules, dependency direction, source layout, which document drives which code and tests, rules for the public API |
| [core/values.md](core/values.md) | Amounts, numbers as written, arithmetic in amounts and on values, prices and costs |
| [core/commodities.md](core/commodities.md) | Commodities, aliases, declared and inferred precision, item mode |
| [core/time.md](core/time.md) | Time values, time zones, weeks, the two time axes, comparing times, time predicates |
| [core/accounts.md](core/accounts.md) | Accounts, the account hierarchy, account roots, account anchors and display names, obligation and pad settings, combined income and expense, untyped accounts |
| [core/anchors.md](core/anchors.md) | Anchors, tags and scopes, primary tags, groups, refunds, looking records up by ID |
| [core/entities.md](core/entities.md) | Entities, references and roles, display names |
| [core/transactions.md](core/transactions.md) | Transactions, postings, breakdowns, balancing, omitted amounts, status and occurrence |
| [core/balance.md](core/balance.md) | Balance assertions, `pad`, entities and obligations in Balances, the reconciliation view |
| [core/obligations.md](core/obligations.md) | Obligation accounts, lending and repayment, the entities of an obligation, progress, settling, `obligations` |
| [core/query.md](core/query.md) | Filtering, ordering, grouping and period labels, aggregation, listing breakdown lines; the account tree, `balance` and `register` |
| [core/ledger.md](core/ledger.md) | The two models, loading, declarations and strict mode, normalization, IDs, source positions, text patches |
| [core/modules.md](core/modules.md) | Modules, `include`, module order, logical paths and how written paths resolve |
| [core/settings.md](core/settings.md) | Every ledger setting, its values and default, wrong or repeated settings, changing a setting |
| [core/diagnostics.md](core/diagnostics.md) | Every diagnostic code, its severity and what happens to the faulty record |
| [dsl/README.md](dsl/README.md) | The ledger file format: overview, symbols, what each piece of syntax becomes |
| [dsl/lexical.md](dsl/lexical.md) | Lines, ownership, whitespace, comments and metadata, identifiers, strings, error recovery |
| [dsl/records.md](dsl/records.md) | How each record is written: time values, amounts, transactions, balances, declarations |
| [dsl/formatting.md](dsl/formatting.md) | The canonical form, serialization and formatting |
| [cli.md](cli.md) | The `hueke` command line: commands, options, output, exit status |

## Reading order

1. [architecture.md](architecture.md): what the package provides, the parts of Core and how data flows through them.
2. [dsl/README.md](dsl/README.md): what a ledger file looks like.
3. [core/values.md](core/values.md), [core/commodities.md](core/commodities.md), [core/time.md](core/time.md), [core/accounts.md](core/accounts.md): amounts, commodities, time and accounts, which every record is built from.
4. [core/transactions.md](core/transactions.md), [core/balance.md](core/balance.md): the records, transactions and Balance assertions.
5. [core/anchors.md](core/anchors.md), [core/entities.md](core/entities.md), [core/obligations.md](core/obligations.md): how records name each other and the people they deal with, and what is owed.
6. [core/query.md](core/query.md): getting results out of a ledger.
7. [core/ledger.md](core/ledger.md), [core/modules.md](core/modules.md), [core/settings.md](core/settings.md): how a ledger is loaded from its files and configured.
8. [core/diagnostics.md](core/diagnostics.md): every diagnostic code, for reference.
9. [dsl/lexical.md](dsl/lexical.md), [dsl/records.md](dsl/records.md), [dsl/formatting.md](dsl/formatting.md): the exact syntax and the canonical form, before working on the parser or on formatting.
10. [cli.md](cli.md): the `hueke` command line.

## Conventions

- Field names are those of the API, such as `primaryCommodity`. How a field is written in a ledger file is described under [dsl/](dsl/README.md).
- Amounts and decimal numbers are exact. In the API they are decimal strings, never floating-point numbers.
- In API descriptions and examples, the initialized ledger, the `Hueke` object, is called `ledger`: `query(ledger)`, `balance(ledger, …)`.
- Ledger text in examples is DSL. The examples assume the declarations in "Shared declarations" below.
- Sorting text always compares Unicode code points, never locale rules, so results are the same everywhere.

## Writing a topic document

Every document except [architecture.md](architecture.md) is a topic document. architecture.md describes Core as a whole; it carries no statuses and does not follow the structure below.

A topic document describes concepts and behavior in prose. It contains no TypeScript: no type definitions, no function signatures. Ledger text and `hueke` commands are used as examples. Diagrams are drawn in Mermaid.

Every topic document starts, right under its title, with a short summary: what the topic is about, its key terms, and what the document covers. The summary carries the overview; Concepts then defines the terms one by one.

| Section | Contents | Drives |
| --- | --- | --- |
| (Summary) | A paragraph under the title, without a heading | — |
| Features | The feature table with each status | — |
| Concepts | The things the topic is about, their fields as a table (field — meaning), and how they relate | The data core's model |
| Behavior | One subsection per feature: the rules, each failing rule naming its diagnostic code | The ledger engine and the parser |
| API | Each function in words: what it takes, what it returns, when it throws | The public API |
| Examples | Ledger text, the call or command, and the expected result | Acceptance tests |

- A section that does not apply is left out.
- State results exactly: a value, an order, a diagnostic code. Avoid "handled appropriately".
- Each fact is written in one place; other documents link to it.
- Development notes, discussion, rejected designs and milestone names do not belong here.

## Shared declarations

The examples, and the acceptance tests built from them, load these declarations before each case, in the same root module. They use only supported syntax, so a case never fails on its preamble.

- When a case declares a commodity, an account or an account root that these declarations also declare, the case's declaration replaces the shared one; it is not a duplicate. Settings are not replaced: a case that writes `option timezone` writes a second `timezone`.
- Examples with several modules (in [core/modules.md](core/modules.md)) do not load these declarations.

```hueke
option timezone Asia/Taipei

account-root Bank asset

commodity NTD
    precision 0
commodity JPY
    precision 0
commodity USD
    precision 2
commodity AAPL
    precision 0
commodity camera-01
    item

account Assets:Cash
    primary NTD
account Liabilities:CardInstallments
    primary NTD
```

## Changing behavior

1. Change the document first, and settle it. New or changed rules start as `specified`.
2. Then change the code and the tests to match, and set the status to `implemented`.
3. When implementation finds a gap in a document, fill the gap in the document before writing the code.
4. Only [architecture.md](architecture.md) names paths under `srcs/` and `tests/`. Moving code changes that file alone.
