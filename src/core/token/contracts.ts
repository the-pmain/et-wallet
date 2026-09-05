import type { IEventSource } from '@/core/events'
import type { Address, ChainId, Wei } from '@/core/types'

import type { IAddTokenParams, IToken, ITokenMetadata, ITokenRef, TokenEventMap } from './types'

/**
 * Managing the list of tracked tokens.
 *
 * The service reads token metadata and balances, but does not cache
 * them: caching and background refresh are `IBalanceService`'s job.
 * The split lets the token list change without re-fetching
 * balances, and balances refresh without touching the list.
 */
export interface ITokenService extends IEventSource<TokenEventMap> {
  /** Loads user tokens of every known network. */
  init(): Promise<void>

  /** Tracked tokens of a network, including the native currency. */
  list(chainId: ChainId): readonly IToken[]

  get(ref: ITokenRef): IToken | null

  /**
   * Adds a token by hand.
   *
   * The implementation must read metadata from the contract and
   * check it against what was passed. Blind trust in the user's
   * `decimals` input displays an amount that differs from the real
   * one by orders of magnitude.
   *
   * @throws InvalidTokenContractError, UnsupportedTokenStandardError
   */
  add(params: IAddTokenParams): Promise<IToken>

  /** Removes a token from the tracked set. The native currency cannot be removed. */
  remove(ref: ITokenRef): Promise<void>

  /**
   * Reads contract metadata without adding it to the list.
   *
   * Needed for a preview in the add form: the user must see what
   * token they are adding before they confirm.
   *
   * @throws InvalidTokenContractError
   */
  fetchMetadata(chainId: ChainId, address: Address): Promise<ITokenMetadata>

  /**
   * Token balance of an address, in smallest units.
   *
   * @throws InvalidTokenContractError, UnsupportedTokenStandardError
   */
  getBalance(ref: ITokenRef, owner: Address): Promise<Wei>

  /**
   * Discovers tokens that have arrived at an address.
   *
   * IMPORTANT: discovered tokens are NOT added automatically.
   * Anyone can send a bait token to an address for free, with a
   * name that copies a known project. Auto-adding turns the wallet
   * into a billboard for fraudulent names. The user decides
   * whether to add.
   */
  detect(chainId: ChainId, owner: Address): Promise<readonly ITokenMetadata[]>
}

/** Long-term storage of the user's token list. */
export interface ITokenRepository {
  findAll(chainId: ChainId): Promise<readonly IToken[]>
  find(ref: ITokenRef): Promise<IToken | null>
  save(token: IToken): Promise<void>
  delete(ref: ITokenRef): Promise<void>
}
