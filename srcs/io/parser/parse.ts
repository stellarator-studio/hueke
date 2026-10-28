// parse(path, text): one file's DSL text → ModuleData (the Raw model).
//
// The generated parser only classifies lines; the builder reads each line's tokens and checks
// order, repetition and ownership. Errors stay within a block: a broken block yields diagnostics
// and no item, and parsing continues at the next top-level line.

import {
  BaseErrorListener,
  CommonTokenStream,
  ParserRuleContext,
  PredictionMode,
  type Recognizer,
  type ATNSimulator,
  Token,
} from "antlr4ng";
import {
  BalanceTailContext,
  BreakdownLineContext,
  DateLineContext,
  DeclLineContext,
  HuekeParser as P,
  OptionDeclContext,
  RootDeclContext,
  CommodityDeclContext,
  AccountDeclContext,
  EntityDeclContext,
  GeneratorDeclContext,
  CapGroupDeclContext,
  ModuleDeclContext,
  IncludeDeclContext,
  PaidByLineContext,
  PostingLineContext,
  PropertyLineContext,
  SplitLineContext,
} from "./generated/HuekeParser.js";
import { HandLexer, NOTE_CHANNEL } from "./lexer.js";
import { LineRecovery } from "./recovery.js";
import {
  accountError,
  aliasError,
  anchorError,
  commodityError,
  referenceError,
  rootError,
  scopeError,
} from "./identifiers.js";
import { diagnostic, type Code } from "../../data/source/diagnostics.js";
import { timeTextError } from "../../data/time/text.js";
import type {
  AnchorRef,
  BalanceData,
  BreakdownLine,
  CommentNote,
  DeclarationData,
  DeclarationKind,
  HeaderTailData,
  ItemChild,
  ItemData,
  ModuleData,
  Note,
  NoteLine,
  PaidByLine,
  PostingChild,
  PostingData,
  PriceData,
  PropertyLine,
  SplitLine,
  SplitMemberData,
  TagData,
  TransactionData,
} from "../../data/raw/model.js";
import type { Diagnostic, SourcePath, SourceSpan } from "../../data/source/source.js";

// ---------- Ownership (docs/dsl/lexical.md) ----------

const CYCLE = ["from", "every", "count", "until", "follows", "skip"];
const ACCEPTS: Partial<Record<DeclarationKind | "transaction", readonly string[]>> = {
  transaction: ["share", "into"],
  commodity: ["item", "precision", "alias"],
  account: [
    "name",
    "active",
    "obligation",
    "pad-account",
    "primary",
    "allow",
    "deny",
    "statement",
    "source",
    "self",
    "map",
  ],
  entity: ["name", "type"],
  module: ["share"],
  schedule: [...CYCLE, "override"],
  installment: [
    ...CYCLE,
    "override",
    "principal",
    "method",
    "rate",
    "periodic-rate",
    "first-period",
    "rounding",
    "absorb",
    "fee",
  ],
  rule: ["from", "rate", "follows", "every", "cap", "minimum", "rounding"],
};
const STATEMENT = [...CYCLE, "due", "override"];
const REPEATABLE = new Set(["alias", "map", "share", "from", "every", "override"]);
/** Records whose blocks accept whole-line Metadata. */
const TAKES_META = new Set<string>([
  "transaction",
  "balance",
  "commodity",
  "account",
  "entity",
  "module",
  "schedule",
  "installment",
  "rule",
  "cap-group",
]);
const TEMPLATE = new Set<string>(["schedule", "installment", "rule"]);

// Header token order: status, anchor, description, entities, primary tag, tags.
const HEADER_ORDER = new Map<number, number>([
  [P.STAR, 0],
  [P.BANG, 0],
  [P.HASH, 0],
  [P.ANCHOR, 1],
  [P.STRING, 2],
  [P.ENTITY, 3],
  [P.PRIMARY, 4],
  [P.TAG, 5],
]);
const REPEATED_IN_HEADER = new Set([3, 5]);

class BlockError extends Error {
  constructor(
    readonly code: Code,
    message: string,
  ) {
    super(message);
  }
}

/** Throws parse.syntax when an identifier breaks its rule. */
function identifier(error: string | undefined): void {
  if (error !== undefined) throw new BlockError("parse.syntax", error);
}

const ROOT_TYPES = ["asset", "liability", "equity", "income", "expense", "shared"];

// ---------- Entry point ----------

