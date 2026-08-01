import { toAddress } from '@/core/address'
import type { ISecureStorage } from '@/core/encryption'
import { STORAGE_NAMESPACE, toStorageKey, type StorageKey } from '@/core/storage'
import { toChainId, type ChainId, type Timestamp } from '@/core/types'

import type { ITokenRepository } from './contracts'
import type { IToken, ITokenRef, TokenStandard } from './types'

/** Запись в виде, пригодном для JSON. */
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
 * Список отслеживаемых токенов в защищённом хранилище.
 *
 * ПОЧЕМУ ШИФРУЕТСЯ. Адреса контрактов публичны, но перечень токенов,
 * которые отслеживает пользователь, — это состав его портфеля.
 * Заблокированный кошелёк не должен сообщать, чем владеет владелец.
 *
 * КЛЮЧ СОДЕРЖИТ И СЕТЬ, И АДРЕС. Один и тот же адрес контракта в разных
 * сетях — разные токены; индексация только по адресу привела бы к показу
 * баланса одной сети в интерфейсе другой.
 *
 * `chainId` ХРАНИТСЯ СТРОКОЙ: это `bigint`, а `JSON.stringify` на нём
 * выбрасывает исключение, а не преобразует.
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
      /* Нативная валюта не хранится: она синтезируется из конфигурации
         сети и не может быть добавлена или убрана пользователем. */
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
    addedAt: stored.addedAt as Timestamp,
  }
}
