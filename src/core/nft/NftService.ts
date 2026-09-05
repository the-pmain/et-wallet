import { decodeAddress, encodeCallWithAddressAndUint, encodeCallWithUint } from '@/core/abi'
import { areAddressesEqual } from '@/core/address'
import {
  TRANSFER_BATCH_TOPIC,
  TRANSFER_SINGLE_TOPIC,
  TRANSFER_TOPIC,
  addressToTopic,
  splitDataWords,
} from '@/core/history'
import type { INetworkService } from '@/core/network'
import { NetworkNotFoundError } from '@/core/errors'
import type { ILogger } from '@/core/platform'
import type { ILogEntry, IProvider, IProviderResolver } from '@/core/provider'
import {
  NAME_SELECTOR,
  SYMBOL_SELECTOR,
  TOKEN_STANDARD,
  decodeString,
  encodeCall,
  type TokenStandard,
} from '@/core/token'
import type { Address, ChainId, HexString } from '@/core/types'

import { ERC1155_BALANCE_OF_SELECTOR, OWNER_OF_SELECTOR } from './abi'
import type { INftPage } from './types'

const SERVICE_NAME = 'NftService'

/**
 * Sample depth in blocks.
 *
 * The same value as transfer history: public nodes cap the
 * `eth_getLogs` range, and ten thousand blocks are accepted by
 * almost all of them. Asking for more is pointless — the node
 * will reject, and the list will be empty instead of short.
 */
const DEFAULT_SCAN_BLOCKS = 10_000

/**
 * How many items are checked for ownership.
 *
 * Each check is a separate contract call. An address that hundreds
 * of items passed through would mean hundreds of requests: public-
 * node limits would run out, and the user would wait minutes.
 * Skipped items are counted and shown.
 */
const MAX_CHECKED_ITEMS = 60

/**
 * How many checks run at once.
 *
 * Checking sixty items in sequence would take tens of seconds;
 * all at once is a sure way to be rejected for requests per
 * second. Eight is the middle public nodes accept.
 */
const BATCH_SIZE = 8

const ERC721_TOPIC_COUNT = 4

export interface INftServiceDependencies {
  readonly resolver: IProviderResolver
  readonly networks: INetworkService
  readonly logger: ILogger
  readonly scanBlocks?: number
}

interface IScanResult {
  readonly logs: readonly ILogEntry[]

  readonly failed: number

  readonly total: number

  readonly reason: string | null
}

interface ICollection {
  readonly name: string | null
  readonly symbol: string | null
}

interface ICandidate {
  readonly contract: Address
  readonly tokenId: bigint
  readonly standard: TokenStandard
}

/**
 * Collectibles belonging to an address.
 *
 * HOW IT WORKS AND WHY THERE IS NO OTHER WAY. The node cannot
 * answer "what belongs to this address": it has no such index.
 * The service finds arrivals in event logs, then asks each
 * contract whether the item belongs to the owner NOW.
 *
 * BOTH STEPS ARE REQUIRED. The log is history: an item received
 * yesterday and given away today stays there forever. A list
 * built from the logs alone would show someone else's property
 * as one's own.
 *
 * WHAT THE SERVICE DOES NOT DO. It does not load images and does
 * not follow links from contracts: the contract author sets that
 * link address, and fetching it would reveal the owner's IP to
 * an arbitrary server, tying it to the wallet.
 */
export class NftService {
  readonly #resolver: IProviderResolver
  readonly #networks: INetworkService
  readonly #logger: ILogger
  readonly #scanBlocks: number

  /* Collection names live until the session ends: they do not
     change, and asking again on every list refresh would double
     the node calls. The key is network plus contract address:
     the same address on different networks is different collections.

     A PROMISE IS STORED, NOT A FINISHED VALUE. Items of one
     collection are checked at once, and a cache of results would
     not fill in time: each would ask the contract again. */
  readonly #collections = new Map<string, Promise<ICollection>>()

  constructor(dependencies: INftServiceDependencies) {
    this.#resolver = dependencies.resolver
    this.#networks = dependencies.networks
    this.#logger = dependencies.logger.child(SERVICE_NAME)
    this.#scanBlocks = dependencies.scanBlocks ?? DEFAULT_SCAN_BLOCKS
  }

