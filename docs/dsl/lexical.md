# Lexical structure

The parser reads a file line by line, classifies each line by its first token, and attaches it to the record it belongs to; indentation plays no part, except in continuing multi-line metadata. This document covers line classes, ownership, whitespace, comments and metadata, identifiers, strings, how symbols are told apart, and error recovery.

## Features

| Feature | Status |
| --- | --- |
| Line classes | `implemented` |
| Ownership | `implemented` |
| Whitespace | `implemented` |
| Comments and metadata | `implemented` |
| Identifiers | `implemented` |
| Strings and values | `implemented` |
| Symbol disambiguation | `implemented` |
| Error recovery | `implemented` |

## Concepts

**Top-level lines** (record headers and declarations) open a **block**; every other line belongs to a record in the current block. A block is also the unit of error recovery: a fault drops the block, and parsing goes on with the next top-level line.

## Behavior

### Line classes

Status: `implemented`

Each line has its leading whitespace removed and is split at the first `;` outside quotes into **content** and **trailer**. The trailer is metadata or a comment (see "Comments and metadata"). The content is classified by the first matching row:

| Order | Class | Recognized by | Example |
| --- | --- | --- | --- |
| 1 | Blank line, whole-line metadata, whole-line comment | Empty content | `;; invoice_number: AB-12345678`, `; note` |
| 2 | Date line | First character is a digit, or `(` closed on the same line; either may follow a `-`. A date line not starting with a digit, such as `-5 NTD` or `(5) NTD`, is `parse.syntax`, and its block is not loaded | `2026-10-12 * "Lunch"`, `2026-10-25 balance …` |
| 3 | Declaration | First token is a declaration keyword | `commodity NTD`, `account Assets:Cash` |
| 4 | Breakdown | `-` followed by whitespace, the end of the line, or one of `"` `;` `[` `]` `{` `}` `%` `#` `^` `@` `*` `×` `!` `-` | `- Toast  = 65`, `-"Toast"  = 65` |
| 5 | Marked posting | `*`, with or without whitespace after it | `* Expenses:Other 500 NTD` |
| 6 | Property | First token is a property keyword, followed by whitespace or the end of the line | `precision 2`, `item` |
| 7 | Posting | Anything else | `Expenses:Food  180 NTD` |

- A date line whose time is followed by `balance` is a Balance assertion; any other date line is a transaction header.
- Keywords:

| Kind | Keywords |
| --- | --- |
| Declarations | `option`, `account-root`, `commodity`, `account`, `entity`, `include`; reserved: `schedule`, `installment`, `rule`, `module` |
| In date lines | `balance`, `pad` |
| Properties | `item`, `precision`, `alias`, `primary`, `display-name`, `obligation`, `pad-account`; reserved: `type`, `active`, `allow`, `deny`, `statement`, `source`, `self`, `map`, `from`, `every`, `count`, `until`, `follows`, `skip`, `due`, `override`, `principal`, `method`, `rate`, `periodic-rate`, `first-period`, `rounding`, `absorb`, `fee`, `split`, `paid-by`, `share`, `into`, `cap`, `minimum`, `cap-group`, `fixed` |

- An account root cannot be a keyword; otherwise a one-segment account would read as a declaration or property.
- A commodity code or alias cannot be a keyword either, reserved ones included, so that keywords stay free for features to come: `commodity fixed`, `alias fee suffix` and the amounts `5 fixed` and `(100 + 50)fixed`, in a posting, a price, a cost or a Balance, are `parse.syntax`, and the block is not loaded. A breakdown line's figures are not checked, since a commodity written there is not a use of it (see [../core/transactions.md](../core/transactions.md), "Breakdowns").

### Ownership

Status: `implemented`

Date lines and declarations are top-level: each opens a block and ends the previous one. Other lines belong to the nearest record in the current block that accepts them. Blank lines do not affect ownership.

| Current record | Accepts |
| --- | --- |
| Transaction header | Metadata, postings; reserved: `share`, `into` |
| Posting | Metadata, breakdown lines; reserved: `split`, `paid-by`. Until the next posting |
| `balance` | Metadata |
| `commodity` | `item`, `precision`, `alias`, metadata |
| `account` | `display-name`, `obligation`, `pad-account`, `primary`, metadata; reserved: `active`, `allow`, `deny`, `statement`, `source`, `self`, `map` |
| `entity` | `display-name`, metadata; reserved: `type` |
| `option`, `account-root`, `include` | Nothing |

