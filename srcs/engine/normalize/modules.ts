// Normalization step 1: the modules of the ledger (docs/core/modules.md, "Modules and `include`").
// From the root, each included module stands at the place of its `include` line, depth-first, as
// if the text were expanded there. Parse diagnostics are collected and unsupported syntax dropped.

import { diagnostic } from "../../data/source/diagnostics.js";
import type { ModuleData } from "../../data/raw/model.js";
import { resolvePath } from "../../data/source/paths.js";
import type { Diagnostic, SourcePath } from "../../data/source/source.js";
import type { SourcedItem } from "./shared.js";
import { supported } from "./unsupported.js";

export interface Modules {
  /** The logical paths of the ledger's modules, in module order. */
  readonly ledger: SourcePath[];
  /**
   * Every supported record and declaration, and the transactions dropped for unsupported syntax,
   * in module order; `include` lines are consumed.
   */
  readonly items: SourcedItem[];
  /** Parse diagnostics of each module, in module order. */
  readonly parsed: Diagnostic[];
}

/** The ledger rooted at `root`; the root must be loaded. */
export function collectModules(
  data: ReadonlyMap<SourcePath, ModuleData>,
  root: SourcePath,
  out: Diagnostic[],
): Modules {
  const result: Modules = { ledger: [], items: [], parsed: [] };
  const visit = (path: SourcePath, module: ModuleData): void => {
    result.ledger.push(path);
    result.parsed.push(...module.diagnostics);
    for (const { item, dropped } of supported(module.items, path, out)) {
      if (item.kind !== "include") {
        result.items.push({ item, source: path, ...(dropped && { dropped }) });
        continue;
      }
      const [written = ""] = item.args;
      const resolved = resolvePath(path, written);
      if (!("path" in resolved)) {
        out.push(diagnostic(resolved.error, resolved.message, path, item.span));
        continue;
      }
      const included = data.get(resolved.path);
      if (result.ledger.includes(resolved.path))
        out.push(
          diagnostic(
            "module.duplicate",
            `${resolved.path} is already in the ledger`,
            path,
            item.span,
          ),
        );
      else if (!included)
        out.push(diagnostic("module.missing", `${resolved.path} is not loaded`, path, item.span));
      else visit(resolved.path, included);
    }
  };
  const module = data.get(root);
  if (module) visit(root, module);
  return result;
}
