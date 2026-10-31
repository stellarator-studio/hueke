// serialize(ledger, record): one Raw record in the canonical form (docs/dsl/formatting.md).
// Numbers and aliases are read with the ledger's settings and commodities, as resolved by
// initialization; the directives are never read here.

import type { Commodity, Id, LedgerSettings } from "../../data/model/types.js";
import type {
  AnchorRef,
  BalanceData,
  BreakdownLine,
  DeclarationData,
  ItemChild,
  ItemData,
  Note,
  PostingChild,
  PostingData,
  PriceData,
  TagData,
  TransactionData,
} from "../../data/raw/model.js";
import {
  ConflictedAlias,
  NumberError,
  parseAmount,
  parseFigureValue,
  parseNumber,
  splitFigure,
  type AliasTable,
  type NumberFormat,
} from "../../data/values/number.js";

/** What serialization reads from an initialized ledger. */
export interface SerializeLedger {
  readonly settings: LedgerSettings;
  readonly commodities: readonly Commodity[];
}

const RECORD = "    ";
const CHILD = "        ";
/** Properties in their canonical order; others belong to features not supported yet. */
const PROPERTY_ORDER: Partial<Record<DeclarationData["kind"], readonly string[]>> = {
  commodity: ["item", "precision", "alias"],
  account: ["primary"],
};

/** Thrown when a record has a part the canonical form does not cover or a value it cannot read. */
class Unwritable extends Error {
  constructor(what: string) {
    super(`cannot serialize: ${what}`);
  }
}

/** The canonical text of one record, with its child lines and comments, ending with a line break. */
export function serialize(ledger: SerializeLedger, record: ItemData): string {
  const w = new Writer(ledger);
  const lines =
    record.kind === "transaction"
      ? w.transaction(record)
      : record.kind === "balance"
        ? w.balance(record)
        : w.declaration(record);
  return lines.map((l) => `${l}\n`).join("");
}

class Writer {
  private readonly format: NumberFormat;
  private readonly aliases: AliasTable;

  constructor(ledger: SerializeLedger) {
    this.format = ledger.settings;
    this.aliases = aliasTable(ledger.commodities);
  }

  // ---- Records ----

  transaction(t: TransactionData): string[] {
    const head = [t.accounting === undefined ? t.effective : `${t.effective}=${t.accounting}`];
    if (t.mark) head.push(t.mark);
    if (t.anchor) head.push(`%${anchorText(t.anchor)}`);
    if (t.description !== undefined) head.push(quote(t.description));
    head.push(...t.refs.map(reference));
    if (t.primaryTag) head.push(`^${anchorText(t.primaryTag.ref)}`);
    head.push(...t.tags.map(tag));
    const out = [trail(head.join(" "), t.trailer)];
    for (const line of t.lines) {
      if (line.kind === "property") throw new Unwritable(`transaction ${line.key}`);
      out.push(this.child(line, RECORD));
    }

    // The numbers of the postings end in one column: the leftmost one that leaves every line at
    // least two spaces between its lead and its number.
    const postings = t.postings.map((p) => this.posting(p));
    const column = Math.max(
      0,
      ...postings.map((p) => (p.number === undefined ? 0 : p.lead.length + 2 + p.number.length)),
    );
    for (const [i, p] of postings.entries()) {
      const amount =
        p.number === undefined
          ? ""
          : `${" ".repeat(column - p.lead.length - p.number.length)}${p.number} ${p.commodity ?? ""}`;
      out.push(trail(`${RECORD}${p.lead}${amount}${p.rest}`, t.postings[i]?.trailer));
      for (const line of t.postings[i]?.lines ?? []) out.push(this.postingChild(line));
    }
    return out;
  }

  balance(b: BalanceData): string[] {
    if (b.entity !== undefined) throw new Unwritable("balance @entity");
    const time = b.accounting === undefined ? b.time : `${b.time}=${b.accounting}`;
    const parts = [time, "balance", b.account, this.amount(b.amount)];
    if (b.pad) {
      parts.push("pad");
      if (b.pad.amount !== undefined) parts.push(this.amount(b.pad.amount));
      if (b.pad.price) parts.push(this.price(b.pad.price));
      if (b.pad.account !== undefined) parts.push("->", b.pad.account);
    }
    return [trail(parts.join(" "), b.trailer), ...b.lines.map((l) => this.child(l, RECORD))];
  }

