// Normalization step 1: the modules of the ledger (docs/core/modules.md). From the root, each
// included module stands at the place of its `include` line, depth-first, as if the text were
// expanded there. The group ledgers that the root's shared accounts refer to are found and checked
// against what a group ledger may hold (docs/core/group-ledgers.md, "Group ledgers"). A root that
// starts with a `module` declaration is a group ledger on its own, checked the same way. Parse
// diagnostics are collected and unsupported syntax dropped.

import type { Id } from "../../data/model/types.js";
import { diagnostic } from "../../data/source/diagnostics.js";
import type { DeclarationData, ItemData, ModuleData } from "../../data/raw/model.js";
import { includedPath, sourceLine, sourcePath } from "../../data/raw/include.js";
import type { Diagnostic, SourcePath } from "../../data/source/source.js";
import { DECLARATIONS } from "./declarations.js";
import type { SourcedItem } from "./shared.js";
import { supported } from "./unsupported.js";

/** A group ledger that a shared account refers to. */
export interface Referenced {
  /** The shared account that refers to it. */
  readonly account: Id;
  readonly path: SourcePath;
  /** Its `module` declaration. */
  readonly declaration: DeclarationData;
  /** Its other supported records and declarations, without those its kind does not allow. */
  readonly items: SourcedItem[];
}

export interface Modules {
  /** The logical paths of the ledger's modules, in module order. */
  readonly ledger: SourcePath[];
  /**
   * Every supported record and declaration, and the transactions dropped for unsupported syntax,
   * in module order; `include` lines are consumed.
   */
  readonly items: SourcedItem[];
  /** Parse diagnostics of each module, in module order, then those of the group ledgers. */
  readonly parsed: Diagnostic[];
  /** The group ledgers that load, in the order of their shared accounts. */
  readonly groups: Referenced[];
  /** The root's `module` declaration, when the root is a group ledger on its own. */
  readonly standalone?: DeclarationData;
}

/** The ledger rooted at `root`; the root must be loaded. */
export function collectModules(
  data: ReadonlyMap<SourcePath, ModuleData>,
  root: SourcePath,
  out: Diagnostic[],
): Modules {
  const rootModule = data.get(root);
  const [first] = rootModule?.items ?? [];
  const standalone = first?.kind === "module" ? first : undefined;
  const result: Modules = {
    ledger: [],
    items: [],
    parsed: [],
    groups: [],
    ...(standalone && { standalone }),
  };
  if (!rootModule) return result;

  // The group ledgers the root's shared accounts refer to, each with its accounts.
  const referred = new Map<SourcePath, { account: Id; item: DeclarationData }[]>();
  // A group ledger on its own cannot hold shared accounts: they are reported when visited.
  for (const { account, item, line } of standalone ? [] : sharedAccounts(rootModule)) {
    const path = sourcePath(root, line);
    if (typeof path !== "string") {
      out.push(path);
      continue;
    }
    const list = referred.get(path);
    if (list) {
      out.push(
        diagnostic(
          "module.duplicate",
          `${path} is already referred to by ${list[0]?.account ?? ""}; neither converts`,
          root,
          line.span,
        ),
      );
      list.push({ account, item });
    } else referred.set(path, [{ account, item }]);
  }
  const included = new Set<SourcePath>();

  const visit = (path: SourcePath, module: ModuleData): void => {
    result.ledger.push(path);
    result.parsed.push(...module.diagnostics);
    // Only the root reaches here with a `module` declaration: an included module with one is
    // not visited. A root that starts with one holds only what a group ledger may hold.
    const own = path === root && standalone !== undefined;
    const items = own ? allowedItems(module.items.slice(1), path, out) : module.items;
    for (const { item, dropped } of supported(items, path, out, own)) {
      if (item.kind === "module") {
        out.push(
          diagnostic(
            "module.forbidden-record",
            "a module declaration is ignored unless it is the first record of the root",
            path,
            item.span,
          ),
        );
        continue;
      }
      if (item.kind !== "include") {
        result.items.push({ item, source: path, ...(dropped && { dropped }) });
        continue;
      }
      const resolved = includedPath(path, item);
      if (typeof resolved !== "string") {
        out.push(resolved);
        continue;
      }
      const target = data.get(resolved);
      if (result.ledger.includes(resolved) || referred.has(resolved)) {
        if (referred.has(resolved)) included.add(resolved);
        out.push(
          diagnostic(
            "module.duplicate",
            referred.has(resolved)
              ? `${resolved} is a group ledger a shared account refers to; neither takes effect`
              : `${resolved} is already in the ledger`,
            path,
            item.span,
          ),
        );
      } else if (!target)
        out.push(diagnostic("module.missing", `${resolved} is not loaded`, path, item.span));
      else if (target.items.some((i) => i.kind === "module"))
        out.push(
          diagnostic(
            "include.module-file",
            `${resolved} is a module of its own kind and cannot be included`,
            path,
            item.span,
          ),
        );
      else visit(resolved, target);
    }
  };
  visit(root, rootModule);

  for (const [path, accounts] of referred) {
    const [first] = accounts;
    if (!first || accounts.length > 1 || included.has(path) || path === root) {
      if (path === root && first)
        out.push(
          diagnostic(
            "module.duplicate",
            `${path} is the root of the ledger`,
            root,
            sourceLine(first.item)?.span,
          ),
        );
      continue;
    }
    const module = data.get(path);
    if (!module) {
      out.push(
        diagnostic(
          "shared.unknown-module",
          `${first.account}: ${path} is not loaded`,
          root,
          sourceLine(first.item)?.span,
        ),
      );
      continue;
    }
    result.parsed.push(...module.diagnostics);
    const group = referencedModule(path, module, first.account, out);
    if (group) result.groups.push(group);
  }
  return result;
}

