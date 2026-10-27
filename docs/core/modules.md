# Modules and paths

A ledger may span several files. Each file is one **module**, identified by a **logical path** that the platform chooses, and a module brings in others with `include`. This document covers how included modules join one ledger, module order, logical paths, and how the paths written in `include` resolve.

## Features

| Feature | Status |
| --- | --- |
| Modules and `include` | `specified` |
| Declarations in included modules | `specified` |
| Paths | `specified` |

## Concepts

A **module** is the Raw model of one file. The ledger is initialized from one **root** module; the modules it includes, directly or not, join it.

**Logical paths** (the paths modules are loaded under)

| Rule | Meaning |
| --- | --- |
| Root | Relative to the ledger's root directory, which the platform chooses |
| Separator | Always `/`; never starts with `/`, contains no empty segment, `.` or `..` |
| Comparison | Case-sensitive, after Unicode NFC normalization |
| Extension | Ledger files end in `.hueke`. This is a convention for platforms; Core does not check it |

The platform keeps to these rules. Core only applies NFC normalization to the paths given to `load` and `init`, and checks nothing else.

## Behavior

### Modules and `include`

Status: `specified`

A module includes another with `include <path>` (see [../dsl/records.md](../dsl/records.md), "`include`"); an included module may include others.

- The root and every module it includes, directly or not, form one ledger. Records (transactions and Balances) and `include` lines load from every module, and records share one namespace: a record does not depend on which file it is in.
- **Module order.** The modules are ordered depth-first: each included module stands at the place of its `include` line, before the records that follow that line. "Source position" anywhere in these documents means a place in this order.
- A path that resolves to a module that was not loaded is `module.missing`, reported on the `include` line; that `include` is ignored and the rest loads.
- Each module appears once in a ledger. Including a module that is already in it, including twice or in a cycle, is `module.duplicate`, reported on the `include` line; that `include` is ignored.
- Loaded modules that the root does not reach are not part of the ledger, and get no diagnostics.
- Core never looks for files. The platform asks which paths a module includes, loads them, and repeats until nothing new is found; then it initializes (see [ledger.md](ledger.md), "Loading and initialization").

### Declarations in included modules

Status: `specified`

- Only the root module's declarations take effect: `option`, `account-root`, `commodity` and `account`. Where they stand in the root does not matter.
- Declarations in an included module, at any depth, are kept in its Raw model but never take effect, whether or not the root declares the same thing. They are never duplicates of the root's or of each other.
- Each such declaration is `module.ignored-declaration` (warning), saying that only the root's declarations take effect.

### Paths

Status: `specified`

Paths are text only; Core does not know whether they are disk paths, vault paths or URLs. Logical paths are described under "Concepts".

**Paths written in a ledger** (in `include`)

| Written | Resolves to |
| --- | --- |
| `2026.hueke`, `./2026.hueke`, `../years/2026.hueke` | Relative to the folder of the module that writes it |
| `/years/2026.hueke` | From the root directory |

- Empty segments and `.` segments are dropped; `..` goes up one folder: `a/..//./b.hueke` written in `main.hueke` is `b.hueke`.
- A path that resolves above the root directory is `path.outside-root`.
- These are `path.invalid`: an empty path; a path naming a folder, which ends in `/`, `/.` or `/..`, or is `.` or `..`; a path with a scheme, which starts with a letter, then letters, digits, `+`, `.` or `-`, then `:`, such as `https:`, `file:` or `C:`.
- A faulty `include` is ignored; the rest loads.

## API

- `referencedSources(path, module)` returns `paths`, the logical paths the module includes, resolved, in written order and with repeats kept; and `errors`, the path errors, each a diagnostic (`path.invalid` or `path.outside-root`) on its `include` line.
- `resolvePath(from, written)` resolves a path written in the module at `from`. It returns either `path`, the logical path, or `error`, the code `path.invalid` or `path.outside-root`, with `message`. It does not throw.

## Examples

Modules `main.hueke`, `accounts.hueke` and `2026/10.hueke` are loaded:

```hueke
; main.hueke
option timezone Asia/Taipei
include accounts.hueke
include 2026/10.hueke
```

```hueke
; accounts.hueke
commodity NTD
    precision 0
```

```hueke
; 2026/10.hueke
include ../accounts.hueke

2026-10-12 * "Lunch"
    Expenses:Food     180 NTD
    Assets:Cash      -180 NTD
```

| Change | Result |
| --- | --- |
| As above | The ledger is `main.hueke`, `accounts.hueke`, `2026/10.hueke`; the lunch uses Asia/Taipei. `module.duplicate` on the `include` in `2026/10.hueke`. The `commodity NTD` in `accounts.hueke` does not take effect: `module.ignored-declaration`, and NTD is used as an undeclared commodity (`name.inferred-commodity`, precision inferred). |
| `main.hueke` also writes `include 2026/` | `path.invalid` |
| `main.hueke` also writes `include ../other.hueke` | `path.outside-root` |
| `main.hueke` also writes `include 2026/11.hueke`, not loaded | `module.missing`; the rest loads |
| `accounts.hueke` also writes `option timezone UTC` | It does not take effect; the lunch still uses Asia/Taipei. `module.ignored-declaration` |
| `main.hueke` moves `commodity NTD` from `accounts.hueke` to itself | NTD has precision 0; no diagnostic about it |
| `referencedSources("2026/10.hueke", …)` | `accounts.hueke` |
