declare const brandSymbol: unique symbol

/**
 * Nominal typing on top of TypeScript's structural system.
 *
 * Why a wallet needs this: `string` is too wide for an address, a
 * private key, and a transaction hash. Without branding the compiler
 * would allow passing a private key where an address is expected —
 * both are strings. Branded types make that a compile error.
 *
 * Concrete types (`Address`, `TxHash`, and so on) are declared in
 * their domain modules. This file is only the base mechanism.
 *
 * @example
 * type Address = Brand<string, 'Address'>
 */
export type Brand<TValue, TBrand extends string> = TValue & {
  readonly [brandSymbol]: TBrand
}
