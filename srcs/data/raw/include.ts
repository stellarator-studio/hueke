// The modules a module includes or refers to (docs/core/modules.md, "Modules and `include`",
// "Referenced modules").

import { diagnostic } from "../source/diagnostics.js";
import { resolvePath } from "../source/paths.js";
import type { Diagnostic, SourcePath, SourceSpan } from "../source/source.js";
import type { DeclarationData, ModuleData, PropertyLine } from "./model.js";

/** The logical path an `include` line names, or the diagnostic of a path that cannot be used. */
export function includedPath(from: SourcePath, item: DeclarationData): SourcePath | Diagnostic {
  const [written = ""] = item.args;
  return resolved(from, written, item.span);
}

/** A shared account's `source`: the path as written, and the name after `as`. */
interface SourceValue {
  readonly path: string;
  readonly as: string;
  /** Written `as ^<name>`: the group ledger's transactions take a primary tag. */
  readonly primary?: true;
}

/**
 * Reads a `source` value, `<path> as [^]<name>` (docs/dsl/records.md, "Group ledgers and shared
 * accounts"). The path is one token, quoted when it holds spaces. Undefined when the value is not
 * of that shape; the name is not checked here.
 */
export function sourceOf(value: string): SourceValue | undefined {
  let path: string;
  let rest: string;
  if (value.startsWith('"')) {
    const quoted = /^"((?:[^"\\]|\\.)*)"/.exec(value);
    if (!quoted) return undefined;
    path = (quoted[1] ?? "").replace(/\\(["\\])/g, "$1");
    rest = value.slice(quoted[0].length);
    if (rest !== "" && !/^\s/.test(rest)) return undefined;
  } else {
    path = /^\S+/.exec(value)?.[0] ?? "";
    if (path === "") return undefined;
    rest = value.slice(path.length);
  }
  rest = rest.trim();
  const m = /^as\s+(\^?)(\S+)$/.exec(rest);
  if (!m?.[2]) return undefined;
  return { path, as: m[2], ...(m[1] === "^" && { primary: true as const }) };
}

/** A shared account's `map` value: what it maps, from and to, as written. */
interface MapValue {
  readonly commodity: boolean;
  readonly from: string;
  readonly to: string;
}

/**
 * Reads a `map` value, `<name> -> <name>` or `commodity <code> -> <code>` (docs/dsl/records.md,
 * "Group ledgers and shared accounts"). Undefined when the value is not of that shape; the names
 * are not checked here.
 */
export function mapOf(value: string): MapValue | undefined {
  const m = /^(?:(commodity)\s+)?(\S+)\s+->\s+(\S+)$/.exec(value);
  return m ? { commodity: m[1] !== undefined, from: m[2] ?? "", to: m[3] ?? "" } : undefined;
}

/** The `source` line of an account declaration, if it has one. */
export function sourceLine(item: DeclarationData): PropertyLine | undefined {
  if (item.kind !== "account") return undefined;
  for (const line of item.lines) if (line.kind === "property" && line.key === "source") return line;
  return undefined;
}

/** The logical path a `source` line names, or the diagnostic of a path that cannot be used. */
export function sourcePath(from: SourcePath, line: PropertyLine): SourcePath | Diagnostic {
  return resolved(from, sourceOf(line.value)?.path ?? "", line.span);
}

function resolved(
  from: SourcePath,
  written: string,
  span: SourceSpan | undefined,
): SourcePath | Diagnostic {
  const r = resolvePath(from, written);
  return "path" in r ? r.path : diagnostic(r.error, r.message, from, span);
}

/**
 * The logical paths a module includes, and those its accounts' `source` lines refer to, in written
 * order; and the errors of the others.
 */
export function referencedSources(
  path: SourcePath,
  module: ModuleData,
): { paths: SourcePath[]; errors: Diagnostic[] } {
  const paths: SourcePath[] = [];
  const errors: Diagnostic[] = [];
  for (const item of module.items) {
    if (item.kind === "transaction" || item.kind === "balance") continue;
    const line = sourceLine(item);
    const found =
      item.kind === "include" ? includedPath(path, item) : line && sourcePath(path, line);
    if (found === undefined) continue;
    if (typeof found === "string") paths.push(found);
    else errors.push(found);
  }
  return { paths, errors };
}
