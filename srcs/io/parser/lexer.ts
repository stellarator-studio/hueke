// Hand-written lexer. Emits the same tokens as the lexer rules of Hueke.g4 and feeds the
// generated parser. ANTLR's lexer DFA only caches ASCII, so every CJK character would go through
// ATN simulation; the lexical rules are simple enough to hand-write and much faster.
// Token start and stop are JS string (UTF-16) offsets.

import {
  CommonToken,
  CommonTokenFactory,
  Token,
  type CharStream,
  type TokenFactory,
  type TokenSource,
} from "antlr4ng";
import { HuekeLexer as L } from "./generated/HuekeLexer.js";

const KEYWORDS = new Map<string, number>();
L.literalNames.forEach((literal, type) => {
  if (literal && /^'[a-z-]+'$/.test(literal)) KEYWORDS.set(literal.slice(1, -1), type);
});

// WORD_CHAR: not [ \t\r\n;"[\]{}]. WORD_START: a WORD_CHAR that is not one of %#^@*×!- or a digit.
// Inside a word, a parenthesized group closed on the same line is part of the word, whitespace
// included, so `(100 + 50) NTD` is two tokens (GROUP in Hueke.g4).
const codes = (s: string): number[] => Array.from({ length: s.length }, (_, i) => s.charCodeAt(i));
const NOT_WORD = new Set(codes(' \t\r\n;"[]{}'));
const NOT_START = new Set(codes("%#^@*×!-0123456789"));
const NOT_IN_GROUP = new Set(codes('\r\n;"[]{}'));
const isWordChar = (c: number): boolean => !Number.isNaN(c) && !NOT_WORD.has(c);
const isWordStart = (c: number): boolean => isWordChar(c) && !NOT_START.has(c);
const isDigit = (c: number): boolean => c >= 48 && c <= 57;
const LETTER = /^[\p{L}_]/u;

/** Channel of comments and Metadata, kept out of the parser. */
export const NOTE_CHANNEL = 2;

export type LexError = (offset: number, message: string) => void;

export class HandLexer implements TokenSource {
  line = 1;
  column = 0;
  inputStream: CharStream | null = null;
  sourceName = "hueke";
  // antlr4ng declares CommonToken.text as optional, which exactOptionalPropertyTypes rejects
  tokenFactory = CommonTokenFactory.DEFAULT as unknown as TokenFactory<Token>;
  private pos = 0;
  private lineStart = 0;
  private readonly source: [TokenSource | null, CharStream | null] = [this, null];

  constructor(
    private readonly text: string,
    private readonly onError?: LexError,
  ) {}

  nextToken(): Token {
    const s = this.text;
    for (;;) {
      const start = this.pos;
      if (start >= s.length) return this.make(Token.EOF, start, start - 1);
      const c = s.charCodeAt(start);
      let type: number;
      let end = start + 1;
      let channel = Token.DEFAULT_CHANNEL;

      if (c === 10 || (c === 13 && s.charCodeAt(start + 1) === 10)) {
        end = c === 13 ? start + 2 : start + 1;
        const token = this.make(L.NL, start, end - 1);
        this.pos = end;
        this.line++;
        this.lineStart = end;
        return token;
      } else if (c === 32 || c === 9) {
        while (end < s.length && (s.charCodeAt(end) === 32 || s.charCodeAt(end) === 9)) end++;
        type = L.WS;
        channel = Token.HIDDEN_CHANNEL;
      } else if (c === 59) {
        // ;
        type = s.charCodeAt(start + 1) === 59 ? L.META : L.COMMENT;
        channel = NOTE_CHANNEL;
        while (end < s.length && !this.atNewline(end)) end++;
      } else if (c === 34) {
        // "
        type = L.BAD_STRING;
        while (end < s.length) {
          const d = s.charCodeAt(end);
          if (d === 92 && (s.charCodeAt(end + 1) === 34 || s.charCodeAt(end + 1) === 92)) {
            end += 2;
            continue;
          }
          if (d === 34) {
            end++;
            type = L.STRING;
            break;
          }
          if (d === 10 || d === 13 || d === 92) break;
          end++;
        }
      } else if (c === 37 || c === 35 || c === 94) {
        // % # ^
        while (end < s.length && isWordChar(s.charCodeAt(end))) end++;
        if (end > start + 1) type = c === 37 ? L.ANCHOR : c === 35 ? L.TAG : L.PRIMARY;
        else if (c === 35) type = L.HASH;
        else {
          this.error(start);
          continue;
        }
      } else if (c === 64) {
        // @
        if (s.charCodeAt(start + 1) === 64) {
          type = L.AT2;
          end = start + 2;
        } else if (LETTER.test(s.slice(start + 1, start + 3))) {
          while (end < s.length && isWordChar(s.charCodeAt(end))) end++;
          type = L.ENTITY;
        } else type = L.AT;
      } else if (c === 42) type = L.STAR;
      else if (c === 0xd7) type = L.TIMES;
      else if (c === 33) type = L.BANG;
      else if (c === 91) type = L.LBRACK;
      else if (c === 93) type = L.RBRACK;
      else if (c === 123) type = L.LBRACE;
      else if (c === 125) type = L.RBRACE;
      else if (c === 45) {
        // -
        const n = s.charCodeAt(start + 1);
        if (isDigit(n) || isWordStart(n)) {
          end = this.word(start + 1);
          // `->` with nothing after it is ARROW (as in ANTLR: on equal length the first rule wins)
          type =
            n === 62 && end === start + 2
              ? L.ARROW
              : isDigit(n) || this.group(start + 1) > start + 2
                ? L.NUMWORD
                : L.WORD;
        } else type = L.DASH;
      } else if (isDigit(c) || (c === 40 && this.group(start) > start + 1)) {
        end = this.word(start);
        type = L.NUMWORD;
      } else if (isWordStart(c)) {
        end = this.word(start);
        type = KEYWORDS.get(s.slice(start, end)) ?? L.WORD;
      } else {
        this.error(start);
        continue;
      }

      this.pos = end;
      return this.make(type, start, end - 1, channel);
    }
  }

  /** The end of a word starting at `at`. */
  private word(at: number): number {
    const s = this.text;
    let end = at;
    while (end < s.length && isWordChar(s.charCodeAt(end)))
      end = s.charCodeAt(end) === 40 ? this.group(end) : end + 1;
    return end;
  }

  /** The offset after the `)` closing the `(` at `at` on the same line, or `at + 1` if none. */
  private group(at: number): number {
    const s = this.text;
    let depth = 0;
    for (let i = at; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (NOT_IN_GROUP.has(c)) break;
      if (c === 40) depth++;
      else if (c === 41 && --depth === 0) return i + 1;
    }
    return at + 1;
  }

  private atNewline(at: number): boolean {
    const c = this.text.charCodeAt(at);
    return c === 10 || (c === 13 && this.text.charCodeAt(at + 1) === 10);
  }

  private make(type: number, start: number, stop: number, channel = Token.DEFAULT_CHANNEL): Token {
    const token = CommonToken.fromSource(this.source, type, channel, start, stop);
    token.line = this.line;
    token.column = start - this.lineStart;
    token.text = type === Token.EOF ? "<EOF>" : this.text.slice(start, stop + 1);
    return token as unknown as Token;
  }

  private error(at: number): void {
    this.onError?.(at, `unexpected character '${this.text.charAt(at)}'`);
    this.pos = at + 1;
  }
}
