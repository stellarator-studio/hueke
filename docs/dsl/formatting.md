# Formatting and serialization

Core writes ledger text in one **canonical form**. Serialization writes one record in that form; formatting rewrites a whole module. This document defines the canonical form and what serialization guarantees.

## Features

| Feature | Status |
| --- | --- |
| Canonical form | `implemented` |
| Comments and metadata in place | `implemented` |
| Serialization | `implemented` |
| Formatting a module | `draft` |

## Concepts

The **canonical form** is the one way Core writes ledger text. **Serialization** writes one Raw record in canonical form. **Formatting** would rewrite a whole module in canonical form for the platform to apply; Core never writes files.

## Behavior

### Canonical form

Status: `implemented`

| Item | Canonical form |
| --- | --- |
| Indentation | 4 spaces for a record's child lines (postings, properties, a record's metadata); 8 spaces for a posting's child lines (breakdowns, a posting's metadata) |
| Postings | A lead (optional `* `, then the account), then the amount. Among a transaction's postings that have an amount, the numbers end in one column: the leftmost column at which every such line has at least two spaces between its lead and its number, so the tightest line has exactly two. The rest of the line follows with single spaces. A posting without an amount does not count toward the column |
| Other separators | One space between tokens, also in properties such as `alias NT$ prefix` |
| Token order | As in [records.md](records.md) |
| Properties | Under a declaration, in a fixed order: `commodity`: `item`, `precision`, `alias`; `account`: `display-name`, `obligation`, `pad-account`, `primary`; `entity`: `display-name`. A property that may repeat (`alias`) keeps its written order. Metadata comes after the properties, in written order |
| References | `@NAT`, never `@person:NAT`; another role is kept: `@payer:KEN`. On a Balance, the entity follows the account: `balance Bank:Checking @acme 52000 NTD` |
| Tags | `#travel`, `^trip`, never `#tag:travel`, `^tag:trip`; another scope is kept: `#refund:t_book`. A tag with a reserved scope, a module or a period is unsupported syntax and has no canonical form (see below) |
| Numbers | The ledger's decimal mark; the ledger's group mark between every three digits before the decimal mark (none with `group-mark none`); the decimal places as written. An expression is kept exactly as written |
| Commodities | Always the code: `180 NTD`, never an alias |
| Omitted amounts | Stay omitted |
| Times | As written |
| Breakdowns | `- <name>  <figures>`, two spaces after the name; one space between the quantity and its unit and around `*` and `=`; `*` for `×`: `- Bubble tea  3 cups * 40 NTD = 120 NTD`. A name is quoted only when it must be (see [records.md](records.md), "Breakdowns") |
| Strings | Double quotes; `"` and `\` inside are escaped |
| Values | Unquoted, unless they start with `"`, contain `;`, or have leading or trailing whitespace; a quoted value escapes `"` and `\`. An `include` path is also quoted when it contains whitespace or any of `;` `"` `(` `)` `[` `]` `{` `}` |
| Metadata and comments | `;; key: value` and `; text`; at the end of a line, preceded by two spaces. A metadata value with line breaks is written on its own line: the first line after the key (`""` when it is empty), each further line on a continuation line `;;` and four spaces, plus the line's own indentation (see [lexical.md](lexical.md), "Comments and metadata"). A line is quoted when it is empty, starts with `"`, contains `;`, ends with whitespace, or has whitespace other than spaces right after its indentation; when every further line is indented, the least indented one is quoted with its spaces, so the indentation reads back the same |
| Blocks | One serialized record ends with one line break |
| Blocks in a module | One blank line between blocks, and the file ends with one line break [draft] |

### Comments and metadata in place

Status: `implemented`

- Comments and metadata stay where they were written: one at the end of a line stays at the end of that line; one on its own line stays between the same lines, indented as the record it belongs to.
- When properties are put in order, a comment at the end of a property line moves with that line, and a comment on its own line moves with the line above it, as it belongs to that line (see [lexical.md](lexical.md), "Comments and metadata"). Comments on their own lines before the first property stay first. Metadata on its own line moves after the properties.
- Comments before the first block stay at the top of the file, followed by one blank line. [draft]

### Serialization

Status: `implemented`

- Serialization needs the ledger's settings (decimal and group marks) and its commodities (to turn aliases back into codes). They take effect only from the root module (see [../core/modules.md](../core/modules.md), "Declarations in included modules"), which may not be the module being serialized, so serialization takes them from the initialized ledger, as resolved there, and does not read the directives itself.
- A record holding syntax reported as `syntax.unsupported` has no canonical form; serializing it throws.
- **Fixed point.** Serializing a record, parsing the result and serializing again gives the same text.
- **Same meaning.** Parsing the serialized text and loading it gives the same derived model as the original, apart from source positions.
- **Same places.** Comments and metadata stand where "Comments and metadata in place" puts them.

### Formatting a module

Status: `draft`

- Formatting rewrites every block of one module of the ledger in canonical form and returns the changes as text patches, each replacing a range of the module's text, for the platform to apply.
- Blocks already in canonical form produce no change.
- A block that could not be parsed, that holds syntax reported as `syntax.unsupported`, or whose amounts or times cannot be read with the ledger's settings and commodities, is left exactly as written.
- Text patches, and how the platform detects that a file changed since it was parsed, are described in [../core/ledger.md](../core/ledger.md), "Text patches".

## API

- `serialize(ledger, record)` returns the canonical text of one Raw record, with its child lines and comments, ending with a line break. Only the ledger's `settings` and `commodities` are used. It throws when an amount, price, cost or time of the record cannot be read; when a breakdown line has no name; when the record holds unsupported syntax; or when metadata at the end of a line has a line break. A breakdown figure that cannot be read is written as written, trimmed.
- `format(ledger, path)` [draft] would return the changes that put the module at `path` in canonical form.

## Examples

With the shared declarations and `commodity NTD` having `alias NT$ prefix`, serializing the record

```hueke
2026-10-12   *   "Breakfast"    @person:xx_breakfast  #tag:food
  Expenses:Food 1200 NTD   ;; receipt: 42
      -   Bubble tea  3cups*40
  Assets:Cash   -NT$1200
```

gives:

```hueke
2026-10-12 * "Breakfast" @xx_breakfast #food
    Expenses:Food  1,200 NTD  ;; receipt: 42
        - Bubble tea  3 cups * 40
    Assets:Cash   -1,200 NTD
```

The breakdown's unit price stays `40`: a breakdown never takes a commodity that was not written. Serializing

```hueke
commodity NTD
    alias NT$ prefix
    ; spoken as "kuai"
    ;; title: "\"New Taiwan dollar\""
    precision 0
```

gives:

```hueke
commodity NTD
    precision 0
    alias NT$ prefix
    ; spoken as "kuai"
    ;; title: "\"New Taiwan dollar\""
```

The comment moves with the `alias` line above it. The metadata value is `"New Taiwan dollar"`, quotes included, so it is written quoted and escaped.
