// Helpers used by more than one normalization step.

import type { Amount } from "../../data/model/types.js";
import { decimal, neg, rational } from "../../data/values/decimal.js";

/** Weight for balancing: cost, else price, else the amount itself; signed like the amount. */
export function weightOf(p: { amount: Amount; price?: Amount; cost?: Amount }): Amount {
  const basis = p.cost ?? p.price;
  if (!basis) return p.amount;
  const value = rational(basis.value);
  return {
    value: decimal(rational(p.amount.value).n < 0n ? neg(value) : value),
    commodity: basis.commodity,
  };
}