  /**
   * Returns items belonging to the owner.
   *
   * A node reject is not thrown outward: the list stays empty
   * and the reason goes into `limits`. An empty list without an
   * explanation is read by the owner as missing property.
   */
  async list(owner: Address, chainId: ChainId): Promise<INftPage> {
    const network = this.#networks.getByChainId(chainId)

    if (network === null) {
      throw new NetworkNotFoundError(chainId)
    }

    let provider: IProvider
    let scan: IScanResult

    try {
      provider = await this.#resolver.get(network)

      const latest = await provider.getBlockNumber()
      const fromBlock = latest > BigInt(this.#scanBlocks) ? latest - BigInt(this.#scanBlocks) : 0n

      scan = await this.#fetchIncoming(provider, owner, fromBlock, latest)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)

      this.#logger.warn('The list of items is unavailable', { reason })

      return {
        items: [],
        limits: { scannedBlocks: null, sourceUnavailable: true, reason, skipped: 0 },
      }
    }

    /* A reject on one event kind leaves the list incomplete but
       meaningful; a reject on all means the node did not answer
       at all, and an empty list then asserts nothing. */
    if (scan.failed === scan.total) {
      return {
        items: [],
        limits: {
          scannedBlocks: null,
          sourceUnavailable: true,
          reason: scan.reason,
          skipped: 0,
        },
      }
    }

    const candidates = collectCandidates(scan.logs)
    const checked = candidates.slice(0, MAX_CHECKED_ITEMS)
    const items = await this.#keepOwned(provider, owner, chainId, checked)

    return {
      items,
      limits: {
        scannedBlocks: this.#scanBlocks,
        sourceUnavailable: false,
        reason: null,
        skipped: candidates.length - checked.length,
      },
    }
  }

  /** Forgets collection names. Called when the session closes. */
  clear(): void {
    this.#collections.clear()
  }

  /**
   * Arrival logs for the owner.
   *
   * THREE REQUESTS, NOT ONE. The recipient's position in the topics
   * differs: for ERC-721 it is the second indexed value, for
   * ERC-1155 the third. One request without a recipient filter
   * would return transfers of the whole network.
   *
   * A reject on one event kind does not cancel the others: the node
   * may fail a wide query but answer a narrow one.
   */
  async #fetchIncoming(
    provider: IProvider,
    owner: Address,
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<IScanResult> {
    const to = addressToTopic(owner)

    const queries: readonly (readonly (HexString | null)[])[] = [
      [TRANSFER_TOPIC, null, to],
      [TRANSFER_SINGLE_TOPIC, null, null, to],
      [TRANSFER_BATCH_TOPIC, null, null, to],
    ]

    let reason: string | null = null

    const results = await Promise.all(
      queries.map(async (topics) => {
        try {
          return await provider.getLogs({ fromBlock, toBlock, topics })
        } catch (error) {
          reason = error instanceof Error ? error.message : String(error)

          this.#logger.warn('The node rejected the log query', { reason })

          return null
        }
      }),
    )

    return {
      logs: results.filter((entries) => entries !== null).flat(),
      failed: results.filter((entries) => entries === null).length,
      total: results.length,
      reason,
    }
  }

  /**
   * Keeps items that belong to the owner now.
   *
   * A contract reject means "could not check" and the item is
   * dropped: showing an unchecked item as owned is the same as
   * showing someone else's.
   */
  async #keepOwned(
    provider: IProvider,
    owner: Address,
    chainId: ChainId,
    candidates: readonly ICandidate[],
  ): Promise<readonly INftPage['items'][number][]> {
    const owned: INftPage['items'][number][] = []

    for (let start = 0; start < candidates.length; start += BATCH_SIZE) {
      const batch = candidates.slice(start, start + BATCH_SIZE)

      const checked = await Promise.all(
        batch.map(async (candidate) => {
          const balance = await this.#ownedAmount(provider, owner, candidate)

          if (balance === 0n) {
            return null
          }

          const collection = await this.#collection(provider, chainId, candidate.contract)

          return {
            chainId,
            contract: candidate.contract,
            tokenId: candidate.tokenId,
            standard: candidate.standard,
            balance,
            collectionName: collection.name,
            collectionSymbol: collection.symbol,
          }
        }),
      )

      owned.push(...checked.filter((item) => item !== null))
    }

    return owned
  }

