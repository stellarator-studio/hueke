// Identifiers, decimals and amounts (docs/core/values.md, "Amounts").

export type Id = string;
/** A decimal string such as "-12.5". */
export type Decimal = string;

export interface Amount {
  readonly value: Decimal;
  readonly commodity: Id;
}
