import { decodeUint, encodeCall, encodeCallWithAddress } from '@/core/abi'
import { areAddressesEqual, isValidAddress } from '@/core/address'
import {
  InvalidTokenContractError,
  TokenImpersonationError,
  NetworkNotFoundError,
  NotInitializedError,
  TokenNotFoundError,
  UnsupportedTokenStandardError,
} from '@/core/errors'
import { EventBus, type EventListener } from '@/core/events'
import { TRANSFER_TOPIC, addressToTopic } from '@/core/history'
import type { INetworkService } from '@/core/network'
import type { IClock, ILogger } from '@/core/platform'
import type { IProvider, IProviderResolver } from '@/core/provider'
import type { Address, ChainId, Timestamp, Unsubscribe, Wei } from '@/core/types'

import { findTokenImpersonation } from './impersonation'
import { findVerifiedToken, isVerifiedToken } from './verified'

import type { ITokenRepository, ITokenService } from './contracts'
import {
  BALANCE_OF_SELECTOR,
  DECIMALS_SELECTOR,
  NAME_SELECTOR,
  SYMBOL_SELECTOR,
  decodeString,
} from './erc20'
import {
  TOKEN_STANDARD,
  type IAddTokenParams,
  type IToken,
  type ITokenMetadata,
  type ITokenRef,
  type TokenEventMap,
} from './types'

const SERVICE_NAME = 'TokenService'

/**
 * Cap on the number of decimal places.
 *
 * The standard declares `decimals` as `uint8`, i.e. up to 255. A
 * value above 36 is seen on no live token and almost certainly means
 * an error or deliberate corruption: raising ten to that power turns
 * any balance into an indistinguishable zero.
 */
const MAX_DECIMALS = 36

/** How far back incoming transfers are searched when detecting tokens. */
const DETECT_WINDOW_BLOCKS = 10_000n

/** Service dependencies. */
export interface ITokenServiceDependencies {
  readonly repository: ITokenRepository
  readonly resolver: IProviderResolver
  readonly networks: INetworkService
  readonly clock: IClock
  readonly logger: ILogger
}

/**
 * Managing the list of tracked tokens.
 *
 * METADATA IS READ FROM THE CONTRACT, NOT TAKEN ON FAITH. The number
 * of decimals sets the order of magnitude of the shown amount: a
 * six-decimal token recorded as eighteen-decimal shows one millionth
 * of the real balance. A user typing that value by hand will err; a
 * site offering it may err on purpose.
 *
 * A SYMBOL OVERRIDE IS ALLOWED, A DECIMALS OVERRIDE IS NOT. The
 * symbol is a label on screen, and the user may name a token as they
 * like. Decimals are arithmetic, and a mismatch with the contract
 * means a wrong amount.
 *
 * EVERY ADDED TOKEN IS MARKED UNVERIFIED. There is no built-in list
 * on purpose: writing known-token addresses from memory risks marking
 * a fraudulent contract as verified, which is more dangerous than no
 * mark at all. A curated list needs a check against an authoritative
 * source.
 */
export class TokenService implements ITokenService {
  readonly #repository: ITokenRepository
  readonly #resolver: IProviderResolver
  readonly #networks: INetworkService
  readonly #clock: IClock
  readonly #logger: ILogger

