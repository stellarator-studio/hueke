// Queries (docs/core/query.md): filter → group → aggregate. Each clause returns a new query.

import { obligationEntitiesOf, sourceOrder, type Hueke } from "../hueke.js";
import { entitiesOf } from "../normalize/shared.js";
import { within } from "../../data/model/account.js";
import { timeOnAxis, transactionTime } from "../../data/model/axis.js";
import type {
  Account,
  Axis,
  Breakdown,
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
/** A tag, or its DSL text written in full, with or without `#`: "tag:travel", "system:balance". */
export type TagInput = Tag | { readonly scope?: string; readonly ref: AnchorRef } | string;

/** One breakdown line, with the posting it is written under and that posting's transaction. */
export interface BreakdownLineRow {
  readonly transaction: Transaction;
  readonly posting: Posting;
  readonly line: Breakdown;
}

export interface TimeClause {
  readonly predicate: Predicate;
  readonly time: TimeValue;
}

interface State {
  readonly axis?: Axis;
  readonly times: readonly TimeClause[];
  readonly ids?: readonly Id[];
  readonly accounts?: readonly Id[];
  readonly entities?: readonly Id[];
  readonly tags?: readonly { scope: string; key: string }[];
  readonly primaryTag?: string;
  readonly occurrence: readonly Occurrence[];
  readonly status?: readonly Status[];
  readonly breakdown?: readonly string[];
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
  /** A transaction's ID at transaction level, a posting's ID at posting level. */
  ids(...ids: Id[]): Query {
    return this.#with({ ids });
  }
  /** Posting level; sub-accounts included; a merged income and expense name also matches. */
  accounts(...ids: Id[]): Query {
    return this.#with({ accounts: ids });
  }
  /** Posting level, on the posting's references, else its transaction's; see `entitiesOf`. */
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
  /** Posting level: the posting has a breakdown line with one of the names, as written. */
  breakdown(...names: string[]): Query {
    return this.#with({ breakdown: names });
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
    return orderedPostings(evaluate(this)).map((x) => x.posting);
  }

  /**
   * The breakdown lines of the matched postings, postings in order and lines as written; with a
   * `breakdown` clause, only the lines it names (docs/core/query.md, "Breakdown lines").
   */
  breakdownLines(): BreakdownLineRow[] {
    const e = evaluate(this);
    const names = e.state.breakdown;
    return orderedPostings(e).flatMap(({ transaction, posting }) =>
      posting.breakdown
        .filter((line) => names === undefined || names.includes(line.name))
        .map((line) => ({ transaction, posting, line })),
    );
  }

  groupBy(...keys: GroupKey[]): Grouped {
    const { hueke, axis, state, hits, read } = evaluate(this);
    // A key given twice counts once (docs/core/query.md, "Grouping").
    const unique = [...new Set(keys)];
    return new GroupedQuery(hueke.settings.weekStart, axis, state.times, hits, unique, (t, p) =>
      entitiesOf(t, p, read.accounts, read.obligations),
    );
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

/** The matched postings with their transactions, ordered on the query's axis. */
function orderedPostings({
  hueke,
  axis,
  hits,
}: ReturnType<typeof evaluate>): { transaction: Transaction; posting: Posting }[] {
  const order = sourceOrder(hueke);
  const out = hits.flatMap((m) =>
    m.postings.map((posting) => ({
      transaction: m.transaction,
      posting,
      time: timeOnAxis(m.transaction, posting, axis),
    })),
  );
  // The sort is stable: within a transaction, postings keep their written order.
  return out
    .sort((a, b) => compareTime(a.time, b.time) || order(a.transaction) - order(b.transaction))
    .map(({ transaction, posting }) => ({ transaction, posting }));
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
/** The end of the query's range: the time clause that ends first; none without one. */
export function rangeEnd(q: Query): TimeValue | undefined {
  let end: TimeValue | undefined;
  for (const c of inner(q).state.times) if (!end || c.time.end < end.end) end = c.time;
  return end;
}

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
function evaluate(q: Query): {
  hueke: Hueke;
  axis: Axis;
  state: State;
  hits: Hit[];
  read: Reader;
} {
  const { hueke, state: s } = inner(q);
  const axis = s.axis ?? "effective";
  const show = shownAccount(hueke);
  const read: Reader = {
    show,
    accounts: new Map(hueke.accounts.map((a) => [a.id, a])),
    obligations: obligationEntitiesOf(hueke),
  };
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
      const empty = {
        status: t.status,
        refs: [],
        tags: t.tags,
        effective: t.effective,
        breakdown: [],
      };
      if (postingMatches(s, t, empty, axis, read)) hits.push({ transaction: t, postings: [] });
      continue;
    }
    const hit = t.postings.filter((p) => postingMatches(s, t, p, axis, read));
    if (hit.length > 0) hits.push({ transaction: t, postings: hit });
  }
  const order = sourceOrder(hueke);
  const time = (h: Hit): TimeValue => transactionTime(h.transaction, axis);
  hits.sort((a, b) => compareTime(time(a), time(b)) || order(a.transaction) - order(b.transaction));
  return { hueke, axis, state: s, hits, read };
}

/** What a clause reads from a posting; the empty posting has no account. */
type QueryPosting = Pick<Posting, "status" | "refs" | "tags" | "effective" | "breakdown"> & {
  readonly id?: Id;
  readonly account?: Id;
};

/** What reading a posting needs from the ledger. */
interface Reader {
  readonly show: (account: Id) => Id;
  readonly accounts: ReadonlyMap<Id, Account>;
  readonly obligations: ReturnType<typeof obligationEntitiesOf>;
}

/** A posting's values in a query: its tags include its transaction's; references fall back. */
function postingMatches(
  s: State,
  t: Transaction,
  p: QueryPosting,
  axis: Axis,
  { show, accounts, obligations }: Reader,
): boolean {
  const account = p.account;
  if (s.ids && !s.ids.includes(t.id) && !(p.id !== undefined && s.ids.includes(p.id))) return false;
  if (
    s.accounts &&
    !s.accounts.some(
      (a) => account !== undefined && (within(account, a) || within(show(account), a)),
    )
  )
    return false;
  if (s.status && !s.status.includes(p.status)) return false;
  const names = s.breakdown;
  if (names && !p.breakdown.some((line) => names.includes(line.name))) return false;
  if (s.entities) {
    const refs = entitiesOf(t, p, accounts, obligations);
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
  if (colon < 0)
    throw new Error(`query.tag-without-scope: "${t}": write a tag in full, such as "tag:${body}"`);
  // The text after the scope is written as `anchorKey` gives it, `#shared:<module>:` included.
  return { scope: body.slice(0, colon), key: body.slice(colon + 1) };
}
