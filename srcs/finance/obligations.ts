// `obligations` (docs/core/obligations.md, "`obligations`"): one row per obligation and commodity,
// with its progress. Settled obligations are left out unless `all` is set.

import { obligationPlace, within } from "../data/model/account.js";
import { compareText } from "../data/model/order.js";
import type { Amount, Id, TimeValue } from "../data/model/types.js";
import { timeInput } from "../data/time/time.js";
import { decimal, sub } from "../data/values/decimal.js";
import { initialized, obligationEntitiesOf, type Hueke } from "../engine/hueke.js";
import { isSettled, progress } from "../engine/query/obligations.js";
import { compareAccounts } from "../engine/query/tree.js";
import type { TimeInput } from "../engine/query/query.js";

export interface ObligationsOptions {
  /** Obligation accounts or obligations, sub-accounts included; every obligation account if absent. */
  readonly accounts?: readonly Id[];
  /** Only obligations whose entities include it. */
  readonly entity?: Id;
  /** Count postings up to this point on the effective axis; every posting if absent. */
  readonly at?: TimeInput;
  /** Also list settled obligations. */
  readonly all?: boolean;
}

/** The progress of one obligation in one commodity. */
export interface ObligationProgress {
  readonly account: Id;
  readonly commodity: Id;
  readonly entities: readonly Id[];
  readonly original: Amount;
  readonly repaid: Amount;
  readonly remaining: Amount;
  readonly settled: boolean;
  readonly lastRepaid?: TimeValue;
  readonly postings: readonly Id[];
}

export function obligations(ledger: Hueke, options: ObligationsOptions = {}): ObligationProgress[] {
  if (!initialized(ledger)) throw new Error("obligations() before init()");
  const { timezone, weekStart } = ledger.settings;
  const at = options.at === undefined ? undefined : timeInput(options.at, { timezone, weekStart });
  const accounts = new Map(ledger.accounts.map((a) => [a.id, a]));
  const entities = obligationEntitiesOf(ledger);
  // An account given that is neither an obligation account nor inside one matches nothing.
  const given = options.accounts?.filter((a) => obligationPlace(a, accounts) !== undefined);
  const rows: ObligationProgress[] = [];
  for (const [account, byCommodity] of progress(ledger, at)) {
    if (given && !given.some((a) => within(account, a))) continue;
    const who = [...(entities.get(account) ?? [])].sort(compareText);
    if (options.entity !== undefined && !who.includes(options.entity)) continue;
    const settled = [...byCommodity].map(([c, p]) => isSettled(ledger, c, p));
    if (options.all !== true && settled.every(Boolean)) continue;
    [...byCommodity].forEach(([commodity, p], i) => {
      const amount = (value: Parameters<typeof decimal>[0]): Amount => ({
        value: decimal(value),
        commodity,
      });
      rows.push({
        account,
        commodity,
        entities: who,
        original: amount(p.original),
        repaid: amount(p.repaid),
        remaining: amount(sub(p.original, p.repaid)),
        settled: settled[i] ?? false,
        ...(p.lastRepaid && { lastRepaid: p.lastRepaid }),
        postings: p.postings.map((posting) => posting.id),
      });
    });
  }
  return rows.sort(
    (a, b) => compareAccounts(a.account, b.account) || compareText(a.commodity, b.commodity),
  );
}