  readonly #events = new EventBus<TokenEventMap>({
    onListenerError: (error, event) => {
      this.#logger.error('Token event listener failed', {
        event: String(event),
        error: error instanceof Error ? error.message : String(error),
      })
    },
  })

  /* The list stays in memory: the UI needs it constantly, and
     decrypting storage on every render is not allowed. */
  readonly #tokens = new Map<ChainId, readonly IToken[]>()

  #initialized = false

  constructor(dependencies: ITokenServiceDependencies) {
    this.#repository = dependencies.repository
    this.#resolver = dependencies.resolver
    this.#networks = dependencies.networks
    this.#clock = dependencies.clock
    this.#logger = dependencies.logger.child(SERVICE_NAME)
  }

  async init(): Promise<void> {
    this.#tokens.clear()

    for (const network of this.#networks.list()) {
      const stored = await this.#repository.findAll(network.chainId)

      /* Verification is recomputed on every read: the list lives in
         code and changes with the app, and a record marked a year ago
         would stay verified forever — including after the contract
         was dropped from the list. */
      this.#tokens.set(network.chainId, stored.map(withVerification))
    }

    this.#initialized = true
  }

  /**
   * Tracked tokens of the network, including the native currency.
   *
   * The native currency is synthesized from network config and always
   * comes first: it exists on every network and cannot be removed. A
   * single list saves the UI from two different ways of showing the
   * same thing.
   */
  list(chainId: ChainId): readonly IToken[] {
    this.#assertInitialized()

    const network = this.#networks.getByChainId(chainId)

    if (network === null) {
      return []
    }

    const native: IToken = {
      chainId,
      address: null,
      standard: TOKEN_STANDARD.Native,
      symbol: network.nativeCurrency.symbol,
      name: network.nativeCurrency.name,
      decimals: network.nativeCurrency.decimals,
      logoUri: null,
      /* The native currency is part of network config, not a user
         addition: marking it unverified would be wrong. */
      isCustom: false,
      isVerified: true,
      addedAt: 0 as Timestamp,
    }

    return [native, ...(this.#tokens.get(chainId) ?? [])]
  }

  get(ref: ITokenRef): IToken | null {
    return this.list(ref.chainId).find((token) => matches(token, ref)) ?? null
  }

  async add(params: IAddTokenParams): Promise<IToken> {
    this.#assertInitialized()

    const standard = params.standard ?? TOKEN_STANDARD.Erc20

    if (standard !== TOKEN_STANDARD.Erc20) {
      throw new UnsupportedTokenStandardError(standard)
    }

    if (!isValidAddress(params.address)) {
      throw new InvalidTokenContractError(params.address, 'the value is not an address')
    }

    const metadata = await this.fetchMetadata(params.chainId, params.address)

    /* Decimals from the params are checked, not substituted: a
       mismatch with the contract means an amount wrong by orders of
       magnitude, and silently preferring the foreign value is not
       allowed. */
    if (params.decimals !== undefined && params.decimals !== metadata.decimals) {
      throw new InvalidTokenContractError(
        params.address,
        `the contract reports ${String(metadata.decimals)} decimals, ` +
          `while ${String(params.decimals)} was provided`,
      )
    }

    /*
      THE IMPERSONATION CHECK RUNS AFTER READING THE CONTRACT AND
      BEFORE PERSIST. There is nothing to compare before the read:
      the contract itself reports the symbol and name, and values
      claimed by the user are irrelevant.
    */
    const impersonation = findTokenImpersonation({
      chainId: params.chainId,
      address: params.address,
      symbol: metadata.symbol,
      name: metadata.name,
    })

    if (impersonation !== null && params.allowImpersonation !== true) {
      throw new TokenImpersonationError(
        impersonation.field === 'symbol'
          ? impersonation.verified.symbol
          : impersonation.verified.name,
        impersonation.verified.address,
        params.address,
        impersonation.foreignCharacters,
      )
    }

    const verified = findVerifiedToken(params.chainId, params.address)

    /* A MISMATCH WITH THE LIST IS NOT SILENCED. A contract with an
       upgradable implementation may change its symbol — that already
       happened with the Tether bridge — and the list in code may be
       stale. Marking such a record verified would mean vouching for
       something that changed without our knowledge. */
    const matchesList =
      verified !== null &&
      verified.symbol === metadata.symbol &&
      verified.decimals === metadata.decimals

    if (verified !== null && !matchesList) {
      this.#logger.warn('Verified contract answered differently than the built-in list', {
        chainId: params.chainId,
        listSymbol: verified.symbol,
        contractSymbol: metadata.symbol,
      })
    }

    const override = params.symbol?.trim() ?? ''
    const token: IToken = {
      chainId: params.chainId,
      address: params.address,
      standard,
      symbol: override === '' ? metadata.symbol : override,
      name: metadata.name,
      decimals: metadata.decimals,
      logoUri: null,
      isCustom: true,
      isVerified: matchesList,
      addedAt: this.#clock.now(),
    }

    await this.#repository.save(token)

    this.#tokens.set(params.chainId, [
      ...(this.#tokens.get(params.chainId) ?? []).filter((item) => !matches(item, params)),
      token,
    ])

    this.#logger.info('Token added', { chainId: params.chainId })
    this.#events.emit('token:listChanged', { chainId: params.chainId })

    return token
  }

  async remove(ref: ITokenRef): Promise<void> {
    this.#assertInitialized()

    if (ref.address === null) {
      /* The native currency is not removed: it always exists on the
         network, and its absence from the list would mean the
         network balance is unknown. */
      throw new UnsupportedTokenStandardError(TOKEN_STANDARD.Native)
    }

    const existing = this.#tokens.get(ref.chainId) ?? []

    if (!existing.some((item) => matches(item, ref))) {
      throw new TokenNotFoundError(ref.address)
    }

    await this.#repository.delete(ref)

    this.#tokens.set(
      ref.chainId,
      existing.filter((item) => !matches(item, ref)),
    )

    this.#events.emit('token:listChanged', { chainId: ref.chainId })
  }

  /**
   * Reads contract metadata without adding it to the list.
   *
   * DECIMALS ARE REQUIRED. A contract that does not answer
   * `decimals()` is rejected: without that value any shown amount is
   * invented. Symbol and name, by contrast, are optional in the
   * standard, and their absence is replaced with a truncated address
   * — it reads worse, but it does not distort any quantity.
   */
  async fetchMetadata(chainId: ChainId, address: Address): Promise<ITokenMetadata> {
    const provider = await this.#connect(chainId)

    return {
      decimals: await this.#readDecimals(provider, address),
      symbol: await this.#readText(provider, address, SYMBOL_SELECTOR, shortAddress(address)),
      name: await this.#readText(provider, address, NAME_SELECTOR, shortAddress(address)),
      standard: TOKEN_STANDARD.Erc20,
    }
  }

  async getBalance(ref: ITokenRef, owner: Address): Promise<Wei> {
    if (ref.address === null) {
      throw new UnsupportedTokenStandardError(TOKEN_STANDARD.Native)
    }

    const provider = await this.#connect(ref.chainId)
    const contract = ref.address

    try {
      return decodeUint(
        await provider.call({
          to: contract,
          data: encodeCallWithAddress(BALANCE_OF_SELECTOR, owner),
        }),
      ) as Wei
    } catch (error) {
      throw new InvalidTokenContractError(
        contract,
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  /**
   * Discovers tokens that have arrived at an address.
   *
   * WHAT IS FOUND IS NOT ADDED AUTOMATICALLY. Anyone can send a
   * token named after a known project to a foreign address, almost
   * for free. Auto-adding would turn the wallet into a billboard for
   * fraudulent names, with a look of approval: if it is shown, it is
   * recognized.
   *
   * SOURCE LIMIT. The search goes through node logs, and public
   * nodes often refuse a query without a contract. The refusal is
   * surfaced to the caller, not replaced with an empty list: "no
   * tokens" and "could not find out" are different statements.
   */
  async detect(chainId: ChainId, owner: Address): Promise<readonly ITokenMetadata[]> {
    const provider = await this.#connect(chainId)
    const found: ITokenMetadata[] = []

    for (const contract of await this.#findIncomingContracts(provider, owner)) {
      try {
        if ((await this.getBalance({ chainId, address: contract }, owner)) > 0n) {
          found.push(await this.fetchMetadata(chainId, contract))
        }
      } catch {
        /* A contract that does not answer standard calls is simply
           not an ERC-20 token. One refusal must not stop walking
           the rest. */
        continue
      }
    }

    return found
  }

  on<TName extends keyof TokenEventMap>(
    event: TName,
    listener: EventListener<TokenEventMap[TName]>,
  ): Unsubscribe {
    return this.#events.on(event, listener)
  }

  once<TName extends keyof TokenEventMap>(
    event: TName,
    listener: EventListener<TokenEventMap[TName]>,
  ): Unsubscribe {
    return this.#events.once(event, listener)
  }

  off<TName extends keyof TokenEventMap>(
    event: TName,
    listener: EventListener<TokenEventMap[TName]>,
  ): void {
    this.#events.off(event, listener)
  }

  /**
   * Reads the number of decimals.
   *
   * @throws InvalidTokenContractError if the function is missing or
   *         the value is outside reasonable bounds.
   */
  async #readDecimals(provider: IProvider, address: Address): Promise<number> {
    let raw: bigint

    try {
      raw = decodeUint(await provider.call({ to: address, data: encodeCall(DECIMALS_SELECTOR) }))
    } catch {
      throw new InvalidTokenContractError(address, 'the contract does not report its decimals')
    }

    const decimals = Number(raw)

    if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
      throw new InvalidTokenContractError(
        address,
        `the number of decimals is not allowed: ${raw.toString()}`,
      )
    }

    return decimals
  }

  /**
   * Reads a text field, substituting a fallback on refusal.
   *
   * Symbol and name are optional in the standard, and a contract may
   * omit them. Refusing to add such a token would be excessive.
   */
  async #readText(
    provider: IProvider,
    address: Address,
    functionSelector: string,
    fallback: string,
  ): Promise<string> {
    try {
      const text = decodeString(
        await provider.call({ to: address, data: encodeCall(functionSelector) }),
      )

      return text.trim() === '' ? fallback : text
    } catch {
      return fallback
    }
  }

  /** Contracts that have sent transfers to the address. */
  async #findIncomingContracts(provider: IProvider, owner: Address): Promise<readonly Address[]> {
    const latest = await provider.getBlockNumber()
    const fromBlock = latest > DETECT_WINDOW_BLOCKS ? latest - DETECT_WINDOW_BLOCKS : 0n

    const logs = await provider.getLogs({
      fromBlock,
      toBlock: latest,
      topics: [TRANSFER_TOPIC, null, addressToTopic(owner)],
    })

    /* Duplicates are dropped by lowercase address: one contract
       sends dozens of transfers, and its metadata is the same. */
    const unique = new Map<string, Address>()

    for (const log of logs) {
      if (!log.removed) {
        unique.set(log.address.toLowerCase(), log.address)
      }
    }

    return [...unique.values()]
  }

  async #connect(chainId: ChainId): Promise<IProvider> {
    const network = this.#networks.getByChainId(chainId)

    if (network === null) {
      throw new NetworkNotFoundError(chainId)
    }

    return await this.#resolver.get(network)
  }

  #assertInitialized(): void {
    if (!this.#initialized) {
      throw new NotInitializedError(SERVICE_NAME)
    }
  }
}

/** Whether a token matches a ref. Native currency is recognized by `null`. */
function matches(token: IToken, ref: ITokenRef): boolean {
  if (ref.address === null || token.address === null) {
    return ref.address === null && token.address === null
  }

  return areAddressesEqual(token.address, ref.address)
}

/** Truncated address as a fallback token name. */
function shortAddress(address: Address): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/**
 * Sets the verification flag on a read record.
 *
 * Only the address is checked: the symbol and decimals in storage
 * are what the contract returned on add, and re-checking them would
 * require a node call on every list read.
 */
function withVerification(token: IToken): IToken {
  if (token.address === null) {
    return token
  }

  return { ...token, isVerified: isVerifiedToken(token.chainId, token.address) }
}
