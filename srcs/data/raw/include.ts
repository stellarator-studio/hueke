// The modules a module includes (docs/core/modules.md, "Modules and `include`").

import { diagnostic } from "../source/diagnostics.js";
import { resolvePath } from "../source/paths.js";
import type { Diagnostic, SourcePath } from "../source/source.js";
import type { ModuleData } from "./model.js";

/** The logical paths a module includes, in written order, and the errors of the others. */
export function referencedSources(
  path: SourcePath,
  module: ModuleData,
): { paths: SourcePath[]; errors: Diagnostic[] } {
  const paths: SourcePath[] = [];
  const errors: Diagnostic[] = [];
  for (const item of module.items) {
    if (item.kind !== "include") continue;
    const [written = ""] = item.args;
    const resolved = resolvePath(path, written);
    if ("path" in resolved) paths.push(resolved.path);
    else errors.push(diagnostic(resolved.error, resolved.message, path, item.span));
  }
  return { paths, errors };
}