/**
 * The root's account declarations under a root of type `shared` that write `source`: only the
 * first declaration of a root or an account takes effect (docs/core/ledger.md, "Duplicate
 * declarations").
 */
function sharedAccounts(
  module: ModuleData,
): { account: Id; item: DeclarationData; line: NonNullable<ReturnType<typeof sourceLine>> }[] {
  const types = new Map<string, string>();
  for (const item of module.items)
    if (item.kind === "account-root" && !types.has(item.args[0] ?? ""))
      types.set(item.args[0] ?? "", item.args[1] ?? "");
  const seen = new Set<Id>();
  const found = [];
  for (const item of module.items) {
    if (item.kind !== "account") continue;
    const account = item.args[0] ?? "";
    if (seen.has(account)) continue;
    seen.add(account);
    const line = sourceLine(item);
    if (line && types.get(account.split(":")[0] ?? "") === "shared")
      found.push({ account, item, line });
  }
  return found;
}

/**
 * A group ledger, or undefined when it does not start with exactly one `module` declaration.
 * Records its kind does not allow are reported and left out.
 */
function referencedModule(
  path: SourcePath,
  module: ModuleData,
  account: Id,
  out: Diagnostic[],
): Referenced | undefined {
  const [first] = module.items;
  const second = module.items.find((i, k) => k > 0 && i.kind === "module");
  if (first?.kind !== "module" || second) {
    out.push(
      diagnostic(
        "module.missing-declaration",
        second
          ? `${path} has more than one module declaration`
          : `${path} does not start with a module declaration`,
        path,
        (second ?? first)?.span,
      ),
    );
    return undefined;
  }
  const items: SourcedItem[] = [];
  for (const { item, dropped } of supported(
    allowedItems(module.items.slice(1), path, out),
    path,
    out,
    true,
  ))
    items.push({ item, source: path, ...(dropped && { dropped }) });
  return { account, path, declaration: first, items };
}

/** The records after a group ledger's `module` declaration that it may hold; reports the others. */
function allowedItems(items: readonly ItemData[], path: SourcePath, out: Diagnostic[]): ItemData[] {
  return items.filter((item) => {
    const why = forbidden(item);
    if (why === undefined) return true;
    out.push(
      diagnostic(
        "module.forbidden-record",
        `a group ledger cannot hold ${why}; it is not loaded`,
        path,
        item.span,
      ),
    );
    return false;
  });
}

/** What a group ledger cannot hold, named for the message; undefined when it may hold it. */
function forbidden(item: ItemData): string | undefined {
  if (item.kind === "transaction") return undefined;
  if (item.kind === "balance") return "a Balance";
  if (!DECLARATIONS.has(item.kind)) return `a ${item.kind} line`;
  if (item.kind === "account-root" && item.args[1] === "shared") return "a shared account";
  if (item.kind === "account")
    for (const line of item.lines)
      if (line.kind === "property" && line.key !== "display-name")
        return `an account's ${line.key}`;
  return undefined;
}
