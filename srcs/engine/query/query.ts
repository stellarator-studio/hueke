// Queries (docs/core/query.md): filter → group → aggregate. Each clause returns a new query.

import type { Hueke } from "../hueke.js";
import { within } from "../../data/model/account.js";
import type { Id, Posting, TimeValue, Transaction } from "../../data/model/types.js";
import { matches, timeInput, type Predicate } from "../../data/time/time.js";
import { GroupedQuery, type GroupKey, type Grouped } from "./group.js";

/** A time value, or its DSL text read with the ledger's time zone. */
export type TimeInput = TimeValue | string;

interface State {
  readonly times: readonly { readonly predicate: Predicate; readonly time: TimeValue }[];
  readonly accounts?: readonly Id[];
}

export function query(ledger: Hueke): Query {
  return new Query(ledger, { times: [] });
}

export class Query implements Iterable<Transaction> {
  readonly #hueke: Hueke;
  readonly #state: State;

  constructor(hueke: Hueke, state: State) {
    this.#hueke = hueke;
    this.#state = state;
  }

  /** The transaction's time lies inside t. */
  within(t: TimeInput): Query {
    return this.#time("within", t);
  }
  /** The transaction's time is not later than t: from the start of the ledger up to t. */
  until(t: TimeInput): Query {
    return this.#time("until", t);
  }
  /** Posting level; sub-accounts included. */
  accounts(...ids: Id[]): Query {
    return new Query(this.#hueke, { ...this.#state, accounts: ids });
  }

  *[Symbol.iterator](): Iterator<Transaction> {
    for (const { transaction } of this.#matches()) yield transaction;
  }

  /** The postings that matched, in transaction order. */
  postings(): Posting[] {
    return this.#matches().flatMap((m) => m.postings);
  }

  groupBy(...keys: GroupKey[]): Grouped {
    return new GroupedQuery(
      this.#matches().flatMap((m) => m.postings),
      keys,
    );
  }

  // ---- Evaluation ----

  #time(predicate: Predicate, t: TimeInput): Query {
    const time = timeInput(t, { timezone: this.#hueke.settings.timezone });
    return new Query(this.#hueke, {
      ...this.#state,
      times: [...this.#state.times, { predicate, time }],
    });
  }

  /**
   * Matching transactions with their matched postings. hueke.transactions is already in order:
   * by time, then source position.
   */
  #matches(): { transaction: Transaction; postings: Posting[] }[] {
    const { times, accounts } = this.#state;
    const out: { transaction: Transaction; postings: Posting[] }[] = [];
    for (const t of this.#hueke.transactions) {
      if (t.occurrence !== "occurred") continue;
      if (!times.every((c) => matches(t.time, c.predicate, c.time))) continue;
      if (!accounts) {
        out.push({ transaction: t, postings: [...t.postings] });
        continue;
      }
      const hit = t.postings.filter((p) => accounts.some((a) => within(p.account, a)));
      if (hit.length > 0) out.push({ transaction: t, postings: hit });
    }
    return out;
  }
}
