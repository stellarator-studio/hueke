// Account hierarchy (docs/core/accounts.md): an account ID names its parents, joined by `:`.

import type { Id } from "./types.js";

/** Whether `account` is `under` or one of its sub-accounts. */
export const within = (account: Id, under: Id): boolean =>
  account === under || account.startsWith(`${under}:`);
