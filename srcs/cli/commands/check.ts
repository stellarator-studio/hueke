// `hueke check`: every diagnostic of the ledger.

import { check, position, type Diagnostic, type Hueke } from "../../index.js";
import type { CliIO } from "../io.js";
import { csv } from "../output.js";
import { noArguments, type Command, type Options } from "./command.js";

export const checkCommand: Command = {
  usage: "check --file <path> [--strict] [--format table|csv]",
  options: [],
  run(hueke: Hueke, args: readonly string[], options: Options, io: CliIO): number {
    noArguments("check", args);
    const diagnostics = check(hueke).map((d) => located(hueke, d));
    if (options.format === "csv")
      io.stdout(
        csv(
          ["source", "line", "column", "severity", "code", "message"],
          diagnostics.map((d) => [
            d.source ?? "",
            d.line === undefined ? "" : String(d.line),
            d.column === undefined ? "" : String(d.column),
            d.severity,
            d.code,
            d.message,
          ]),
        ),
      );
    else for (const d of diagnostics) io.stdout(diagnosticLine(d));
    return diagnostics.some((d) => d.severity === "error") ? 1 : 0;
  },
};

type Located = Diagnostic & { readonly line?: number; readonly column?: number };

function located(hueke: Hueke, d: Diagnostic): Located {
  const data = d.source === undefined ? undefined : hueke.data.get(d.source);
  const at = data && d.span ? position(data, d.span.start) : undefined;
  return { ...d, ...at };
}

/** `<source>:<line>:<column>: <severity> <code>: <message>`, as a table row of `check`. */
function diagnosticLine(d: Located): string {
  const where = [d.source, d.line, d.column].filter((x) => x !== undefined).join(":");
  return `${where ? `${where}: ` : ""}${d.severity} ${d.code}: ${d.message}\n`;
}

/** The warnings and errors, for the other commands to print on standard error. */
export function problems(hueke: Hueke): string {
  return check(hueke)
    .filter((d) => d.severity !== "info")
    .map((d) => diagnosticLine(located(hueke, d)))
    .join("");
}
