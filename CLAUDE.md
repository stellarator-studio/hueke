# Hueke core

A double-entry bookkeeping accounting core in TypeScript. The project is in the architecture phase; most design is not final.

## Language

- Code, identifiers, comments, commit messages, and committed docs: English.

## Layout

| Path | Contents |
| --- | --- |
| `srcs/` | Source code |
| `tests/` | Tests |
| `docs/` | Finalized, committed documentation |

Other directories are not decided yet; ask before adding new top-level ones.

`docs/` is the specification and comes before the code: change the document first, then the code (`docs/README.md`, "Changing behavior"). Module boundaries and where each module lives are in `docs/architecture.md`.

## Environment

- Node and pnpm come from the conda environment `hueke-core` (`environment.yml`); pnpm is provided by corepack, not conda. See `README.md`, "Development".

## Code conventions

- Model records (Raw and derived) are readonly `interface`s that can be represented as JSON. Classes are only for API handles (`Hueke`, `Query`) and errors.
- `srcs/index.ts` is the only entry point. Types are re-exported with `export type *`; only what the docs describe is exported.
- Optional fields never take `undefined` (`exactOptionalPropertyTypes`): leave the field out instead. The Raw model relies on this to tell "not written" from "written empty".
- Tests take ledger text as input and go through the parser, not hand-built models.
- Code, tests and comments contain no development IDs: no use case, decision or milestone numbers. Describe the situation instead.

## Subagents

- Read-only work, such as comparing docs with code or collecting use cases against the specification, may use `Explore` subagents without asking. Run them in parallel, one per row of the table in `docs/architecture.md`, "Documents, code and tests".
- Changes to `srcs/` are not parallelized.
- Changes to tests are made by a single subagent, not split across several.
- After an implementation, before committing, a subagent reviews the diff without asking. It checks the diff against the documents that drive the changed code (the same table) and against the code conventions above: optional fields left out rather than `undefined`, no development IDs, and `srcs/index.ts` exporting only what the docs describe. It reports findings; the main session decides on and makes the fixes.

## Checks

- `srcs/io/parser/generated/` is not committed; `typecheck`, `test` and `lint` regenerate it first.
- Before committing, run `pnpm check`. It deletes the generated parser, then runs typecheck, lint, format check and tests, so it catches anything that only works with stale generated files.
