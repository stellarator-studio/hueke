# hueke-core

A double-entry bookkeeping accounting core in TypeScript. It reads plain-text ledgers, checks them and answers queries; the `hueke` command line runs it on files.

The specification is in [docs/](docs/README.md).

## Development

### Requirements

- Node 22.12 or later. It is only needed for development, tests and the CLI; Core itself uses no Node API.
- pnpm, at the version pinned in `package.json` (`packageManager`). Corepack, which ships with Node, provides it.

The repository includes a conda environment, `hueke-core`, that provides Node 22 from conda-forge (`environment.yml`). Using it is optional.

### Setup

```sh
conda env create -f environment.yml   # once; later: conda env update -f environment.yml
conda activate hueke-core
corepack enable                       # once; puts pnpm on the PATH
pnpm install --frozen-lockfile        # also generates the parser
```

### Scripts

| Script | What it does |
| --- | --- |
| `pnpm generate` | Generates the parser from `srcs/io/parser/Hueke.g4` into `srcs/io/parser/generated/` (not committed) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest |
| `pnpm format` | Prettier, writing changes |
| `pnpm format:check` | Prettier, checking only |
| `pnpm build` | Compiles `srcs/` to `dist/`; `dist/cli/main.js` is the `hueke` binary |
| `pnpm check` | Deletes generated files, then runs typecheck, lint, format check and tests. Run it before every commit. |

`typecheck`, `lint` and `test` regenerate the parser first.

### Toolchain

Exact versions are pinned in `package.json`.

| Purpose | Tool | Notes |
| --- | --- | --- |
| Language | TypeScript 6.0, strict | Stays on 6.0 until typescript-eslint supports 7 |
| Tests | Vitest | `tests/**/*.test.ts` |
| Lint | ESLint with typescript-eslint `strictTypeChecked` | Also enforces the module boundaries in [docs/architecture.md](docs/architecture.md) |
| Format | Prettier, print width 100 | Does not format Markdown |
| Parser | ANTLR grammar with a hand-written lexer | antlr-ng generates the parser without Java; antlr4ng is the runtime |
| Time | temporal-polyfill | IANA time zones and daylight saving time |
| Decimals | Own BigInt rational numbers | Exact, including fractions such as `1000/3` |
