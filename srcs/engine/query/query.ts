// Queries (docs/core/query.md): filter → group → aggregate. Each clause returns a new query.

import { sourceOrder, type Hueke } from "../hueke.js";
import { within } from "../../data/model/account.js";
import { timeOnAxis, transactionTime } from "../../data/model/axis.js";
import type {
  Axis,
  Id,
  Occurrence,
  Posting,
  Status,
  Tag,
  TimeValue,
  Transaction,
} from "../../data/model/types.js";
import { anchorKey } from "../../data/raw/anchor.js";
import type { AnchorRef } from "../../data/raw/model.js";
import { compareTime, matches, timeInput, type Predicate } from "../../data/time/time.js";
import { GroupedQuery, type GroupKey, type Grouped, type Hit } from "./group.js";
import { shownAccount } from "./tree.js";

/** A time value, or its DSL text read with the ledger's time zone and week start. */
export type TimeInput = TimeValue | string;
/** A tag, or its DSL text without `#`: "travel", "system:balance", "statement:card/2026-10". */
export type TagInput = Tag | { readonly scope?: string; readonly ref: AnchorRef } | string;

export interface TimeClause {
  readonly predicate: Predicate;
  readonly time: TimeValue;
}

interface State {
  readonly axis?: Axis;
  readonly times: readonly TimeClause[];
  readonly accounts?: readonly Id[];
  readonly entities?: readonly Id[];
  readonly tags?: readonly { scope: string; key: string }[];
  readonly primaryTag?: string;
  readonly occurrence: readonly Occurrence[];
  readonly status?: readonly Status[];
  readonly involves?: readonly Id[];
}

// Kept outside the class so that the public API has only the clauses of the documents.
const states = new WeakMap<Query, { readonly hueke: Hueke; readonly state: State }>();

export function query(ledger: Hueke): Query {
  return new Query(ledger, { times: [], occurrence: ["occurred"] });
}

export class Query implements Iterable<Transaction> {
  constructor(hueke: Hueke, state: State) {
    states.set(this, { hueke, state });
  }

  /** Without a call, the query uses `effective`. */
  axis(a: Axis): Query {
    return this.#with({ axis: a });
  }
  within(t: TimeInput): Query {
    return this.#time("within", t);
  }
  overlaps(t: TimeInput): Query {
    return this.#time("overlaps", t);
  }
  /** Up to t: from the start of the ledger; balances and reconciliation use it. */
  until(t: TimeInput): Query {
    return this.#time("until", t);
  }
  covers(t: TimeInput): Query {
    return this.#time("covers", t);
  }
  /** Posting level; sub-accounts included; a merged income and expense name also matches. */
  accounts(...ids: Id[]): Query {
    return this.#with({ accounts: ids });
  }
  /** Posting level, on the posting's references, else its transaction's. */
  entities(...ids: Id[]): Query {
    return this.#with({ entities: ids });
  }
  /** Posting level, on the posting's own tags plus its transaction's. */
  tags(...tags: TagInput[]): Query {
    return this.#with({ tags: tags.map(tagKey) });
  }
  /** Transaction level. */
  primaryTag(anchor: string): Query {
    return this.#with({ primaryTag: anchor });
  }
  /** Omitted: occurred only. Written: only these; without arguments, planned and cancelled. */
  occurrence(...o: ("planned" | "cancelled")[]): Query {
    return this.#with({ occurrence: o.length > 0 ? o : ["planned", "cancelled"] });
  }
  /** Posting level. */
  status(...s: Status[]): Query {
    return this.#with({ status: s });
  }
  /** Transaction level; every commodity must appear in some posting's amount (AND). */
  involves(...commodities: Id[]): Query {
    return this.#with({ involves: commodities });
  }

  *[Symbol.iterator](): Iterator<Transaction> {
    for (const { transaction } of evaluate(this).hits) yield transaction;
  }

  /** The postings that matched, ordered on the query's axis. */
  postings(): Posting[] {
    const { hueke, axis, hits } = evaluate(this);
    const order = sourceOrder(hueke);
    const out = hits.flatMap((m) =>
      m.postings.map((p) => ({ p, t: m.transaction, time: timeOnAxis(m.transaction, p, axis) })),
    );
    // The sort is stable: within a transaction, postings keep their written order.
    return out
      .sort((a, b) => compareTime(a.time, b.time) || order(a.t) - order(b.t))
      .map((x) => x.p);
  }

  groupBy(...keys: GroupKey[]): Grouped {
    const { hueke, axis, state, hits } = evaluate(this);
    return new GroupedQuery(hueke.settings.weekStart, axis, state.times, hits, keys);
  }

