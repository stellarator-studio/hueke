// Test helpers for the use cases: the shared declarations plus a case's DSL, loaded as one file.

import { balance, check, Hueke, parse, query, type HuekeOptions } from "../../srcs/index.js";
import type { AccountTreeRow, Amount, Diagnostic } from "../../srcs/index.js";

/** The shared declarations of the use cases. */
export const SHARED = `option timezone Asia/Taipei

; Rule: declaration properties take no colon; metadata is written ";; key: value"

account-root Bank asset

commodity NTD
    precision 0
commodity JPY
    precision 0
commodity USD
    precision 2
commodity AAPL
    precision 0
`;

export interface LedgerOptions extends HuekeOptions {
  /** Declarations before the case; the shared declarations by default. */
  readonly prelude?: string;
}

export function ledger(text: string, options: LedgerOptions = {}): Hueke {
  const { prelude = SHARED, ...rest } = options;
  const hueke = new Hueke(rest);
  hueke.load("main.hueke", parse("main.hueke", prelude ? `${prelude}\n${text}` : text));
  hueke.init("main.hueke");
  return hueke;
}

/** Diagnostic codes, without info-level hints unless asked. */
export function codes(hueke: Hueke, withInfo = false): string[] {
  return check(hueke)
    .filter((d: Diagnostic) => withInfo || d.severity !== "info")
    .map((d) => d.code);
}

/** The balance of one account in one commodity, as a number-like decimal string. */
export function balanceOf(hueke: Hueke, account: string, at: string, commodity = "NTD"): string {
  const rows = balance(hueke, query(hueke).accounts(account).until(at));
  const row = rows.find((r) => r.account === account && !r.subtotal);
  return row?.amounts.find((a: Amount) => a.commodity === commodity)?.value ?? "0";
}

/** Account tree rows (own postings only), as "account value commodity". */
export function rows(tree: readonly AccountTreeRow[]): string[] {
  return tree
    .filter((r) => !r.subtotal)
    .flatMap((r) => r.amounts.map((a) => `${r.account} ${a.value} ${a.commodity}`));
}
