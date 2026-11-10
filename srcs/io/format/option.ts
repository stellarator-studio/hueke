// setOption(ledger, name, value): the text patches that change one setting in the root module
// (docs/core/settings.md, "Changing settings"). Reads the initialized ledger as plain data; never
// writes files.

import type { DeclarationData, ModuleData } from "../../data/raw/model.js";
import { isSettingName, readSetting } from "../../data/model/settings.js";
import type { SourcePath, TextPatch } from "../../data/source/source.js";
import { serialize, type SerializeLedger } from "./serialize.js";

/** What setOption reads from an initialized ledger. */
export interface OptionLedger extends SerializeLedger {
  readonly root: SourcePath;
  readonly data: ReadonlyMap<SourcePath, ModuleData>;
}

/**
 * The patches that make the root module write `value` for the setting `name`, or, without a value,
 * remove every writing of it. Throws before initialization, when the root module was never loaded,
 * and on a name or value that would not read back as a valid setting.
 */
export function setOption(ledger: OptionLedger, name: string, value?: string): TextPatch[] {
  const root = ledger.root;
  const module = root === "" ? undefined : ledger.data.get(root);
  if (!module) throw new Error("setOption() needs an initialized ledger whose root is loaded");
  if (!isSettingName(name)) throw new Error(`unknown option "${name}"`);
  if (value !== undefined) {
    // The value is read back as the rest of its line, trimmed.
    if (value === "" || value.includes(";") || /^\s|\s$|[^\S ]/.test(value))
      throw new Error(`option ${name}: "${value}" cannot be written on one line as given`);
    if (!readSetting(name, value))
      throw new Error(`"${value}" is not a valid value of option ${name}`);
  }

  const text = module.text;
  // Lines written follow the file's own line break.
  const eol = /\r\n/.test(text) && !/(^|[^\r])\n/.test(text) ? "\r\n" : "\n";
  const patch = (start: number, end: number, replacement: string): TextPatch => ({
    source: root,
    start,
    end,
    text: replacement,
    expect: text.slice(start, end),
  });
  /** A whole block with the line break after it. */
  const removal = (d: Written): TextPatch => {
    let end = d.span.end;
    if (text.startsWith("\r\n", end)) end += 2;
    else if (text.startsWith("\n", end)) end += 1;
    return patch(d.span.start, end, "");
  };

  const options = module.items.filter(
    (i): i is Written => i.kind === "option" && i.span !== undefined,
  );
  const writings = options.filter((d) => d.args[0] === name);
  if (value === undefined) return writings.map(removal);

  /** A declaration in canonical form, without its final line break: a span does not cover it. */
  const written = (d: DeclarationData): string =>
    serialize(ledger, { ...d, args: [name, value] })
      .slice(0, -1)
      .replaceAll("\n", eol);
  const [first, ...rest] = writings;
  const patches: TextPatch[] = [];
  if (first) {
    const block = written(first);
    if (block !== text.slice(first.span.start, first.span.end))
      patches.push(patch(first.span.start, first.span.end, block));
    patches.push(...rest.map(removal));
    return patches;
  }

  const line = written({ kind: "option", args: [], lines: [], postings: [] });
  const last = options.at(-1);
  const firstBlock = module.items[0]?.span;
  if (last) return [patch(last.span.end, last.span.end, `${eol}${line}`)];
  if (firstBlock) return [patch(firstBlock.start, firstBlock.start, `${line}${eol}${eol}`)];
  const lead = text === "" || text.endsWith("\n") ? "" : eol;
  return [patch(text.length, text.length, `${lead}${line}${eol}`)];
}

type Written = DeclarationData & { readonly span: NonNullable<DeclarationData["span"]> };
