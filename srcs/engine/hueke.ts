// Hueke: modules are loaded by key, then init(root) normalizes the ledger rooted at one file
// (docs/core/ledger.md). check() returns every diagnostic.

import type {
  Account,
  AccountRoot,
  Commodity,
  Id,
  LedgerSettings,
  Posting,
  Transaction,
} from "../data/model/types.js";
import { anchorKey } from "../data/raw/anchor.js";
import type { ModuleData } from "../data/raw/model.js";
import type { Diagnostic, SourcePath } from "../data/source/source.js";
import { diagnostic } from "../data/source/diagnostics.js";
import { collectDeclarations, makeAccount } from "./normalize/declarations.js";
import { buildTransaction, type RecordContext } from "./normalize/records.js";
import { supported } from "./normalize/unsupported.js";
import { validate } from "./normalize/validate.js";

export interface HuekeOptions {
  /** Used only when the ledger has no `option timezone`. */
  readonly timezone?: string;
}

interface Internals {
  readonly diagnostics: Diagnostic[];
  readonly decimals: Map<Posting, number>;
  validated?: Diagnostic[];
}

const internals = new WeakMap<Hueke, Internals>();

export class Hueke {
  // Filled in by init().
  root: SourcePath = "";
  modules: SourcePath[] = [];
  readonly data = new Map<SourcePath, ModuleData>();
  settings: LedgerSettings = { timezone: "UTC" };
  roots: AccountRoot[] = [];
  accounts: Account[] = [];
  commodities: Commodity[] = [];
  transactions: Transaction[] = [];

  readonly #options: HuekeOptions;
  #initialized = false;

  constructor(options: HuekeOptions = {}) {
    this.#options = options;
  }

  /** Keeps one module's Raw model; a later load of the same key replaces it. */
  load(key: SourcePath, data: ModuleData): void {
    if (this.#initialized) throw new Error("load() after init(): create a new Hueke instead");
    this.data.set(key, data);
  }

  /** Normalizes the ledger rooted at `root`. */
  init(root: SourcePath): void {
    if (this.#initialized) throw new Error("init() can be called once");
    this.#initialized = true;
    this.root = root;
    const out: Diagnostic[] = [];
    const decimals = new Map<Posting, number>();
    internals.set(this, { diagnostics: out, decimals });

    // Step 1: modules
    const data = this.data.get(root);
    if (!data) {
      out.push(diagnostic("module.missing", `${root} is not loaded`, root));
      return;
    }
    this.modules = [root];
    out.push(...data.diagnostics);
    const items = supported(data.items, root, out);

    // Step 2: declarations
    const declared = collectDeclarations(items, root, this.#options, out);
    this.settings = declared.settings;
    this.roots = [...declared.roots.values()];
    const ctx: RecordContext = {
      source: root,
      time: { timezone: declared.settings.timezone },
      out,
      decimals,
    };

    // Step 3: records, with totals and filled-in amounts
    let auto = 0;
    const transactions: Transaction[] = [];
    for (const item of items) {
      if (item.kind !== "transaction") continue;
      const id = item.anchor ? anchorKey(item.anchor) : `~${String(++auto)}`;
      const t = buildTransaction(item, id, ctx);
      if (t) transactions.push(t);
    }
    // The sort is stable, so transactions at the same time keep their source order.
    this.transactions = [...transactions].sort((a, b) =>
      a.time.start < b.time.start ? -1 : a.time.start > b.time.start ? 1 : 0,
    );

    // Undeclared accounts and commodities are created in the order of their first use.
    const commodities = new Map(declared.commodities);
    const accounts = new Map<Id, Account>();
    for (const t of transactions)
      for (const p of t.postings) {
        for (const c of [p.amount, p.price, p.cost])
          if (c && !commodities.has(c.commodity))
            commodities.set(c.commodity, {
              id: c.commodity,
              precision: 0,
              precisionWritten: false,
            });
        if (!accounts.has(p.account))
          accounts.set(p.account, makeAccount(p.account, declared.roots));
      }
    this.commodities = [...commodities.values()];
    this.accounts = [...accounts.values()];
  }
}

/** Every diagnostic of the ledger: parse, init and the validation checks (run once, on first call). */
export function check(hueke: Hueke): Diagnostic[] {
  const inner = internals.get(hueke);
  if (!inner) throw new Error("check() before init()");
  inner.validated ??= validate({
    source: hueke.root,
    transactions: hueke.transactions,
    commodities: new Map(hueke.commodities.map((c) => [c.id, c])),
    decimals: inner.decimals,
  });
  return [...inner.diagnostics, ...inner.validated];
}
