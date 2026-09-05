import { toAddress } from '@/core/address'
import type { ISecureStorage } from '@/core/encryption'
import { STORAGE_NAMESPACE, toStorageKey, type StorageKey } from '@/core/storage'
import { toChainId, type ChainId, type Timestamp } from '@/core/types'

import type { ITokenRepository } from './contracts'
import type { IToken, ITokenRef, TokenStandard } from './types'

interface IStoredToken {
  readonly chainId: string
  readonly address: string
  readonly standard: string
  readonly symbol: string
  readonly name: string
  readonly decimals: number
  readonly logoUri: string | null
  readonly isCustom: boolean
  readonly addedAt: number
}

/**
 * Tracked-token list in secure storage.
 *
 * WHY IT IS ENCRYPTED. Contract addresses are public, but the list
 * of tokens the user tracks is the makeup of their portfolio.
 * A locked wallet must not say what the owner holds.
 *
 * THE KEY HOLDS BOTH NETWORK AND ADDRESS. The same contract address
 * on different networks is different tokens; indexing by address
 * alone would show one network's balance in another's UI.
 *
 * `chainId` IS STORED AS A STRING: it is a `bigint`, and
 * `JSON.stringify` throws on it instead of converting.
 */
export class TokenRepository implements ITokenRepository {
  readonly #storage: ISecureStorage

  constructor(storage: ISecureStorage) {
    this.#storage = storage
  }

  async findAll(chainId: ChainId): Promise<readonly IToken[]> {
    const keys = await this.#storage.keys(STORAGE_NAMESPACE.Tokens)
    const tokens: IToken[] = []

    for (const key of keys) {
      const stored = await this.#storage.get<IStoredToken>(STORAGE_NAMESPACE.Tokens, key)

      if (stored !== null && stored.chainId === chainId.toString()) {
        tokens.push(decode(stored))
      }
    }

    return tokens
  }

  async find(ref: ITokenRef): Promise<IToken | null> {
    if (ref.address === null) {
      return null
    }

    const stored = await this.#storage.get<IStoredToken>(
      STORAGE_NAMESPACE.Tokens,
      tokenKey(ref.chainId, ref.address),
    )

    return stored === null ? null : decode(stored)
  }

  async save(token: IToken): Promise<void> {
    if (token.address === null) {
      /* The native currency is not stored: it is synthesised from
         the network config and cannot be added or removed by the user. */
      return
    }

    await this.#storage.set(
      STORAGE_NAMESPACE.Tokens,
      tokenKey(token.chainId, token.address),
      encode(token),
    )
  }

  async delete(ref: ITokenRef): Promise<void> {
    if (ref.address === null) {
      return
    }

    await this.#storage.remove(STORAGE_NAMESPACE.Tokens, tokenKey(ref.chainId, ref.address))
  }
}

function tokenKey(chainId: ChainId, address: string): StorageKey {
  return toStorageKey(`token.${chainId.toString()}.${address.toLowerCase()}`)
}

function encode(token: IToken): IStoredToken {
  return {
    chainId: token.chainId.toString(),
    address: token.address ?? '',
    standard: token.standard,
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    logoUri: token.logoUri,
    isCustom: token.isCustom,
    addedAt: token.addedAt,
  }
}

function decode(stored: IStoredToken): IToken {
  return {
    chainId: toChainId(BigInt(stored.chainId)),
    address: toAddress(stored.address),
    standard: stored.standard as TokenStandard,
    symbol: stored.symbol,
    name: stored.name,
    decimals: stored.decimals,
    logoUri: stored.logoUri,
    isCustom: stored.isCustom,
    /* Verification is not written to storage: it is a property of
       the built-in list, not of the record. `TokenService` fills
       the value on read. */
    isVerified: false,
    addedAt: stored.addedAt as Timestamp,
  }
}
