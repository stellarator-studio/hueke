// Test helpers for the use cases: the shared declarations plus a case's DSL, loaded as one file,
// or several modules of one ledger.

import { balance, check, Hueke, parse, query, type HuekeOptions } from "../../srcs/index.js";
import type { AccountTreeRow, Amount, Diagnostic, Transaction } from "../../srcs/index.js";

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
commodity camera-01
    item

account Assets:Cash
    primary NTD
account Liabilities:CardInstallments
    primary NTD
`;

export interface LedgerOptions extends HuekeOptions {
  /** Declarations before the case; the shared declarations by default. */
  readonly prelude?: string;
}

export function ledger(text: string, options: LedgerOptions = {}): Hueke {
  const { prelude = SHARED, ...rest } = options;
  const hueke = new Hueke(rest);
  const before = prelude ? withoutRedeclared(prelude, text) : "";
  hueke.load("main.hueke", parse("main.hueke", before ? `${before}\n${text}` : text));
  hueke.init("main.hueke");
  return hueke;
}

const DECLARATION = /^(commodity|account|account-root)\s+(\S+)/;

/**
 * The prelude without the commodities, accounts and account roots the case declares itself: the
 * case's declaration replaces the shared one (docs/README.md, "Shared declarations"). Settings stay.
 */
function withoutRedeclared(prelude: string, text: string): string {
  const declared = new Set<string>();
  for (const line of text.split("\n")) {
    const m = DECLARATION.exec(line.trimStart());
    if (m) declared.add(`${m[1] ?? ""} ${m[2] ?? ""}`);
  }
  const out: string[] = [];
  let dropping = false;
  for (const line of prelude.split("\n")) {
    // A top-level line starts a block; its child lines follow it.
    if (line !== "" && !/^\s/.test(line)) {
      const m = DECLARATION.exec(line);
      dropping = m !== null && declared.has(`${m[1] ?? ""} ${m[2] ?? ""}`);
    }
    if (!dropping) out.push(line);
  }
  return out.join("\n");
}

/** A ledger of several modules, initialized from `root`; the shared declarations are not added. */
export function modules(
  files: Readonly<Record<string, string>>,
  root = "main.hueke",
  options: HuekeOptions = {},
): Hueke {
  const hueke = new Hueke(options);
  for (const [path, text] of Object.entries(files)) hueke.load(path, parse(path, text));
  hueke.init(root);
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

export const descriptions = (ts: Iterable<Transaction>): (string | undefined)[] =>
  [...ts].map((t) => t.description);