- A transaction's whole-line metadata must stand before its first posting, or at the end of the header line; after a posting, it belongs to that posting.
- Metadata after a breakdown line, at its end or on its own line after it, still belongs to the posting, but is `parse.metadata-after-breakdown` (warning): a posting's metadata should stand before its breakdown lines.
- Reserved lines are read into the Raw model and then reported as `syntax.unsupported` (see [../core/diagnostics.md](../core/diagnostics.md), "Unsupported syntax").
- A line with no record to belong to is `parse.orphan-line`. A line before the first block, or metadata in a block that accepts none, is skipped. A breakdown line before its block's first posting drops the block.
- A property the record does not accept is `parse.unexpected-property`, and so is a posting line under a Balance or under `option`, `account-root`, `include`, `commodity` or `account`. A property after the first posting is also `parse.unexpected-property`. The block is not loaded.
- A property written twice in one record is `parse.duplicate-property`, unless it may repeat: `alias` and metadata; among reserved properties, `map` on an account, `share` on a transaction or a module, `from`, `every` and `override` on a schedule or an installment, and `active`, `cap` and `minimum` on a rule. On a rule, each `active` starts a new segment, and `rate`, `fixed` and `rounding` are once per segment.

### Whitespace

Status: `implemented`

| Rule | Meaning |
| --- | --- |
| Separator | Tokens are separated by one or more spaces or tabs |
| Account names | Contain no whitespace, so one space after an account is enough |
| Breakdown name | May contain single spaces, so the name and what follows are separated by at least two spaces or one tab |
| Parentheses | Inside a token, a `(` closed by its `)` on the same line keeps everything between them in the token, whitespace included: `(100 + 50) NTD` is a number and a code. The group may not contain `;`, `"`, `[`, `]`, `{` or `}`. An unclosed `(` is an ordinary character |
| Indentation | Ignored |
| Trailing whitespace | Ignored |
| Line breaks | `\n` or `\r\n`; a record never spans lines |

### Comments and metadata

Status: `implemented`

What follows the first `;` outside quotes:

| Written | Is |
| --- | --- |
| `;;` then `<key>:`, the colon followed by whitespace or the end of the line | Metadata; whitespace may stand between `;;` and the key |
| `;;` then anything else | `parse.syntax`; the block is not loaded. `;; TODO` and `;; see https://…` both count. A continuation line of multi-line metadata is the exception (see below) |
| A single `;` | A comment |

- A single `;` is always a comment, so `; rule: no colon` is still a comment.
- The value is everything after the key up to the end of the line, trimmed. A value containing `;` must be quoted; an unquoted `;` in a value is `parse.syntax`. So a line holds at most one metadata entry, and no comment can follow it.
- When one record has the same metadata key twice, including two `document` keys, the later value wins. This holds for every record and declaration that takes metadata.

**Multi-line metadata**

Metadata on its own line may continue on the lines right after it:

```text
2026-10-12 * "Lunch"
    ;; memo: First line
    ;;    second line
    ;;      third line, two spaces deeper
    ;; summary: Next entry
    Expenses:Food  180 NTD
    Assets:Cash
```

- A **continuation line** is a `;;` line right after a valid metadata line on its own line, or right after another continuation line, whose text starts further right than that metadata's key. It continues the value even when its text looks like `key:`, so a deeper-indented `;; key: value` right under another entry joins that entry's value. Columns count characters from the start of the line; a tab counts as one.
- The value is the key line's value, then each continuation line, joined with line breaks. The smallest indentation among the continuation lines is removed; deeper indentation is kept. Trailing whitespace is removed. The memo above has the value `First line`, `second line` and `  third line, two spaces deeper` on three lines.
- When the key line has no value (`;; memo:`), the value starts on the next line.
- Each continuation line is read like a one-line value: a line that contains `;` or must keep trailing spaces is quoted, and its indentation is that of its opening quote. A line written `""` is an empty line in the value.
- A blank line, a comment, a `;;` line with nothing after it, or any other line ends the value. A `;;` line with nothing after it is then `parse.syntax`, as it always is.
- Metadata at the end of a line cannot continue: a `;;` line after it is read on its own.

**Ownership of comments and metadata**

| Where | Belongs to |
| --- | --- |
| At the end of a header, posting, `balance` or declaration line | That line's record |
| At the end of a property line | The record the property belongs to |
| At the end of a breakdown line | The posting the breakdown belongs to (see "Ownership") |
| On its own line, before a transaction's first posting | The transaction (or the block's record) |
| On its own line, after a posting | That posting |
| On its own line, before the first block | The file; only comments are allowed there, metadata is `parse.orphan-line` |

- Whole-line comments follow the same rule as metadata: they belong to the record above, not to the next line. A comment written above a transaction as its title belongs to the previous record.
- The Raw model keeps where each comment and metadata line stands, so that writing text back keeps it in place (see [formatting.md](formatting.md)).

