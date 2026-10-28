// The `hueke` command line (docs/cli.md): reads the root file of a ledger, calls the API and prints
// the result. All file access goes through CliIO, so tests can run it in memory.

import { isAbsolute, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { Hueke, parse } from "../index.js";
import { balanceCommand } from "./commands/balance.js";
import { checkCommand, problems } from "./commands/check.js";
import type { Command, Options } from "./commands/command.js";
import { queryCommand } from "./commands/query.js";
import { registerCommand } from "./commands/register.js";
import { UsageError, type CliIO } from "./io.js";
import type { Format } from "./output.js";

export type { CliIO } from "./io.js";

const OPTIONS = {
  root: { type: "string" },
  file: { type: "string" },
  format: { type: "string" },
  at: { type: "string" },
  period: { type: "string" },
  depth: { type: "string" },
  help: { type: "boolean", short: "h" },
} as const;

const COMMANDS: Readonly<Record<string, Command>> = {
  check: checkCommand,
  balance: balanceCommand,
  query: queryCommand,
  register: registerCommand,
};

const COMMON = ["root", "file", "format", "help"];
const FORMATS: readonly Format[] = ["table", "csv"];

const USAGE = `Usage: hueke <command> [arguments] --file <path> [options]

Commands:
  check                       list the ledger's diagnostics
  balance [account...]        account balances
  query [account...]          matching postings
  register [account...]       matching postings by account, with balances

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
 * Reads the root file and initializes the ledger, keyed by its path relative to --root. A relative
 * --file starts from the current directory, and must be inside --root.
 */
function load(values: { root?: string; file?: string }, io: CliIO): Hueke {
  if (values.file === undefined) throw new UsageError("--file is required");
  const root = resolve(io.cwd, values.root ?? ".");
  const file = resolve(io.cwd, values.file);
  const key = relative(root, file).split(sep).join("/");
  if (key === "" || key === ".." || key.startsWith("../") || isAbsolute(key))
    throw new UsageError(`${values.file} is outside --root ${root}`);
  let text: string;
  try {
    text = io.readFile(file);
  } catch {
    throw new UsageError(`cannot read ${file}`);
  }
  const hueke = new Hueke();
  hueke.load(key, parse(key, text));
  hueke.init(key);
  return hueke;
}
