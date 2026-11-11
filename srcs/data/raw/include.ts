// The modules a module includes (docs/core/modules.md, "Modules and `include`").

import { diagnostic } from "../source/diagnostics.js";
import { resolvePath } from "../source/paths.js";
import type { Diagnostic, SourcePath } from "../source/source.js";
import type { DeclarationData, ModuleData } from "./model.js";

/** The logical path an `include` line names, or the diagnostic of a path that cannot be used. */
export function includedPath(from: SourcePath, item: DeclarationData): SourcePath | Diagnostic {
  const [written = ""] = item.args;
  const resolved = resolvePath(from, written);
  return "path" in resolved
    ? resolved.path
    : diagnostic(resolved.error, resolved.message, from, item.span);
}

/** The logical paths a module includes, in written order, and the errors of the others. */
export function referencedSources(
  path: SourcePath,
  module: ModuleData,
): { paths: SourcePath[]; errors: Diagnostic[] } {
  const paths: SourcePath[] = [];
  const errors: Diagnostic[] = [];
  for (const item of module.items) {
    if (item.kind !== "include") continue;
    const included = includedPath(path, item);
    if (typeof included === "string") paths.push(included);
    else errors.push(included);
  }
  return { paths, errors };
}
