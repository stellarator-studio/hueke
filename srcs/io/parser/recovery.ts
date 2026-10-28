// Error recovery (docs/dsl/lexical.md, "Error recovery"): an error never inserts or deletes
// tokens; the rest of the line is skipped, so it stays within its line and its block.

import {
  DefaultErrorStrategy,
  InputMismatchException,
  type IntervalSet,
  type Parser,
  Token,
} from "antlr4ng";
import { HuekeParser as P } from "./generated/HuekeParser.js";

export class LineRecovery extends DefaultErrorStrategy {
  private readonly expected = new Map<number, IntervalSet>();

  override recover(recognizer: Parser): void {
    const s = recognizer.inputStream;
    while (s.LA(1) !== P.NL && s.LA(1) !== Token.EOF) recognizer.consume();
  }

  override recoverInline(recognizer: Parser): Token {
    throw new InputMismatchException(recognizer);
  }

  // `file` calls sync before each decision. When the next token is not expected there (a line
  // that starts like no kind of line, or a line with extra tokens), report it and skip to the end
  // of the line, so that the error stays on this line and `file` does not end early.
  override sync(recognizer: Parser): void {
    if (recognizer.context?.ruleIndex !== P.RULE_file) return;
    const s = recognizer.inputStream;
    const la = s.LA(1);
    if (la === P.NL || la === Token.EOF) return;
    let set = this.expected.get(recognizer.state);
    if (!set) {
      set = recognizer.getExpectedTokens();
      this.expected.set(recognizer.state, set);
    }
    if (set.contains(la)) return;
    const token = s.LT(1);
    const previous = s.LT(-1);
    const lineStart = previous === null || previous.type === P.NL;
    const text = token?.text ?? "";
    recognizer.notifyErrorListeners(
      lineStart ? `cannot read the line "${text}"` : `unexpected "${text}"`,
      token,
      null,
    );
    while (s.LA(1) !== P.NL && s.LA(1) !== Token.EOF) recognizer.consume();
  }
}