  declaration(d: DeclarationData): string[] {
    let head: string;
    switch (d.kind) {
      case "option":
      case "account-root":
        if (d.kind === "account-root" && d.args[1] === "shared")
          throw new Unwritable("account-root shared");
        head = [d.kind, ...d.args].join(" ");
        break;
      case "commodity":
        head = `commodity ${d.args[0] ?? ""}`;
        break;
      case "account":
        for (const line of d.lines)
          if (line.kind === "property" && !PROPERTY_ORDER.account?.includes(line.key))
            throw new Unwritable(`account ${line.key}`);
        if (d.anchor) throw new Unwritable("an account's %anchor");
        head = `account ${d.args[0] ?? ""}`;
        break;
      case "include":
        head = `include ${includePath(d.args[0] ?? "")}`;
        break;
      default:
        throw new Unwritable(d.kind);
    }
    const lines = inOrder(d.lines, PROPERTY_ORDER[d.kind] ?? []);
    return [trail(head, d.trailer), ...lines.map((l) => this.child(l, RECORD))];
  }

  // ---- Lines ----

  private child(line: ItemChild, indent: string): string {
    if (line.kind === "note") return wholeLine(line.note, indent);
    if (line.children) throw new Unwritable(line.key);
    // An alias is two tokens, a text and its side; other values run to the end of the line.
    const written = line.key === "alias" ? line.value.split(/\s+/).join(" ") : value(line.value);
    const text = line.value === "" ? line.key : `${line.key} ${written}`;
    return trail(`${indent}${text}`, line.trailer);
  }

  private posting(p: PostingData): {
    lead: string;
    number?: string;
    commodity?: string;
    rest: string;
  } {
    const lead = `${p.cleared ? "* " : ""}${p.account}`;
    const rest: string[] = [];
    if (p.cost)
      rest.push(
        p.cost.kind === "total"
          ? `{{${this.amount(p.cost.amount)}}}`
          : `{${this.amount(p.cost.amount)}}`,
      );
    if (p.price) rest.push(this.price(p.price));
    if (p.effective !== undefined) rest.push(`[${p.effective}]`);
    if (p.anchor) rest.push(`%${anchorText(p.anchor)}`);
    rest.push(...p.refs.map(reference), ...p.tags.map(tag));
    const tail = rest.map((r) => ` ${r}`).join("");
    if (p.slot) throw new Unwritable("a template posting");
    if (p.amount === undefined) return { lead, rest: tail };
    const amount = this.amount(p.amount);
    const space = amount.lastIndexOf(" ");
    return { lead, number: amount.slice(0, space), commodity: amount.slice(space + 1), rest: tail };
  }

  private postingChild(line: PostingChild): string {
    if (line.kind === "note") return wholeLine(line.note, CHILD);
    if (line.kind !== "breakdown") throw new Unwritable(line.kind);
    return trail(this.breakdown(line), line.trailer);
  }

  private breakdown(b: BreakdownLine): string {
    if (b.name === "") throw new Unwritable("a breakdown line without a name");
    const name = /;|\s\s|\t|^"/.test(b.name) ? quote(b.name) : b.name;
    if (b.figure === undefined) return `${CHILD}- ${name}`;
    return `${CHILD}- ${name}  ${this.figure(b.figure)}`;
  }

  // ---- Values ----

  /** `180 NTD`: the number in the ledger's marks, or the expression as written, then the code. */
  private amount(text: string): string {
    try {
      const a = parseAmount(text, this.format, this.aliases);
      return `${a.expression ?? number(a.value, a.decimals, this.format)} ${a.commodity}`;
    } catch (e) {
      if (e instanceof ConflictedAlias) throw new Unwritable(`alias ${e.message} is in conflict`);
      throw e;
    }
  }

  private price(p: PriceData): string {
    return `${p.kind === "total" ? "@@" : "@"} ${this.amount(p.amount)}`;
  }

  /**
   * A breakdown figure: `3 cups * 40 NTD = 120 NTD`. One that cannot be read is only a warning
   * in the ledger, so it is kept as written.
   */
  private figure(text: string): string {
    try {
      const { quantity: q, unitPrice, total } = splitFigure(text);
      const out: string[] = [];
      if (q)
        out.push(q.unit === undefined ? this.bare(q.number) : `${this.bare(q.number)} ${q.unit}`);
      if (unitPrice !== undefined) out.push("*", this.figureValue(unitPrice));
      if (total !== undefined) out.push("=", this.figureValue(total));
      return out.join(" ");
    } catch (e) {
      if (e instanceof NumberError || e instanceof ConflictedAlias) return text.trim();
      throw e;
    }
  }

  private figureValue(text: string): string {
    const v = parseFigureValue(text, this.format, this.aliases);
    const n = number(v.value, v.decimals, this.format);
    return v.commodity === undefined ? n : `${n} ${v.commodity}`;
  }

  private bare(text: string): string {
    const n = parseNumber(text, this.format);
    return n.expression ?? number(n.value, n.decimals, this.format);
  }
}