export function parse(path: SourcePath, text: string): ModuleData {
  const diagnostics: Diagnostic[] = [];
  const lineErrors = new Map<number, Diagnostic[]>();
  const lineStarts = computeLineStarts(text);
  const report = (offset: number, end: number, message: string, code: Code = "parse.syntax") => {
    const d = diagnostic(code, message, path, { start: offset, end });
    const line = lineOf(lineStarts, offset);
    const list = lineErrors.get(line);
    if (list) list.push(d);
    else lineErrors.set(line, [d]);
  };

  const lexer = new HandLexer(text, (offset, message) => {
    report(offset, offset + 1, message);
  });
  const tokens = new CommonTokenStream(lexer);
  const parser = new P(tokens);
  parser.interpreter.predictionMode = PredictionMode.SLL;
  parser.removeErrorListeners();
  parser.addErrorListener(
    new (class extends BaseErrorListener {
      // The signature is the base class's.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
      override syntaxError<S extends Token, T extends ATNSimulator>(
        _recognizer: Recognizer<T>,
        symbol: S | null,
        _line: number,
        _column: number,
        message: string,
      ): void {
        const start = symbol?.start ?? 0;
        const unterminated = symbol?.type === P.BAD_STRING;
        report(
          start,
          (symbol?.stop ?? start) + 1,
          unterminated ? "the string is not closed" : message,
          unterminated ? "parse.unterminated-string" : "parse.syntax",
        );
      }
    })(),
  );
  parser.errorHandler = new LineRecovery();

  const tree = parser.file();
  const builder = new Builder(path, text, tokens, lineStarts, lineErrors, diagnostics);
  builder.build(tree);
  diagnostics.sort((a, b) => (a.span?.start ?? 0) - (b.span?.start ?? 0));
  return { comments: builder.comments, items: builder.items, lineStarts, diagnostics };
}

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

