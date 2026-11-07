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
  const parts = account.split(":");
  for (let n = 1; n <= parts.length; n++) {
    const root = parts.slice(0, n).join(":");
    if (accounts.get(root)?.obligation === undefined) continue;
    if (n === parts.length) return { kind: "root", root };
    const obligation = parts.slice(0, n + 1).join(":");
    return { kind: n + 1 === parts.length ? "obligation" : "nested", root, obligation };
  }
  return undefined;
}
