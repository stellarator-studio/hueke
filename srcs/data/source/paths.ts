// Logical paths and the paths written in `include` (docs/core/modules.md, "Paths"). Paths are text
// only: Core does not know whether they are disk paths, vault paths or URLs.

import type { SourcePath } from "./source.js";

export type PathError = "path.invalid" | "path.outside-root";

export type ResolvedPath =
  { readonly path: SourcePath } | { readonly error: PathError; readonly message: string };

/** A logical path in the form used for comparison: Unicode NFC, case kept. */
export const logicalPath = (path: SourcePath): SourcePath => path.normalize("NFC");

/**
 * Resolves a path written in the module at `from`: relative to that module's folder, or from the
 * root directory when it starts with `/`.
 */
export function resolvePath(from: SourcePath, written: string): ResolvedPath {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(written))
    return { error: "path.invalid", message: `"${written}" has a scheme` };
  const parts = written.split("/");
  const last = parts.at(-1);
  if (last === "" || last === "." || last === "..")
    return { error: "path.invalid", message: `"${written}" names a folder` };
  const segments = written.startsWith("/") ? [] : logicalPath(from).split("/").slice(0, -1);
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part !== "..") segments.push(part);
    else if (segments.pop() === undefined)
      return { error: "path.outside-root", message: `"${written}" is outside the root directory` };
  }
  return { path: logicalPath(segments.join("/")) };
}