/** 1-based line of an offset. */
function lineOf(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((starts[mid] ?? 0) <= offset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

// ---------- Builder ----------

type Kind = ItemData["kind"];

interface Block {
  item: ItemData;
  kind: Kind;
  span: { start: number; end: number };
  lines: ItemChild[];
  postings?: PostingData[];
  posting?: { data: PostingData; lines: PostingChild[]; span: { start: number; end: number } };
  statement?: { children: ItemChild[]; span: { start: number; end: number } } | undefined;
  /** Keys seen since the last `from` (rule segments) or in the whole record. */
  seen: Set<string>;
  hasItem: boolean;
  hasPrecision: boolean;
}

class Builder {
  readonly items: ItemData[] = [];
  readonly comments: (NoteLine & { readonly note: CommentNote })[] = [];
  private block: Block | undefined;
  private broken = false;
  private started = false;

  constructor(
    private readonly path: SourcePath,
    private readonly src: string,
    private readonly tokens: CommonTokenStream,
    private readonly lineStarts: readonly number[],
    private readonly lineErrors: Map<number, Diagnostic[]>,
    private readonly diagnostics: Diagnostic[],
  ) {}

  build(file: ParserRuleContext): void {
    // Line contents are children of `file`; comments and Metadata are on NOTE_CHANNEL.
    const contents = new Map<number, ParserRuleContext>();
    for (const child of file.children)
      if (child instanceof ParserRuleContext && child.start) contents.set(child.start.line, child);
    const notes = new Map<number, Token>();
    for (const t of this.tokens.getTokens()) if (t.channel === NOTE_CHANNEL) notes.set(t.line, t);

    for (let line = 1; line <= this.lineStarts.length; line++) {
      const content = contents.get(line);
      const note = notes.get(line);
      const errors = this.lineErrors.get(line);
      if (content) this.line(content, note, errors);
      else if (errors) this.errorLine(errors);
      else if (note) {
        const more = this.continuation(note, (l) =>
          contents.has(l) || this.lineErrors.has(l) ? undefined : notes.get(l),
        );
        this.wholeLine(note, more);
        line += more.length;
      }
    }
    this.closeBlock();
  }

  /**
   * The continuation lines of a whole-line Metadata: the `;;` lines right after it whose text
   * starts further right than its key. A line with no text ends it.
   */
  private continuation(note: Token, noteAt: (line: number) => Token | undefined): Token[] {
    if (note.type !== P.META) return [];
    const key = META_KEY.exec(this.text(note).trimEnd())?.[1];
    if (key === undefined) return [];
    const more: Token[] = [];
    for (let line = note.line + 1; ; line++) {
      const next = noteAt(line);
      if (next?.type !== P.META) return more;
      const text = this.text(next);
      const lead = /^;;\s*/.exec(text)?.[0].length ?? 0;
      if (text.slice(lead).trim() === "" || next.column + lead <= note.column + key.length)
        return more;
      more.push(next);
    }
  }

  // ---- Lines ----

  private line(ctx: ParserRuleContext, note: Token | undefined, errors?: Diagnostic[]): void {
    const top = ctx instanceof DateLineContext || ctx instanceof DeclLineContext;
    if (top) {
      this.closeBlock();
      this.started = true;
    }
    if (errors) {
      // A header whose order is wrong reads as an extra token to the grammar; report the order.
      if (ctx instanceof DateLineContext && !ctx.balanceTail()) {
        try {
          const toks = this.lineTokens(ctx);
          this.header(toks.slice(this.afterTime(toks)), true);
        } catch (e) {
          if (e instanceof BlockError && e.code === "parse.token-order") {
            this.fail(e.code, e.message, this.span(ctx));
            return;
          }
        }
      }
      this.errorLine(errors);
      return;
    }
    if (this.broken) return;
    try {
      if (top) this.openBlock(ctx, note);
      else this.child(ctx, note);
    } catch (e) {
      if (!(e instanceof BlockError)) throw e;
      this.fail(e.code, e.message, this.span(ctx));
    }
  }

  private errorLine(errors: Diagnostic[]): void {
    this.diagnostics.push(...errors);
    this.broken = true;
  }

  private fail(code: Code, message: string, span: SourceSpan): void {
    this.diagnostics.push(diagnostic(code, message, this.path, span));
    this.broken = true;
  }

  private wholeLine(token: Token, more: Token[]): void {
    const last = more.at(-1);
    const span = { start: token.start, end: (last ?? token).stop + 1 };
    if (!this.started) {
      if (token.type === P.META) {
        this.orphan(span, "Metadata before the first record has no owner");
        return;
      }
      this.comments.push({ kind: "note", span, note: this.comment(token) });
      return;
    }
    const block = this.block;
    if (this.broken || !block) return;
    let note: Note;
    try {
      note = token.type === P.META ? this.meta(token, more) : this.comment(token);
    } catch (e) {
      if (!(e instanceof BlockError)) throw e;
      this.fail(e.code, e.message, span);
      return;
    }
    if (note.kind === "meta" && !TAKES_META.has(block.kind)) {
      this.orphan(span, `${block.kind} does not take Metadata`);
      return;
    }
    const line: NoteLine = { kind: "note", span, note };
    if (block.posting) {
      if (note.kind === "meta" && block.posting.lines.some((l) => l.kind === "breakdown"))
        this.metadataAfterBreakdown(span);
      block.posting.lines.push(line);
      block.posting.span.end = span.end;
    } else if (block.statement) {
      block.statement.children.push(line);
      block.statement.span.end = span.end;
    } else block.lines.push(line);
    block.span.end = span.end;
  }

  private orphan(span: SourceSpan, message: string): void {
    this.diagnostics.push(diagnostic("parse.orphan-line", message, this.path, span));
  }

  /** A warning only: the Metadata still belongs to the posting. */
  private metadataAfterBreakdown(span: SourceSpan): void {
    this.diagnostics.push(
      diagnostic(
        "parse.metadata-after-breakdown",
        "a posting's Metadata should stand before its breakdown lines",
        this.path,
        span,
      ),
    );
  }

  // ---- Blocks ----

  private openBlock(ctx: ParserRuleContext, note: Token | undefined): void {
    const trailer = note ? this.note(note) : undefined;
    const span = this.lineSpan(ctx, note);
    let lines: ItemChild[] = [];
    let item: ItemData;
    let postings: PostingData[] | undefined;
    if (ctx instanceof DateLineContext) {
      const balance = ctx.balanceTail();
      if (balance) {
        // A balance takes only notes; the parser never puts a property under it.
        const notes: NoteLine[] = [];
        item = this.balance(ctx, balance, span, trailer, notes);
        lines = notes;
      } else {
        postings = [];
        item = this.transaction(ctx, span, trailer, lines, postings);
      }
    } else {
      postings = [];
      item = this.declaration(ctx, span, trailer, lines, postings);
    }
    this.block = {
      item,
      kind: item.kind,
      span,
      lines,
      ...(postings && { postings }),
      seen: new Set(),
      hasItem: false,
      hasPrecision: false,
    };
  }

  private closeBlock(): void {
    if (this.block && !this.broken) this.items.push(this.block.item);
    this.block = undefined;
    this.broken = false;
  }

  // ---- Top-level lines ----

  private transaction(
    ctx: DateLineContext,
    span: SourceSpan,
    trailer: Note | undefined,
    lines: ItemChild[],
    postings: PostingData[],
  ): TransactionData {
    const toks = this.lineTokens(ctx);
    const [first] = toks;
    if (!first) throw new BlockError("parse.syntax", "a date line needs a time");
    const time = this.timeOf(ctx.timeSpec(), true);
    const [effective, accounting] = time.split("=") as [string, string | undefined];
    const { mark, anchor, tail } = this.header(toks.slice(this.afterTime(toks)), true);
    return {
      kind: "transaction",
      span,
      ...(trailer && { trailer }),
      effective,
      ...(accounting !== undefined && { accounting }),
      ...(mark && { mark }),
      ...(anchor && { anchor }),
      ...tail,
      lines,
      postings,
    };
  }

  private balance(
    ctx: DateLineContext,
    b: BalanceTailContext,
    span: SourceSpan,
    trailer: Note | undefined,
    lines: NoteLine[],
  ): BalanceData {
    const pad = b.padClause();
    const padAmount = pad?.amount();
    const padPrice = pad?.price();
    const padAccount = pad?.WORD();
    const entity = b.ENTITY();
    identifier(accountError(this.text(b.WORD().symbol)));
    if (padAccount) identifier(accountError(this.text(padAccount.symbol)));
    if (entity) identifier(referenceError(this.text(entity.symbol).slice(1)));
    return {
      kind: "balance",
      span,
      ...(trailer && { trailer }),
      time: this.timeOf(ctx.timeSpec(), false),
      account: this.text(b.WORD().symbol),
      ...(entity && { entity: this.text(entity.symbol).slice(1) }),
      amount: this.ctxText(b.amount()),
      ...(pad && {
        pad: {
          ...(padAmount && { amount: this.ctxText(padAmount) }),
          ...(padPrice && { price: this.price(this.lineTokensOf(padPrice)) }),
          ...(padAccount && { account: this.text(padAccount.symbol) }),
        },
      }),
      lines,
    };
  }

  private declaration(
    ctx: DeclLineContext,
    span: SourceSpan,
    trailer: Note | undefined,
    lines: ItemChild[],
    postings: PostingData[],
  ): DeclarationData {
    const toks = this.lineTokens(ctx);
    const words = toks.slice(1);
    const base = { span, ...(trailer && { trailer }), lines, postings };
    const args = (kind: DeclarationKind, values: string[], extra: Partial<DeclarationData> = {}) =>
      ({ kind, args: values, ...base, ...extra }) as DeclarationData;

    if (ctx instanceof OptionDeclContext)
      return args(
        "option",
        words.map((t) => this.text(t)),
      );
    if (ctx instanceof RootDeclContext) {
      const values = words.map((t) => this.text(t));
      const [name, type, ...extra] = values;
      if (
        name === undefined ||
        type === undefined ||
        extra.length > 0 ||
        !ROOT_TYPES.includes(type)
      )
        throw new BlockError(
          "parse.syntax",
          `account-root needs a name and one of ${ROOT_TYPES.slice(0, -1).join(", ")}`,
        );
      identifier(rootError(name));
      return args("account-root", values);
    }
    if (ctx instanceof IncludeDeclContext) {
      const rest = this.propertyValue(toks);
      if (!rest) throw new BlockError("parse.syntax", "include needs a path");
      return args("include", [rest]);
    }
    if (ctx instanceof CommodityDeclContext || ctx instanceof EntityDeclContext) {
      const values = words.map((t) => this.text(t));
      if (ctx instanceof CommodityDeclContext) identifier(commodityError(values[0] ?? ""));
      return args(ctx instanceof CommodityDeclContext ? "commodity" : "entity", values);
    }
    if (ctx instanceof AccountDeclContext) {
      const anchor = ctx.ANCHOR();
      const name = this.text(ctx.WORD().symbol);
      identifier(accountError(name));
      return args("account", [name], {
        ...(anchor && { anchor: definedAnchor(this.text(anchor.symbol), false) }),
      });
    }
    if (ctx instanceof GeneratorDeclContext) {
      const [keyword, anchorToken] = toks;
      if (!keyword || !anchorToken)
        throw new BlockError("parse.syntax", "a definition needs %anchor");
      const kind = this.text(keyword) as DeclarationKind;
      const rest = toks.slice(2);
      const bad = rest.find((t) => (HEADER_ORDER.get(t.type) ?? 9) <= 1);
      if (bad) throw new BlockError("parse.syntax", `${kind} cannot have "${this.text(bad)}"`);
      return args(kind, [], {
        anchor: definedAnchor(this.text(anchorToken), false),
        tail: this.header(rest, false).tail,
      });
    }
    if (ctx instanceof CapGroupDeclContext)
      return args("cap-group", [this.ctxText(ctx.amount())], {
        anchor: definedAnchor(this.text(ctx.ANCHOR().symbol), false),
      });
    const m = ctx as ModuleDeclContext;
    const description = m.STRING();
    return args(
      "module",
      m.WORD().map((w) => this.text(w.symbol)),
      description ? { description: unquote(this.text(description.symbol)) } : {},
    );
  }

  /** Reads header tokens (after the time, or after a definition's anchor). */
  private header(
    toks: Token[],
    allowStatus: boolean,
  ): { mark?: "*" | "!" | "#"; anchor?: AnchorRef; tail: HeaderTailData } {
    const refs: string[] = [];
    const tags: TagData[] = [];
    let mark: "*" | "!" | "#" | undefined;
    let anchor: AnchorRef | undefined;
    let description: string | undefined;
    let primaryTag: TagData | undefined;
    let last = -1;
    for (const tok of toks) {
      const order = HEADER_ORDER.get(tok.type);
      if (order === undefined) continue;
      const t = this.text(tok);
      if (order < last || (order === last && !REPEATED_IN_HEADER.has(order)))
        throw new BlockError("parse.token-order", `"${t}" is out of order`);
      last = order;
      switch (tok.type) {
        case P.STAR:
        case P.BANG:
        case P.HASH:
          if (!allowStatus) throw new BlockError("parse.syntax", `"${t}" cannot be here`);
          mark = t as "*" | "!" | "#";
          break;
        case P.ANCHOR:
          anchor = definedAnchor(t, true);
          break;
        case P.STRING:
          description = unquote(t);
          break;
        case P.ENTITY:
          identifier(referenceError(t.slice(1)));
          refs.push(t.slice(1));
          break;
        case P.PRIMARY:
          primaryTag = primary(t);
          break;
        case P.TAG:
          tags.push(tag(t));
          break;
      }
    }
    return {
      ...(mark && { mark }),
      ...(anchor && { anchor }),
      tail: {
        ...(description !== undefined && { description }),
        refs,
        ...(primaryTag && { primaryTag }),
        tags,
      },
    };
  }

  // ---- Child lines ----

  private child(ctx: ParserRuleContext, note: Token | undefined): void {
    const block = this.block;
    const span = this.lineSpan(ctx, note);
    if (!block) {
      this.orphan(span, "the line belongs to no record");
      return;
    }
    const trailer = note ? this.note(note) : undefined;
    const extend = (end: number): void => {
      block.span.end = end;
    };

    if (ctx instanceof PostingLineContext) {
      if (!block.postings || (block.kind !== "transaction" && !TEMPLATE.has(block.kind)))
        throw new BlockError("parse.unexpected-property", `${block.kind} cannot have postings`);
      const lines: PostingChild[] = [];
      const posting = this.posting(ctx, span, trailer, lines, TEMPLATE.has(block.kind));
      block.postings.push(posting);
      block.posting = { data: posting, lines, span };
      block.statement = undefined;
      extend(span.end);
      return;
    }

    if (ctx instanceof SplitLineContext || ctx instanceof PaidByLineContext) {
      const posting = block.posting;
      if (!posting || block.kind !== "transaction")
        throw new BlockError(
          "parse.unexpected-property",
          "split and paid-by belong under a transaction's posting",
        );
      if (posting.lines.some((l) => l.kind === "split" || l.kind === "paid-by"))
        throw new BlockError(
          "parse.duplicate-property",
          "a posting has at most one split or paid-by",
        );
      posting.lines.push(
        ctx instanceof SplitLineContext
          ? this.split(ctx, span, trailer)
          : this.paidBy(ctx, span, trailer),
      );
      posting.span.end = span.end;
      extend(span.end);
      return;
    }

    if (ctx instanceof BreakdownLineContext) {
      const posting = block.posting;
      if (!posting) throw new BlockError("parse.orphan-line", "a breakdown line needs a posting");
      posting.lines.push(this.breakdown(ctx, span, trailer));
      posting.span.end = span.end;
      extend(span.end);
      return;
    }

    const prop = ctx as PropertyLineContext;
    const toks = this.lineTokens(prop);
    const [keyToken] = toks;
    if (!keyToken) throw new BlockError("parse.syntax", "empty property");
    const key = this.text(keyToken);
    const line: PropertyLine = {
      kind: "property",
      span,
      ...(trailer && { trailer }),
      key,
      value: this.propertyValue(toks),
    };
    if (block.kind === "account" && block.statement && STATEMENT.includes(key)) {
      block.statement.children.push(line);
      block.statement.span.end = span.end;
      extend(span.end);
      return;
    }
    if (block.posting)
      throw new BlockError("parse.unexpected-property", `"${key}" cannot come after postings`);
    const accepted = ACCEPTS[block.kind as DeclarationKind | "transaction"] ?? [];
    if (!accepted.includes(key))
      throw new BlockError("parse.unexpected-property", `${block.kind} does not take "${key}"`);
    if (block.kind === "rule" && key === "from") block.seen.clear();
    if (!REPEATABLE.has(key) && block.seen.has(key))
      throw new BlockError("parse.duplicate-property", `"${key}" is written twice`);
    block.seen.add(key);
    if (block.kind === "commodity") {
      if (key === "item") block.hasItem = true;
      if (key === "precision") block.hasPrecision = true;
      if (block.hasItem && block.hasPrecision)
        throw new BlockError("parse.unexpected-property", "an item commodity has no precision");
      if (key === "precision" && !/^\d+$/.test(line.value))
        throw new BlockError("parse.syntax", `precision must be a whole number: "${line.value}"`);
      if (key === "alias") {
        const m = /^(\S+)\s+(prefix|suffix)$/.exec(line.value);
        if (!m?.[1])
          throw new BlockError(
            "parse.syntax",
            `alias needs a text and prefix or suffix: "${line.value}"`,
          );
        identifier(aliasError(m[1]));
      }
    }
    if (block.kind === "account" && key === "primary") identifier(commodityError(line.value));
    if (key === "statement") {
      const children: ItemChild[] = [];
      block.lines.push({ ...line, children });
      block.statement = { children, span };
    } else {
      block.statement = undefined;
      block.lines.push(line);
    }
    extend(span.end);
  }

  private posting(
    ctx: PostingLineContext,
    span: SourceSpan,
    trailer: Note | undefined,
    lines: PostingChild[],
    template: boolean,
  ): PostingData {
    const toks = this.lineTokens(ctx);
    let i = 0;
    const cleared = toks[0]?.type === P.STAR;
    if (cleared) i++;
    const accountToken = toks[i++];
    if (!accountToken) throw new BlockError("parse.syntax", "a posting needs an account");
    identifier(accountError(this.text(accountToken)));

    // Up to two word tokens after the account are the amount.
    const amountStart = i;
    while (i < toks.length && i < amountStart + 2 && isWordLike(toks[i])) i++;
    const amountText = i > amountStart ? this.range(toks, amountStart, i) : undefined;

    let cost: PriceData | undefined;
    if (toks[i]?.type === P.LBRACE) {
      const close = toks.findIndex((t, k) => k > i && t.type === P.RBRACE);
      let end = close;
      while (toks[end + 1]?.type === P.RBRACE) end++;
      const open = toks[i + 1]?.type === P.LBRACE ? 2 : 1;
      const closing = end - close + 1;
      if (close < 0 || open !== closing)
        throw new BlockError("parse.syntax", "the braces of a cost do not match");
      cost = { kind: open === 2 ? "total" : "unit", amount: this.range(toks, i + open, close) };
      i = end + 1;
    }
    let price: PriceData | undefined;
    if (toks[i]?.type === P.AT || toks[i]?.type === P.AT2) {
      let end = i + 1;
      while (end < toks.length && end < i + 3 && isWordLike(toks[end])) end++;
      price = this.price(toks.slice(i, end));
      i = end;
    }

    let effective: string | undefined;
    let anchor: AnchorRef | undefined;
    const refs: string[] = [];
    const tags: TagData[] = [];
    let last = -1;
    while (i < toks.length) {
      const tok = toks[i];
      if (!tok) break;
      let order: number;
      if (tok.type === P.LBRACK) order = 0;
      else if (tok.type === P.ANCHOR) order = 1;
      else if (tok.type === P.ENTITY) order = 2;
      else if (tok.type === P.TAG) order = 3;
      else throw new BlockError("parse.syntax", `unexpected "${this.text(tok)}"`);
      if (order < last || (order <= 1 && order === last))
        throw new BlockError("parse.token-order", `"${this.text(tok)}" is out of order`);
      last = order;
      if (order === 0) {
        let depth = 0;
        let end = i;
        for (; end < toks.length; end++) {
          const type = toks[end]?.type;
          if (type === P.LBRACK) depth++;
          else if (type === P.RBRACK && --depth === 0) break;
        }
        const time = this.adjacentText(toks, i + 1, end);
        const error = timeTextError(time, false);
        if (error) throw new BlockError("parse.invalid-time", error);
        effective = time;
        i = end + 1;
        continue;
      }
      const t = this.text(tok);
      if (order === 1) {
        if (template)
          throw new BlockError("parse.syntax", "a template posting cannot define an anchor");
        anchor = definedAnchor(t, false);
      } else if (order === 2) {
        identifier(referenceError(t.slice(1)));
        refs.push(t.slice(1));
      } else tags.push(tag(t));
      i++;
    }

    const slot = template && amountText !== undefined ? slotOf(amountText) : undefined;
    return {
      span,
      ...(trailer && { trailer }),
      cleared,
      account: this.text(accountToken),
      ...(amountText !== undefined && !slot && { amount: amountText }),
      ...(cost && { cost }),
      ...(price && { price }),
      ...(effective !== undefined && { effective }),
      ...(slot && { slot }),
      ...(anchor && { anchor }),
      refs,
      tags,
      lines,
    };
  }

  private price(toks: Token[]): PriceData {
    const [at, ...amount] = toks;
    const next = at && this.tokens.get(at.tokenIndex + 1);
    if (!at || !next || next.channel !== Token.HIDDEN_CHANNEL)
      throw new BlockError("parse.syntax", "a price needs a space after @");
    if (amount.length === 0) throw new BlockError("parse.syntax", "a price needs an amount");
    return {
      kind: at.type === P.AT2 ? "total" : "unit",
      amount: this.range(amount, 0, amount.length),
    };
  }

  private split(ctx: SplitLineContext, span: SourceSpan, trailer: Note | undefined): SplitLine {
    const toks = this.lineTokens(ctx).slice(1);
    const members: SplitMemberData[] = [];
    let table: AnchorRef | undefined;
    let paidBy: string | undefined;
    let into: string | undefined;
    for (let i = 0; i < toks.length; i++) {
      const tok = toks[i];
      if (!tok) break;
      if (tok.type === P.KW_PAID_BY) {
        const entity = toks[++i];
        if (entity) paidBy = this.text(entity).slice(1);
      } else if (tok.type === P.ARROW) {
        const account = toks[++i];
        if (account) into = this.text(account);
      } else if (tok.type === P.ENTITY || tok.type === P.KW_SELF) {
        const who = tok.type === P.KW_SELF ? "self" : this.text(tok).slice(1);
        let times = false;
        let weight: string | undefined;
        const next = toks[i + 1];
        if (next?.type === P.TIMES || next?.type === P.STAR) {
          times = true;
          i++;
        }
        if (toks[i + 1]?.type === P.NUMWORD) {
          const w = toks[++i];
          if (w) weight = this.text(w);
        }
        members.push({ who, ...(weight !== undefined && { weight }), times });
      } else if (tok.type === P.WORD && members.length === 0 && !table) {
        table = { name: this.text(tok) };
      }
    }
    return {
      kind: "split",
      span,
      ...(trailer && { trailer }),
      members,
      ...(table && { table }),
      ...(paidBy !== undefined && { paidBy }),
      ...(into !== undefined && { into }),
    };
  }

  private paidBy(ctx: PaidByLineContext, span: SourceSpan, trailer: Note | undefined): PaidByLine {
    const into = ctx.WORD();
    return {
      kind: "paid-by",
      span,
      ...(trailer && { trailer }),
      entity: this.text(ctx.ENTITY().symbol).slice(1),
      ...(into && { into: this.text(into.symbol) }),
    };
  }

  private breakdown(
    ctx: BreakdownLineContext,
    span: SourceSpan,
    trailer: Note | undefined,
  ): BreakdownLine {
    if (trailer?.kind === "meta") this.metadataAfterBreakdown(span);
    // The name may contain single spaces; two or more spaces or a tab separate the figure.
    // A quoted name ends at its closing quote.
    const toks = this.lineTokens(ctx);
    const [dash, first] = toks;
    // Only a quoted name may follow `-` directly.
    if (dash && first && first.start === dash.stop + 1 && first.type !== P.STRING)
      throw new BlockError("parse.syntax", "a breakdown line needs whitespace after -");
    const body = this.rest(toks);
    const base = { kind: "breakdown" as const, span, ...(trailer && { trailer }) };
    if (body.startsWith('"')) {
      const q = /^("(?:[^"\\]|\\.)*")(?:\s+(\S.*))?$/.exec(body);
      if (!q?.[1]) throw new BlockError("parse.syntax", `"${body}" is not a breakdown line`);
      const name = unquote(q[1]);
      if (name === "") throw new BlockError("parse.syntax", "a breakdown line needs a name");
      return { ...base, name, ...(q[2] !== undefined && { figure: q[2] }) };
    }
    if (body === "") throw new BlockError("parse.syntax", "a breakdown line needs a name");
    const m = /^(.*?)(?: {2,}|\t)\s*(\S.*)$/.exec(body);
    return m?.[1] !== undefined && m[2] !== undefined
      ? { ...base, name: m[1], figure: m[2] }
      : { ...base, name: body };
  }

  // ---- Notes ----

  private note(token: Token): Note {
    return token.type === P.META ? this.meta(token) : this.comment(token);
  }

  private comment(token: Token): CommentNote {
    const raw = this.text(token).slice(1);
    return { kind: "comment", text: raw.startsWith(" ") ? raw.slice(1) : raw };
  }

  /** `;; key: value`, then its continuation lines, if any, joined with line breaks. */
  private meta(token: Token, more: Token[] = []): Note {
    const text = this.text(token);
    const m = META_KEY.exec(text.trimEnd());
    if (!m?.[2]) throw new BlockError("parse.syntax", `"${text}" is not Metadata`);
    const first = m[3] === undefined ? undefined : metaValue(m[3].trim());
    const lines = more.map((t) => {
      const body = this.text(t).slice(2).trimEnd();
      const lead = body.length - body.trimStart().length;
      return { indent: t.column + 2 + lead, value: metaValue(body.slice(lead)) };
    });
    const least = Math.min(...lines.map((l) => l.indent));
    const rest = lines.map((l) => " ".repeat(l.indent - least) + l.value);
    const all = first === undefined && rest.length > 0 ? rest : [first ?? "", ...rest];
    return { kind: "meta", key: m[2], value: all.join("\n") };
  }

  // ---- Helpers ----

  private timeOf(ctx: ParserRuleContext, allowAccounting: boolean): string {
    const text = this.ctxText(ctx);
    if (/\s/.test(text)) throw new BlockError("parse.syntax", `"${text}" cannot contain spaces`);
    const error = timeTextError(text, allowAccounting);
    if (error) throw new BlockError("parse.invalid-time", error);
    return text;
  }

  /** Index of the first header token after the time. */
  private afterTime(toks: Token[]): number {
    let i = 0;
    let depth = 0;
    for (; i < toks.length; i++) {
      const type = toks[i]?.type;
      if (type === P.LBRACK) depth++;
      else if (type === P.RBRACK) depth--;
      else if (depth === 0 && type !== P.NUMWORD && type !== P.WORD) break;
    }
    return i;
  }

  /** Default-channel tokens of a context. */
  private lineTokens(ctx: ParserRuleContext): Token[] {
    return this.lineTokensOf(ctx);
  }

  private lineTokensOf(ctx: ParserRuleContext): Token[] {
    const start = ctx.start;
    const stop = ctx.stop;
    if (!start || !stop) return [];
    const out: Token[] = [];
    for (let i = start.tokenIndex; i <= stop.tokenIndex; i++) {
      const t = this.tokens.get(i);
      if (t.channel === Token.DEFAULT_CHANNEL && t.type !== P.NL && t.type !== Token.EOF)
        out.push(t);
    }
    return out;
  }

  private text(token: Token): string {
    return this.src.slice(token.start, token.stop + 1);
  }

  /** Source text from toks[from] to toks[to - 1], spaces included. */
  private range(toks: Token[], from: number, to: number): string {
    const a = toks[from];
    const b = toks[to - 1];
    return a && b ? this.src.slice(a.start, b.stop + 1) : "";
  }

  /** Like range, but the tokens must touch each other. */
  private adjacentText(toks: Token[], from: number, to: number): string {
    const text = this.range(toks, from, to);
    if (/\s/.test(text)) throw new BlockError("parse.syntax", `"${text}" cannot contain spaces`);
    return text;
  }

  private ctxText(ctx: ParserRuleContext): string {
    const start = ctx.start;
    const stop = ctx.stop;
    return start && stop ? this.src.slice(start.start, stop.stop + 1) : "";
  }

  /** Text after the first token, trimmed. */
  private rest(toks: Token[]): string {
    return toks.length > 1 ? this.range(toks, 1, toks.length).trim() : "";
  }

  private propertyValue(toks: Token[]): string {
    const value = this.rest(toks);
    return value.length > 1 && value.startsWith('"') && value.endsWith('"')
      ? unquote(value)
      : value;
  }

  private span(ctx: ParserRuleContext): SourceSpan {
    const start = ctx.start?.start ?? 0;
    const stop = ctx.stop ?? ctx.start;
    return { start, end: (stop?.stop ?? start - 1) + 1 };
  }

  /** The line's content plus its trailer. */
  private lineSpan(ctx: ParserRuleContext, note: Token | undefined): SourceSpan {
    const span = this.span(ctx);
    return note ? { start: span.start, end: note.stop + 1 } : span;
  }

  private tokenSpan(token: Token): SourceSpan {
    return { start: token.start, end: token.stop + 1 };
  }
}

// ---------- Token text → Raw parts ----------

function isWordLike(token: Token | undefined): boolean {
  if (!token) return false;
  return (
    token.type === P.WORD ||
    token.type === P.NUMWORD ||
    (token.type >= P.KW_OPTION && token.type <= P.KW_MINIMUM)
  );
}

function slotOf(text: string): PostingData["slot"] {
  const m = /^(-?)(amount|interest|fee)$/.exec(text);
  return m?.[2]
    ? { name: m[2] as "amount" | "interest" | "fee", negated: m[1] === "-" }
    : undefined;
}

/** `%name` or `%name/period`. */
function definedAnchor(text: string, allowPeriod: boolean): AnchorRef {
  const body = text.slice(1);
  const slash = body.indexOf("/");
  if (slash < 0) return { name: anchorName(body) };
  if (!allowPeriod) throw new BlockError("parse.syntax", `"${text}" cannot have a period`);
  return { name: anchorName(body.slice(0, slash)), period: period(body.slice(slash + 1)) };
}

function anchorName(name: string): string {
  identifier(anchorError(name));
  return name;
}

/** A label (`2026`, `2026-11`, `2026-11-05`, `2026-W45`, `2026-Q4`) or a period number (`n3`). */
function period(text: string): string {
  if (text === "") throw new BlockError("parse.syntax", "an anchor's period cannot be empty");
  if (/^n[1-9]\d*$/.test(text) || /^\d{4}-Q[1-4]$/.test(text)) return text;
  if (!/^\d{4}(-(\d{2}(-\d{2})?|W\d{2}))?$/.test(text))
    throw new BlockError("parse.syntax", `"${text}" is not a period label or a period number`);
  // A label shaped like a time is checked as one: `2026-13` is an invalid time wherever it stands.
  const error = timeTextError(text, false);
  if (error) throw new BlockError("parse.invalid-time", error);
  return text;
}

/** `#x`, `#scope:x`, `#scope:x/period`, `#shared:module:x`, `#shared:module:x/period`. */
function tag(text: string): TagData {
  const body = text.slice(1);
  if (body.startsWith("#")) throw new BlockError("parse.syntax", `"${text}" is not a tag`);
  const colon = body.indexOf(":");
  const scope = colon < 0 ? undefined : body.slice(0, colon);
  if (scope !== undefined) identifier(scopeError(scope));
  const written = colon < 0 ? body : body.slice(colon + 1);
  // Only `#shared:` names a module; anchors cannot contain `:`, so the second `:` ends it.
  const moduleColon = scope === "shared" ? written.indexOf(":") : -1;
  const module = moduleColon < 0 ? undefined : anchorName(written.slice(0, moduleColon));
  const ref = written.slice(moduleColon + 1);
  const slash = ref.indexOf("/");
  const name = anchorName(slash < 0 ? ref : ref.slice(0, slash));
  return {
    ...(scope !== undefined && { scope }),
    ref: {
      ...(module !== undefined && { module }),
      name,
      ...(slash >= 0 && { period: period(ref.slice(slash + 1)) }),
    },
  };
}

/** `^x` or `^tag:x`; the scope of a primary tag can only be `tag`. */
function primary(text: string): TagData {
  const body = text.slice(1);
  const colon = body.indexOf(":");
  if (colon < 0) return { ref: { name: anchorName(body) } };
  if (body.slice(0, colon) !== "tag")
    throw new BlockError("parse.syntax", `the scope of a primary tag must be tag: "${text}"`);
  return { scope: "tag", ref: { name: anchorName(body.slice(colon + 1)) } };
}

/** `;; key: value`: 1 is everything up to the key, 2 the key, 3 the value. */
const META_KEY = /^(;;\s*)(\p{L}[\p{L}\p{N}_-]*):(?:\s+(.*))?$/u;

/** A Metadata value, or one line of it: unquoted when quoted; an unquoted `;` is an error. */
function metaValue(text: string): string {
  if (text.length > 1 && text.startsWith('"') && text.endsWith('"')) return unquote(text);
  if (text.includes(";"))
    throw new BlockError("parse.syntax", "a Metadata value with ; must be quoted");
  return text;
}

function unquote(s: string): string {
  return s.slice(1, -1).replace(/\\(["\\])/g, "$1");
}
