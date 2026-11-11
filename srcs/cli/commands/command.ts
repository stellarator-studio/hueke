// What every subcommand shares: its options, and turning filter options into one query
// (docs/cli.md, "Filters").

import { query, type Axis, type Hueke, type Id, type Query, type Status } from "../../index.js";
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
  readonly id?: string;
  readonly who?: string;
  readonly tag?: string;
  readonly primary?: string;
  readonly breakdown?: string;
  readonly all?: boolean;
  readonly name?: boolean;
  readonly depth?: string;
  readonly balance?: boolean;
}

export interface Command {
  readonly usage: string;
  readonly options: readonly string[]; // besides the common ones
  run(hueke: Hueke, args: readonly string[], options: Options, io: CliIO): number;
}

export const FILTERS = [
  "at",
  "period",
  "overlaps",
  "covers",
  "axis",
  "status",
  "involves",
  "id",
  "who",
  "tag",
  "primary",
  "breakdown",
];
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
  if (o.id !== undefined) q = q.ids(...list(o.id));
  if (o.who !== undefined) q = q.entities(...list(o.who));
  if (o.tag !== undefined) q = q.tags(...list(o.tag));
  if (o.primary !== undefined) q = q.primaryTag(o.primary);
  if (o.breakdown !== undefined) q = q.breakdown(...list(o.breakdown));
  const occurrence = OCCURRENCE.filter((k) => o[k] === true);
  if (occurrence.length > 0) q = q.occurrence(...occurrence);
  return q;
}

export const list = (text: string): string[] => text.split(",").map((s) => s.trim());

/** With `--name`, the display name of an account or entity in place of its ID, when it has one. */
export function shownName(
  hueke: Hueke,
  o: Options,
): { readonly account: (id: Id) => string; readonly entity: (id: Id) => string } {
  if (o.name !== true) return { account: (id) => id, entity: (id) => id };
  const accounts = new Map(hueke.accounts.map((a) => [a.id, a.displayName ?? a.id]));
  const entities = new Map(hueke.entities.map((e) => [e.id, e.displayName ?? e.id]));
  return {
    account: (id) => accounts.get(id) ?? id,
    entity: (id) => entities.get(id) ?? id,
  };
}

function axisOf(text: string): Axis {
  if (text === "accounting" || text === "effective" || text === "txn-effective") return text;
  throw new UsageError(`unknown axis "${text}"`);
}

/**
 * The axis `--axis` names; without it, the API's default, `effective` (docs/cli.md, "Filters"). A
 * query does not tell its axis, so the dates the CLI prints need it from here.
 */
export function axisOption(o: Options): Axis {
  return o.axis === undefined ? "effective" : axisOf(o.axis);
}

function statusOf(text: string): Status {
  if (text === "none" || text === "cleared") return text;
  throw new UsageError(`unknown status "${text}"`);
}

export function noArguments(name: string, args: readonly string[]): void {
  if (args.length > 0) throw new UsageError(`${name} takes no arguments`);
}
