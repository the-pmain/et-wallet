import type { Address, ChainId, Timestamp } from '@/core/types'

export const TOKEN_STANDARD = {
  /** Network native currency. Has no contract. */
  Native: 'native',
  Erc20: 'ERC-20',
  Erc721: 'ERC-721',
  /** Mixed standard: fungible and unique items in one contract. */
  Erc1155: 'ERC-1155',
} as const

export type TokenStandard = (typeof TOKEN_STANDARD)[keyof typeof TOKEN_STANDARD]

/**
 * A reference to a token.
 *
 * The minimum set for an unambiguous identity. The pair
 * "network + address" is required: the same contract address on
 * different networks is different tokens. Indexing by address
 * alone shows a balance from one network in another network's UI.
 */
export interface ITokenRef {
  readonly chainId: ChainId

  /** Contract address. `null` for the native currency. */
  readonly address: Address | null
}

/**
 * Token description.
 *
 * Data from the contract (`symbol`, `name`, `decimals`) is treated
 * as UNTRUSTED: the contract author sets it, and nothing stops
 * anyone from issuing a token with the symbol `USDC`. The UI must
 * tell verified tokens from the built-in list apart from ones added
 * by hand — otherwise a fake is indistinguishable from the original.
 */
export interface IToken extends ITokenRef {
  readonly standard: TokenStandard

  readonly symbol: string

  readonly name: string

  /**
   * Decimal count.
   *
   * Critical for amount correctness: USDC has 6, most tokens have
   * 18. An error in this field changes the displayed amount by
   * twelve orders of magnitude. The value must be read from the
   * contract, not assumed.
   *
   * Always 0 for ERC-721: the token is indivisible.
   */
  readonly decimals: number

  /** Logo URL. `null` if the image is unknown. */
  readonly logoUri: string | null

  /**
   * Added by the user by hand.
   *
   * The difference from the built-in list must be visible in the
   * UI: swapping the symbol of a known token is a common fraud.
   */
  readonly isCustom: boolean

  /**
   * The contract address matched the built-in verified list.
   *
   * THIS IS NOT A STORED PROPERTY, IT IS COMPUTED. The list lives
   * in code and changes with the app; a record marked verified a
   * year ago would stay that way forever — including after the
   * contract was removed from the list.
   *
   * THE MARK MEANS ONLY AN ADDRESS MATCH. It does not promise that
   * the project is sound or that the token is worth anything: the
   * wallet cannot promise that. The converse is also false —
   * absence of the mark does not mean a fake; the list is
   * deliberately incomplete.
   */
  readonly isVerified: boolean

  /** Instant it was added to the tracked set. */
  readonly addedAt: Timestamp
}

export interface IAddTokenParams {
  readonly chainId: ChainId
  readonly address: Address
  readonly standard?: TokenStandard

  /** Symbol override. By default it is read from the contract. */
  readonly symbol?: string
  readonly decimals?: number

  /**
   * Consent to add a contract that uses a verified token's name.
   *
   * Absence means refusal: adding a fake `USDC` is possible only
   * on purpose. The default is a ban because the cost of a mistake
   * here is sending funds to the wrong place.
   */
  readonly allowImpersonation?: boolean
}

/** Metadata read directly from the contract. */
export interface ITokenMetadata {
  readonly symbol: string
  readonly name: string
  readonly decimals: number
  readonly standard: TokenStandard
}

export interface TokenEventMap {
  'token:listChanged': { readonly chainId: ChainId }
}
