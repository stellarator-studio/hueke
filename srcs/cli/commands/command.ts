// What every subcommand shares: its options, and turning filter options into one query
// (docs/cli.md, "Filters").

import { query, type Axis, type Hueke, type Query, type Status } from "../../index.js";
import type { CliIO } from "../io.js";
import { UsageError } from "../io.js";
import type { Format } from "../output.js";

export interface Options {
  readonly format: Format;
  readonly at?: string;
  readonly period?: string;
  readonly overlaps?: string;
  readonly covers?: string;
  readonly axis?: string;
  readonly status?: string;
  readonly involves?: string;
  readonly planned?: boolean;
  readonly cancelled?: boolean;
  readonly depth?: string;
  readonly balance?: boolean;
}

export interface Command {
  readonly usage: string;
  readonly options: readonly string[]; // besides the common ones
  run(hueke: Hueke, args: readonly string[], options: Options, io: CliIO): number;
}

export const FILTERS = ["at", "period", "overlaps", "covers", "axis", "status", "involves"];
export const OCCURRENCE = ["planned", "cancelled"] as const;

export function filtered(hueke: Hueke, accounts: readonly string[], o: Options): Query {
  let q = query(hueke);
  if (o.axis !== undefined) q = q.axis(axisOf(o.axis));
  if (accounts.length > 0) q = q.accounts(...accounts);
  if (o.at !== undefined) q = q.until(o.at);
  if (o.period !== undefined) q = q.within(o.period);
  if (o.overlaps !== undefined) q = q.overlaps(o.overlaps);
  if (o.covers !== undefined) q = q.covers(o.covers);
  if (o.status !== undefined) q = q.status(...list(o.status).map(statusOf));
  if (o.involves !== undefined) q = q.involves(...list(o.involves));
  const occurrence = OCCURRENCE.filter((k) => o[k] === true);
  if (occurrence.length > 0) q = q.occurrence(...occurrence);
  return q;
}

const list = (text: string): string[] => text.split(",").map((s) => s.trim());

export function axisOf(text: string): Axis {
  if (text === "accounting" || text === "effective" || text === "txn-effective") return text;
  throw new UsageError(`unknown axis "${text}"`);
}

function statusOf(text: string): Status {
  if (text === "none" || text === "cleared") return text;
  throw new UsageError(`unknown status "${text}"`);
}

export function noArguments(name: string, args: readonly string[]): void {
  if (args.length > 0) throw new UsageError(`${name} takes no arguments`);
}