### Identifiers

Status: `implemented`

"Letter" means a Unicode letter, and "ASCII letter" one of `A`–`Z` and `a`–`z`; "digit" means `0`–`9`.

| Kind | Rule | Example |
| --- | --- | --- |
| Account name | Segments separated by `:`, none empty; no whitespace, `;`, `"`, `,`, `[`, `]`, `{`, `}`; does not start with `%`, `#`, `^`, `@` | `Assets:Cash`, `Expenses:CoffeeShop` |
| Account root | The first segment; starts with a letter; not a keyword | `Assets`, `Bank` |
| Commodity code | A letter, then letters, digits, `_`, `-`, `.`; not a keyword | `NTD`, `camera-01`, `BRK.B` |
| Entity | A letter or `_`, then letters, digits, `_`, `-` | `NAT`, `xx_breakfast` |
| Role | As an entity | `person` |
| Anchor | Letters, digits, `_`, `-`; no `/`, `.`, `:`; not `self`. A `/` after the name starts a period, which is not part of the anchor (see [README.md](README.md), "Reserved syntax") | `t_book`, `deposit-1011`, `t8f3k2q` |
| Commodity alias | No whitespace or digits; none of `;` `"` `,` `%` `#` `^` `@` `*` `×` `[` `]` `{` `}` `=` `(` `)` `+` `/`; does not start with `-`, `.`, `'`; not a keyword | `NT$`, `$`, `dollars` |
| Tag scope | Lowercase ASCII letters and `-` | `system` |
| Metadata key | A letter, then letters, Unicode digits, `_`, `-` | `invoice_number` |
| Time zone | An IANA name: ASCII letters, digits, `/`, `_`, `-`, `+` | `Asia/Taipei` |

- An identifier that breaks its rule is `parse.syntax`, except an anchor: a `%`, `#`, `#scope:` or `^` joined to a name that breaks the anchor rule, such as `%lunch.1005`, is `anchor.invalid-name`. Either way the block is not loaded.

### Strings and values

Status: `implemented`

- A string is enclosed in double quotes and does not span lines. Inside, only `\"` and `\\` are escapes. A string not closed on its line is `parse.unterminated-string`.
- Descriptions are always quoted.
- **Property and metadata values** run from after the keyword or key to the end of the line (before any trailer), trimmed: in `alias NT$ prefix` the value is `NT$ prefix`. A value that contains `;` or needs leading or trailing spaces is quoted as a whole. A value that starts and ends with `"` is read as a string, with its escapes: `;; title: "\"Dune\""` has the value `"Dune"`.
- This "to the end of the line" rule applies only to properties, metadata and `option`. Date lines, postings and the other declarations, such as `include`, are read token by token (see [records.md](records.md)).

### Symbol disambiguation

Status: `implemented`

| Case | Rule |
| --- | --- |
| `@`: price or entity | `@` or `@@` followed by whitespace is a price; followed by a letter or `_`, an entity; anything else is `parse.syntax` |
| `*`, `×` | `*` at the start of a posting line, or as a lone token after a header's time: cleared. In a breakdown, `*` or `×` comes before the unit price |
| `!` | Only as a lone token after a header's time: planned. At the start of a posting line: `parse.syntax` |
| `#` | After a header's time, followed by whitespace or the end of the line: cancelled. Joined to text (`#x`): a tag. `##x`: `parse.syntax`. At the start of a posting line: `parse.syntax`. So `2026-10-12 # "Lunch"` is cancelled, and `2026-10-12 #travel` is an unchecked transaction with a tag |
| `-` | At the start of a line, not joined to a digit or a word: a breakdown (see "Line classes"). Joined to a number: a minus sign. Inside an identifier: an ordinary character |
| `%`, `#`, `^`, `@` | Symbols only outside quotes and at the start of a token; `10%` and `AB-1#2` are not affected |
| `:` | Inside an account name: a segment separator. In `#scope:`, `^tag:` and `@role:`: a separator. In `;; key:`: ends the key |
| `[` | A lone token after a posting's amount: the posting's time. Joined to a point: its zone. Brackets pair up, so `[2026-06-02T09:00[Asia/Tokyo]]` is unambiguous |
| `=` | Inside the time of a transaction header or a Balance assertion; in a breakdown, before the total |

### Error recovery

Status: `implemented`

- A block is a top-level line plus every line it owns.
- When a line cannot be parsed, the diagnostic is reported and the whole block is not loaded. Parsing continues with the next top-level line; other blocks load normally.
- A line with no record to belong to is handled as in "Ownership".
- Parse diagnostics are returned in text order.