  #with(change: Partial<State>): Query {
    const { hueke, state } = inner(this);
    return new Query(hueke, { ...state, ...change });
  }

  #time(predicate: Predicate, t: TimeInput): Query {
    const { hueke, state } = inner(this);
    const { timezone, weekStart } = hueke.settings;
    return this.#with({
      times: [...state.times, { predicate, time: timeInput(t, { timezone, weekStart }) }],
    });
  }
}

function inner(q: Query): { readonly hueke: Hueke; readonly state: State } {
  const s = states.get(q);
  if (!s) throw new Error("a query is made with query(hueke)");
  return s;
}

/**
 * The same query as a period report with a default axis: a record whose time overlaps the period
 * shows in full, so `within` reads as `overlaps` (docs/core/query.md, "`balance`").
 */
export function periodReport(q: Query, defaultAxis: Axis): Query {
  const { hueke, state } = inner(q);
  return new Query(hueke, {
    ...state,
    axis: state.axis ?? defaultAxis,
    times: state.times.map((c) => (c.predicate === "within" ? { ...c, predicate: "overlaps" } : c)),
  });
}

/**
 * A transaction matches when one of its postings, or its empty posting, meets every clause
 * (docs/core/query.md, "Matched postings").
 */
function evaluate(q: Query): { hueke: Hueke; axis: Axis; state: State; hits: Hit[] } {
  const { hueke, state: s } = inner(q);
  const axis = s.axis ?? "effective";
  const show = shownAccount(hueke);
  const hits: Hit[] = [];
  for (const t of hueke.transactions) {
    if (!s.occurrence.includes(t.occurrence)) continue;
    if (s.primaryTag !== undefined && t.primaryTag !== s.primaryTag) continue;
    if (s.involves && !s.involves.every((c) => t.postings.some((p) => p.amount.commodity === c)))
      continue;
    if (axis !== "effective") {
      const time = transactionTime(t, axis);
      if (!s.times.every((c) => matches(time, c.predicate, c.time))) continue;
    }
    if (t.postings.length === 0) {
      // The empty posting: the transaction's values, no account and no amount.
      const empty = { status: t.status, refs: [], tags: t.tags, effective: t.effective };
      if (postingMatches(s, t, empty, axis, show)) hits.push({ transaction: t, postings: [] });
      continue;
    }
    const hit = t.postings.filter((p) => postingMatches(s, t, p, axis, show));
    if (hit.length > 0) hits.push({ transaction: t, postings: hit });
  }
  const order = sourceOrder(hueke);
  const time = (h: Hit): TimeValue => transactionTime(h.transaction, axis);
  hits.sort((a, b) => compareTime(time(a), time(b)) || order(a.transaction) - order(b.transaction));
  return { hueke, axis, state: s, hits };
}

/** What a clause reads from a posting; the empty posting has no account. */
type QueryPosting = Pick<Posting, "status" | "refs" | "tags" | "effective"> & {
  readonly account?: Id;
};

/** A posting's values in a query: its tags include its transaction's; references fall back. */
function postingMatches(
  s: State,
  t: Transaction,
  p: QueryPosting,
  axis: Axis,
  show: (account: Id) => Id,
): boolean {
  const account = p.account;
  if (
    s.accounts &&
    !s.accounts.some(
      (a) => account !== undefined && (within(account, a) || within(show(account), a)),
    )
  )
    return false;
  if (s.status && !s.status.includes(p.status)) return false;
  if (s.entities) {
    const refs = (p.refs.length > 0 ? p.refs : t.refs).map((r) => r.entity);
    if (!s.entities.some((e) => refs.includes(e))) return false;
  }
  if (s.tags) {
    const own = p.tags.map((tag) => ({ scope: tag.scope, key: anchorKey(tag.ref) }));
    if (!s.tags.some((q) => own.some((o) => o.scope === q.scope && o.key === q.key))) return false;
  }
  if (axis === "effective" && !s.times.every((c) => matches(p.effective, c.predicate, c.time)))
    return false;
  return true;
}

function tagKey(t: TagInput): { scope: string; key: string } {
  if (typeof t !== "string") return { scope: t.scope ?? "tag", key: anchorKey(t.ref) };
  const body = t.startsWith("#") ? t.slice(1) : t;
  const colon = body.indexOf(":");
  if (colon < 0) return { scope: "tag", key: body };
  // The text after the scope is written as `anchorKey` gives it, `#shared:<module>:` included.
  return { scope: body.slice(0, colon), key: body.slice(colon + 1) };
}