  async #ownedAmount(provider: IProvider, owner: Address, candidate: ICandidate): Promise<bigint> {
    try {
      if (candidate.standard === TOKEN_STANDARD.Erc721) {
        const holder = decodeAddress(
          await provider.call({
            to: candidate.contract,
            data: encodeCallWithUint(OWNER_OF_SELECTOR, candidate.tokenId),
          }),
        )

        /* The item is indivisible: it either belongs to the owner
           entirely, or not at all. */
        return areAddressesEqual(holder, owner) ? 1n : 0n
      }

      const balance = await provider.call({
        to: candidate.contract,
        data: encodeCallWithAddressAndUint(ERC1155_BALANCE_OF_SELECTOR, owner, candidate.tokenId),
      })

      return balance === '0x' ? 0n : BigInt(balance)
    } catch (error) {
      /* A burned item is the most common case: `ownerOf` reverts
         for it. There is no way to tell that from a node outage,
         and both mean "must not be shown". */
      this.#logger.debug('Ownership of the item was not confirmed', {
        reason: error instanceof Error ? error.message : String(error),
      })

      return 0n
    }
  }

  #collection(provider: IProvider, chainId: ChainId, contract: Address): Promise<ICollection> {
    const key = `${chainId.toString()}:${contract.toLowerCase()}`
    const cached = this.#collections.get(key)

    if (cached !== undefined) {
      return cached
    }

    const pending = Promise.all([
      this.#readText(provider, contract, NAME_SELECTOR),
      this.#readText(provider, contract, SYMBOL_SELECTOR),
    ]).then(([name, symbol]) => ({ name, symbol }))

    this.#collections.set(key, pending)

    return pending
  }

  /**
   * Reads a string field of the contract.
   *
   * `null` instead of an invented value: neither `name` nor `symbol`
   * is required for ERC-721, and ERC-1155 does not provide them at
   * all. Putting "Unknown collection" here would claim the contract
   * answered so.
   */
  async #readText(
    provider: IProvider,
    contract: Address,
    selector: string,
  ): Promise<string | null> {
    try {
      return decodeString(await provider.call({ to: contract, data: encodeCall(selector) }))
    } catch {
      return null
    }
  }
}

/**
 * Collects items from the logs, dropping duplicates.
 *
 * THE EVENT KIND DECIDES THE STANDARD. ERC-20 and ERC-721 share
 * the `Transfer` event and differ only in the number of indexed
 * parameters: ERC-721 also indexes the item id, so there are four
 * topics. Treating ERC-20 transfers as items would show other
 * people's money in the gallery.
 */
function collectCandidates(logs: readonly ILogEntry[]): readonly ICandidate[] {
  const seen = new Map<string, ICandidate>()

  const remember = (contract: Address, tokenId: bigint, standard: TokenStandard): void => {
    const key = `${contract.toLowerCase()}:${tokenId.toString()}`

    if (!seen.has(key)) {
      seen.set(key, { contract, tokenId, standard })
    }
  }

  for (const log of logs) {
    const topic = log.topics[0]

    if (topic === TRANSFER_TOPIC) {
      const tokenIdTopic = log.topics[3]

      if (log.topics.length === ERC721_TOPIC_COUNT && tokenIdTopic !== undefined) {
        remember(log.address, BigInt(tokenIdTopic), TOKEN_STANDARD.Erc721)
      }

      continue
    }

    if (topic === TRANSFER_SINGLE_TOPIC) {
      /* Event data: item id and amount. The amount is not taken
         here — it describes that transfer, not the remainder at
         query time. */
      const tokenId = splitDataWords(log.data)[0]

      if (tokenId !== undefined) {
        remember(log.address, tokenId, TOKEN_STANDARD.Erc1155)
      }

      continue
    }

    if (topic === TRANSFER_BATCH_TOPIC) {
      for (const tokenId of decodeBatchIds(log.data)) {
        remember(log.address, tokenId, TOKEN_STANDARD.Erc1155)
      }
    }
  }

  return [...seen.values()]
}

/**
 * Reads item ids from a `TransferBatch` event.
 *
 * The data holds two variable-length arrays: ids and amounts.
 * The first word is the offset to the first array; the length
 * sits there, then the values. The offset is read, not assumed
 * to be 64: the standard does not guarantee that, and the
 * assumption would silently yield someone else's numbers.
 */
function decodeBatchIds(data: HexString): readonly bigint[] {
  const words = splitDataWords(data)
  const offsetWord = words[0]

  if (offsetWord === undefined) {
    return []
  }

  /* The offset is in bytes; a word is 32 bytes. */
  const start = Number(offsetWord) / 32
  const lengthWord = words[start]

  if (lengthWord === undefined) {
    return []
  }

  const length = Number(lengthWord)
  const ids: bigint[] = []

  for (let index = 0; index < length; index += 1) {
    const word = words[start + 1 + index]

    if (word === undefined) {
      break
    }

    ids.push(word)
  }

  return ids
}
