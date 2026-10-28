// What every subcommand shares: its options, and turning filter options into one query
// (docs/cli.md, "Filters").

import { query, type Hueke, type Query } from "../../index.js";
import type { CliIO } from "../io.js";
import { UsageError } from "../io.js";
import type { Format } from "../output.js";

export interface Options {
  readonly format: Format;
  readonly at?: string;
  readonly period?: string;
  readonly depth?: string;
}

export interface Command {
  readonly usage: string;
  readonly options: readonly string[]; // besides the common ones
  run(hueke: Hueke, args: readonly string[], options: Options, io: CliIO): number;
}

export const FILTERS = ["at", "period"];

export function filtered(hueke: Hueke, accounts: readonly string[], o: Options): Query {
  let q = query(hueke);
  if (accounts.length > 0) q = q.accounts(...accounts);
  if (o.at !== undefined) q = q.until(o.at);
  if (o.period !== undefined) q = q.within(o.period);
  return q;
}

export function noArguments(name: string, args: readonly string[]): void {
  if (args.length > 0) throw new UsageError(`${name} takes no arguments`);
}