/** Aliases as initialization resolved them: one in conflict is not usable. */
function aliasTable(commodities: readonly Commodity[]): AliasTable {
  const owners = new Map<string, { id: Id; position: "prefix" | "suffix" }[]>();
  for (const c of commodities)
    for (const a of c.aliases)
      owners.set(a.text, [...(owners.get(a.text) ?? []), { id: c.id, ...a }]);
  const codes = new Set(commodities.map((c) => c.id));
  const prefix = new Map<string, Id>();
  const suffix = new Map<string, Id>();
  const conflicted = new Set<string>();
  for (const [text, list] of owners) {
    const [first] = list;
    if (!first || list.length > 1 || codes.has(text)) conflicted.add(text);
    else (first.position === "prefix" ? prefix : suffix).set(text, first.id);
  }
  return { prefix, suffix, conflicted };
}

/** A decimal value in the ledger's marks, with group marks and the decimal places written. */
function number(value: string, decimals: number, format: NumberFormat): string {
  const negative = value.startsWith("-");
  const [whole = "", fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const grouped =
    format.groupMark === null ? whole : whole.replace(/\B(?=(\d{3})+$)/g, format.groupMark);
  const places = fraction.padEnd(decimals, "0");
  return `${negative ? "-" : ""}${grouped}${places ? `${format.decimalMark}${places}` : ""}`;
}

function trail(line: string, trailer: Note | undefined): string {
  if (trailer?.kind === "meta" && trailer.value.includes("\n"))
    throw new Unwritable("Metadata with a line break at the end of a line");
  return trailer ? `${line}  ${note(trailer)}` : line;
}

/**
 * A note on its own line. A Metadata value with line breaks goes on continuation lines, four
 * spaces after `;;` plus each line's own indentation. When every further line is indented, the
 * least indented one is quoted with its spaces, so the indentation reads back the same.
 */
function wholeLine(n: Note, indent: string): string {
  if (n.kind !== "meta" || !n.value.includes("\n")) return `${indent}${note(n)}`;
  const [first = "", ...rest] = n.value.split("\n");
  const leads = rest.map((l) => /^ */.exec(l)?.[0].length ?? 0);
  const least = Math.min(...leads);
  const quoted = least > 0 ? leads.indexOf(least) : -1;
  const lines = rest.map((l, i) => {
    if (i === quoted) return quote(l);
    const body = l.slice(leads[i]);
    const text = body === "" || /^["\s]|;|\s$/.test(body) ? quote(body) : body;
    return " ".repeat(leads[i] ?? 0) + text;
  });
  // An empty first line is written `""`: a key line with no value would drop it.
  const head = first === "" ? '""' : value(first);
  return [`${indent};; ${n.key}: ${head}`, ...lines.map((l) => `${indent};;    ${l}`)].join("\n");
}

function note(n: Note): string {
  return n.kind === "meta" ? `;; ${n.key}: ${value(n.value)}` : `; ${n.text}`;
}

/** Values are unquoted, unless they start with `"`, contain `;` or have leading or trailing spaces. */
function value(text: string): string {
  return text.startsWith('"') || text.includes(";") || text !== text.trim() ? quote(text) : text;
}

/**
 * Properties in the given order, then whole-line Metadata in written order. A whole-line comment
 * belongs to the line above it and moves with it; comments before any property stay first.
 */
function inOrder(lines: readonly ItemChild[], order: readonly string[]): ItemChild[] {
  const lead: ItemChild[] = [];
  const groups: ItemChild[][] = [];
  for (const line of lines) {
    const last = groups.at(-1);
    if (line.kind === "note" && line.note.kind === "comment") (last ?? lead).push(line);
    else groups.push([line]);
  }
  const rank = (g: ItemChild[]): number => {
    const [first] = g;
    return first?.kind === "property" ? order.indexOf(first.key) : order.length;
  };
  // Array.prototype.sort is stable: repeated properties and Metadata keep their written order.
  return [...lead, ...groups.sort((a, b) => rank(a) - rank(b)).flat()];
}

/** An include path is one token: quoted when it holds whitespace or a character that ends a token. */
function includePath(text: string): string {
  return /[\s;"()[\]{}]/.test(text) ? quote(text) : text;
}

function quote(text: string): string {
  return `"${text.replace(/["\\]/g, "\\$&")}"`;
}

function anchorText(ref: AnchorRef): string {
  const name = ref.module === undefined ? ref.name : `${ref.module}:${ref.name}`;
  return ref.period === undefined ? name : `${name}/${ref.period}`;
}

/** `@NAT`, never `@person:NAT`. */
function reference(text: string): string {
  return `@${text.startsWith("person:") ? text.slice("person:".length) : text}`;
}

/** `#travel`, never `#tag:travel`. */
function tag(t: TagData): string {
  return `#${t.scope === undefined || t.scope === "tag" ? "" : `${t.scope}:`}${anchorText(t.ref)}`;
}
