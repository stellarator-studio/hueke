// Account hierarchy (docs/core/accounts.md): an account ID names its parents, joined by `:`.

import type { Id } from "./types.js";

/** Whether `account` is `under` or one of its sub-accounts. */
export const within = (account: Id, under: Id): boolean =>
  account === under || account.startsWith(`${under}:`);

/** Where an account stands among obligations (docs/core/obligations.md, "Obligation accounts"). */
export type ObligationPlace =
  | { readonly kind: "root"; readonly root: Id } // the obligation account itself
  | { readonly kind: "obligation"; readonly root: Id; readonly obligation: Id }
  | { readonly kind: "nested"; readonly root: Id; readonly obligation: Id };

/**
 * The obligation account `account` is in, if any: its outermost ancestor, itself included, that
 * has `obligation`. Obligation accounts are always declared, so `accounts` holds them.
 */
export function obligationPlace(
  account: Id,
  accounts: ReadonlyMap<Id, { readonly obligation?: string }>,
): ObligationPlace | undefined {
  // Each ancestor in turn, outermost first, ending at the account itself; it runs for every
  // posting, so the name is cut at its separators rather than split and joined again.
  for (let end = account.indexOf(":"); ; end = account.indexOf(":", end + 1)) {
    const root = end === -1 ? account : account.slice(0, end);
    if (accounts.get(root)?.obligation !== undefined) {
      if (end === -1) return { kind: "root", root };
      const next = account.indexOf(":", end + 1);
      const obligation = next === -1 ? account : account.slice(0, next);
      return { kind: next === -1 ? "obligation" : "nested", root, obligation };
    }
    if (end === -1) return undefined;
  }
}
