// The `hueke` command line (docs/cli.md): reads a ledger's files, calls the API and prints the
// result. All file access goes through CliIO, so tests can run it in memory.

import { isAbsolute, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { Hueke, parse, referencedSources } from "../index.js";
import { balanceCommand } from "./commands/balance.js";
import { checkCommand, problems } from "./commands/check.js";
import { groupCommand } from "./commands/group.js";
import { obligationsCommand } from "./commands/obligations.js";
import type { Command, Options } from "./commands/command.js";
import { queryCommand } from "./commands/query.js";
import { reconcileCommand } from "./commands/reconcile.js";
import { registerCommand } from "./commands/register.js";
import { UsageError, type CliIO } from "./io.js";
import type { Format } from "./output.js";

export type { CliIO } from "./io.js";

const OPTIONS = {
  root: { type: "string" },
  file: { type: "string" },
  strict: { type: "boolean" },
  format: { type: "string" },
  at: { type: "string" },
  period: { type: "string" },
  overlaps: { type: "string" },
  covers: { type: "string" },
  axis: { type: "string" },
  status: { type: "string" },
  involves: { type: "string" },
  planned: { type: "boolean" },
  cancelled: { type: "boolean" },
  id: { type: "string" },
  who: { type: "string" },
  tag: { type: "string" },
  primary: { type: "string" },
  breakdown: { type: "string" },
  all: { type: "boolean" },
  name: { type: "boolean" },
  depth: { type: "string" },
  balance: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

const COMMANDS: Readonly<Record<string, Command>> = {
  check: checkCommand,
  balance: balanceCommand,
  query: queryCommand,
  register: registerCommand,
  reconcile: reconcileCommand,
  obligations: obligationsCommand,
  group: groupCommand,
};

const COMMON = ["root", "file", "strict", "format", "help"];
const FORMATS: readonly Format[] = ["table", "csv"];

const USAGE = `Usage: hueke <command> [arguments] --file <path> [options]

Commands:
  check                       list the ledger's diagnostics
  balance [account...]        account balances
  query [account...]          matching postings
  register [account...]       matching postings by account, with balances
  reconcile <account> --at <time>
                              the reconciliation view of one account
  obligations [account...]    the progress of obligations
  group <#scope:anchor | ^anchor>
                              an anchor's record and the members of its group

Run "hueke <command> --help" for its options. See docs/cli.md.
`;

/** Runs one command; returns the exit status. */
export function run(args: readonly string[], io: CliIO): number {
  try {
    const { values, positionals, tokens } = parseArgs({
      args: [...args],
      options: OPTIONS,
      allowPositionals: true,
      strict: true,
      tokens: true,
    });
    const written = new Set<string>();
    for (const t of tokens)
      if (t.kind === "option") {
        if (written.has(t.name)) throw new UsageError(`--${t.name} is written twice`);
        written.add(t.name);
      }
    const [name, ...rest] = positionals;
    if (name === undefined) {
      if (values.help) io.stdout(USAGE);
      else io.stderr(USAGE);
      return values.help ? 0 : 2;
    }
    const command = COMMANDS[name];
    if (!command) throw new UsageError(`unknown command "${name}"`);
    if (values.help) {
      io.stdout(`Usage: hueke ${command.usage}\n`);
      return 0;
    }
    for (const option of Object.keys(values))
      if (!COMMON.includes(option) && !command.options.includes(option))
        throw new UsageError(`--${option} does not apply to ${name}`);
    const format = (values.format ?? "table") as Format;
    if (!FORMATS.includes(format)) throw new UsageError(`unknown format "${format}"`);

    const hueke = load(values, io);
    const options: Options = { ...values, format };
    if (name === "check") return command.run(hueke, rest, options, io);
    // The other commands still run; once a result is printed, the problems go to standard error.
    let out = "";
    const status = command.run(hueke, rest, options, { ...io, stdout: (text) => (out += text) });
    io.stdout(out);
    const text = problems(hueke);
    if (text) io.stderr(text);
    return status;
  } catch (e) {
    if (!(e instanceof Error)) throw e;
    io.stderr(`hueke: ${e.message}\n`);
    return 2;
  }
}

/**
 * Reads the root file and every file it includes, each keyed by its path relative to --root, and
 * initializes the ledger. A file that cannot be read is left out; Core reports module.missing.
 * A relative --file starts from the current directory, and must be inside --root.
 */
function load(values: { root?: string; file?: string; strict?: boolean }, io: CliIO): Hueke {
  if (values.file === undefined) throw new UsageError("--file is required");
  const root = resolve(io.cwd, values.root ?? ".");
  const file = resolve(io.cwd, values.file);
  const key = relative(root, file).split(sep).join("/");
  if (key === "" || key === ".." || key.startsWith("../") || isAbsolute(key))
    throw new UsageError(`${values.file} is outside --root ${root}`);
  const hueke = new Hueke(values.strict ? { strict: true } : {});
  const queue = [key];
  const seen = new Set(queue);
  for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
    const name = resolve(root, ...path.split("/"));
    let text: string;
    try {
      text = io.readFile(name);
    } catch {
      if (path === key) throw new UsageError(`cannot read ${name}`);
      continue;
    }
    const module = parse(path, text);
    hueke.load(path, module);
    for (const next of referencedSources(path, module).paths)
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
  }
  hueke.init(key);
  return hueke;
}
