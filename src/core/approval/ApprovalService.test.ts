import { beforeEach, describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import { EventBus } from '@/core/events'
import { addressToTopic } from '@/core/history'
import {
  BUILT_IN_CHAIN_ID,
  BUILT_IN_NETWORKS,
  DEFAULT_CHAIN_ID,
  NetworkRepository,
  NetworkService,
} from '@/core/network'
import type {
  ICallRequest,
  IFeeData,
  ILogEntry,
  IProvider,
  ProviderEventMap,
} from '@/core/provider'
import { DECIMALS_SELECTOR, SYMBOL_SELECTOR, TOKEN_STANDARD } from '@/core/token'
import { toWei, type Address, type ChainId, type HexString, type TxHash } from '@/core/types'
import { FakeProviderFactory, NullLogger, createSecureMemoryStorage } from '@/test/doubles'

import {
  ALLOWANCE_SELECTOR,
  APPROVAL_FOR_ALL_TOPIC,
  APPROVAL_TOPIC,
  IS_APPROVED_FOR_ALL_SELECTOR,
} from './abi'
import { ApprovalService } from './ApprovalService'

const CHAIN_ID = BUILT_IN_CHAIN_ID.Ethereum

const OWNER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const EXCHANGE = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')
const OTHER_SPENDER = toAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')

const USDC = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
const PUNKS = toAddress('0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D')

/** The largest uint256 value: this is how an unlimited approval looks. */
const UNLIMITED = (1n << 256n) - 1n

function word(value: bigint): string {
  return value.toString(16).padStart(64, '0')
}

/** An ERC-20 approval event: three topics, the amount in the data. */
function approval(contract: Address, spender: Address, amount: bigint): ILogEntry {
  return {
    address: contract,
    topics: [APPROVAL_TOPIC, addressToTopic(OWNER), addressToTopic(spender)],
    data: `0x${word(amount)}` as HexString,
    blockNumber: 19_000n,
    transactionHash: `0x${'aa'.repeat(32)}` as TxHash,
    logIndex: 0,
    removed: false,
  }
}

/** An approval-for-all event. */
function approvalForAll(contract: Address, operator: Address): ILogEntry {
  return {
    address: contract,
    topics: [APPROVAL_FOR_ALL_TOPIC, addressToTopic(OWNER), addressToTopic(operator)],
    data: `0x${word(1n)}` as HexString,
    blockNumber: 19_000n,
    transactionHash: `0x${'bb'.repeat(32)}` as TxHash,
    logIndex: 0,
    removed: false,
  }
}

/** An ERC-721 `Approval` event: four topics, the item id in a topic. */
function singleItemApproval(contract: Address, spender: Address, tokenId: bigint): ILogEntry {
  return {
    address: contract,
    topics: [
      APPROVAL_TOPIC,
      addressToTopic(OWNER),
      addressToTopic(spender),
      `0x${word(tokenId)}` as HexString,
    ],
    data: '0x' as HexString,
    blockNumber: 19_000n,
    transactionHash: `0x${'cc'.repeat(32)}` as TxHash,
    logIndex: 0,
    removed: false,
  }
}

class ApprovalNode implements IProvider {
  readonly chainId = CHAIN_ID
  readonly rpcUrl = 'https://stub.example'
  readonly isActive = true

  logs: readonly ILogEntry[] = []

  /** Live ERC-20 approvals: key is "contract:spender". */
  allowances = new Map<string, bigint>()

  /** Live collection-wide approvals. */
  operators = new Set<string>()

  symbols = new Map<string, string>()

  decimals = new Map<string, number>()

  logsError: Error | null = null

  readonly #events = new EventBus<ProviderEventMap>()

  getLogs(): Promise<readonly ILogEntry[]> {
    return this.logsError === null ? Promise.resolve(this.logs) : Promise.reject(this.logsError)
  }

  getBlockNumber(): Promise<bigint> {
    return Promise.resolve(20_000n)
  }

  call(request: ICallRequest): Promise<HexString> {
    const data = request.data ?? '0x'
    const contract = request.to.toLowerCase()

    if (data.startsWith(`0x${ALLOWANCE_SELECTOR}`)) {
      const spender = `0x${data.slice(-40)}`

      return Promise.resolve(
        `0x${word(this.allowances.get(`${contract}:${spender}`) ?? 0n)}` as HexString,
      )
    }

    if (data.startsWith(`0x${IS_APPROVED_FOR_ALL_SELECTOR}`)) {
      const operator = `0x${data.slice(-40)}`

      return Promise.resolve(
        `0x${word(this.operators.has(`${contract}:${operator}`) ? 1n : 0n)}` as HexString,
      )
    }

    if (data.startsWith(`0x${SYMBOL_SELECTOR}`)) {
      const symbol = this.symbols.get(contract)

      return symbol === undefined
        ? Promise.reject(new Error('function is missing'))
        : Promise.resolve(encodeText(symbol))
    }

    if (data.startsWith(`0x${DECIMALS_SELECTOR}`)) {
      const value = this.decimals.get(contract)

      return value === undefined
        ? Promise.reject(new Error('function is missing'))
        : Promise.resolve(`0x${word(BigInt(value))}` as HexString)
    }

    return Promise.reject(new Error('not supported'))
  }

  getBalance(): Promise<ReturnType<typeof toWei>> {
    return Promise.resolve(toWei(0n))
  }

  getNonce(): Promise<number> {
    return Promise.resolve(0)
  }

  getTransactionCount(): Promise<number> {
    return Promise.resolve(0)
  }

  getTransactionReceipt(): Promise<null> {
    return Promise.resolve(null)
  }

  getChainId(): Promise<ChainId> {
    return Promise.resolve(CHAIN_ID)
  }

  getCode(): Promise<HexString> {
    return Promise.resolve('0x' as HexString)
  }

  estimateGas(): Promise<bigint> {
    return Promise.resolve(21_000n)
  }

  sendRawTransaction(): Promise<TxHash> {
    return Promise.reject(new Error('not supported'))
  }

  getFeeData(): Promise<IFeeData> {
    return Promise.resolve({
      baseFeePerGas: 1n,
      maxFeePerGas: 2n,
      maxPriorityFeePerGas: 1n,
      gasPrice: 2n,
    })
  }

  request<TResult>(): Promise<TResult> {
    return Promise.reject(new Error('not supported'))
  }

  destroy(): void {
    /* The stand-in has nothing to release. */
  }

  on = this.#events.on.bind(this.#events)
  once = this.#events.once.bind(this.#events)
  off = this.#events.off.bind(this.#events)
}

function encodeText(value: string): HexString {
  const bytes = [...new TextEncoder().encode(value)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

  return `0x${word(32n)}${word(BigInt(value.length))}${bytes.padEnd(64, '0')}` as HexString
}

let node: ApprovalNode
let service: ApprovalService

beforeEach(async () => {
  node = new ApprovalNode()

  const networks = new NetworkService({
    repository: new NetworkRepository(await createSecureMemoryStorage()),
    providerFactory: new FakeProviderFactory(),
    logger: new NullLogger(),
    builtInNetworks: BUILT_IN_NETWORKS,
    defaultChainId: DEFAULT_CHAIN_ID,
  })

  await networks.init()

  service = new ApprovalService({
    resolver: { get: () => Promise.resolve(node) },
    networks,
    logger: new NullLogger(),
  })
})

describe('Validity is checked, not taken from the log', () => {
  it('a live approval appears in the list', async () => {
    node.logs = [approval(USDC, EXCHANGE, 1_000_000n)]
    node.allowances.set(`${USDC.toLowerCase()}:${EXCHANGE.toLowerCase()}`, 1_000_000n)

    const page = await service.list(OWNER, CHAIN_ID)

    expect(page.items).toHaveLength(1)
    expect(page.items[0]?.amount).toBe(1_000_000n)
  })

  it('a revoked approval does not appear', async () => {
    /* The log keeps the grant history forever. Showing a revoked
       one as live would frighten the owner with something that is
       gone, and devalue the real finds. */
    node.logs = [approval(USDC, EXCHANGE, 1_000_000n)]

    expect((await service.list(OWNER, CHAIN_ID)).items).toHaveLength(0)
  })

  it('the amount is taken from the contract, not the event', async () => {
    /* The event describes the moment of the grant; since then part
       of the approval may have been spent. */
    node.logs = [approval(USDC, EXCHANGE, 1_000_000n)]
    node.allowances.set(`${USDC.toLowerCase()}:${EXCHANGE.toLowerCase()}`, 400n)

    expect((await service.list(OWNER, CHAIN_ID)).items[0]?.amount).toBe(400n)
  })
})

describe('Unlimited approval', () => {
  it('is marked with a flag', async () => {
    node.logs = [approval(USDC, EXCHANGE, UNLIMITED)]
    node.allowances.set(`${USDC.toLowerCase()}:${EXCHANGE.toLowerCase()}`, UNLIMITED)

    expect((await service.list(OWNER, CHAIN_ID)).items[0]?.isUnlimited).toBe(true)
  })

  it('the flag is also set for values slightly below the limit', async () => {
    /* Apps also request `2^255`. The difference between "the whole
       balance" and "almost the whole balance" is nothing to the
       owner. */
    node.logs = [approval(USDC, EXCHANGE, 1n << 255n)]
    node.allowances.set(`${USDC.toLowerCase()}:${EXCHANGE.toLowerCase()}`, 1n << 255n)

    expect((await service.list(OWNER, CHAIN_ID)).items[0]?.isUnlimited).toBe(true)
  })

  it('an ordinary amount does not get the flag', async () => {
    node.logs = [approval(USDC, EXCHANGE, 1_000_000n)]
    node.allowances.set(`${USDC.toLowerCase()}:${EXCHANGE.toLowerCase()}`, 1_000_000n)

    expect((await service.list(OWNER, CHAIN_ID)).items[0]?.isUnlimited).toBe(false)
  })
})

describe('Collection-wide approval', () => {
  it('a live one is shown without an amount', async () => {
    /* Every item can be disposed of, including those the owner does
       not yet hold. */
    node.logs = [approvalForAll(PUNKS, EXCHANGE)]
    node.operators.add(`${PUNKS.toLowerCase()}:${EXCHANGE.toLowerCase()}`)

    const record = (await service.list(OWNER, CHAIN_ID)).items[0]

    expect(record?.amount).toBeNull()
    expect(record?.isUnlimited).toBe(true)
  })

  it('a cleared approval does not appear', async () => {
    node.logs = [approvalForAll(PUNKS, EXCHANGE)]

    expect((await service.list(OWNER, CHAIN_ID)).items).toHaveLength(0)
  })

  it('an approval for a single item is not shown', async () => {
    /* An `Approval` event with four topics is ERC-721. Such an
       approval vanishes on the first transfer of the item, and it
       would occupy a list slot for nothing. */
    node.logs = [singleItemApproval(PUNKS, EXCHANGE, 777n)]
    node.operators.add(`${PUNKS.toLowerCase()}:${EXCHANGE.toLowerCase()}`)

    expect((await service.list(OWNER, CHAIN_ID)).items).toHaveLength(0)
  })
})

describe('Metadata and duplicates', () => {
  it('the symbol and decimals are read from the contract', async () => {
    node.logs = [approval(USDC, EXCHANGE, 5n)]
    node.allowances.set(`${USDC.toLowerCase()}:${EXCHANGE.toLowerCase()}`, 5n)
    node.symbols.set(USDC.toLowerCase(), 'USDC')
    node.decimals.set(USDC.toLowerCase(), 6)

    const record = (await service.list(OWNER, CHAIN_ID)).items[0]

    expect(record?.symbol).toBe('USDC')
    expect(record?.decimals).toBe(6)
  })

  it('a silent contract is not given made-up metadata', async () => {
    /* Showing "1 000 000 tokens" where decimals are six is an error
       of six orders of magnitude on the size of the risk. */
    node.logs = [approval(USDC, EXCHANGE, 5n)]
    node.allowances.set(`${USDC.toLowerCase()}:${EXCHANGE.toLowerCase()}`, 5n)

    const record = (await service.list(OWNER, CHAIN_ID)).items[0]

    expect(record?.symbol).toBeNull()
    expect(record?.decimals).toBeNull()
  })

  it('several grants to the same pair yield one record', async () => {
    /* The approval is overwritten, not added. */
    node.logs = [approval(USDC, EXCHANGE, 100n), approval(USDC, EXCHANGE, 900n)]
    node.allowances.set(`${USDC.toLowerCase()}:${EXCHANGE.toLowerCase()}`, 900n)

    expect((await service.list(OWNER, CHAIN_ID)).items).toHaveLength(1)
  })

  it('different approval recipients are shown separately', async () => {
    node.logs = [approval(USDC, EXCHANGE, 100n), approval(USDC, OTHER_SPENDER, 200n)]
    node.allowances.set(`${USDC.toLowerCase()}:${EXCHANGE.toLowerCase()}`, 100n)
    node.allowances.set(`${USDC.toLowerCase()}:${OTHER_SPENDER.toLowerCase()}`, 200n)

    expect((await service.list(OWNER, CHAIN_ID)).items).toHaveLength(2)
  })
})

describe('Scan limits', () => {
  it('the scan depth is reported', async () => {
    expect((await service.list(OWNER, CHAIN_ID)).limits.scannedBlocks).toBe(10_000)
  })

  it('a node refusal is not treated as having no approvals', async () => {
    /* "You have approved no one" is a strong claim the wallet is not
       entitled to make in this case. */
    node.logsError = new Error('range is too wide')

    const page = await service.list(OWNER, CHAIN_ID)

    expect(page.limits.sourceUnavailable).toBe(true)
    expect(page.limits.reason).toBe('range is too wide')
  })

  it('unchecked grants are counted', async () => {
    const logs: ILogEntry[] = []

    for (let index = 0; index < 70; index += 1) {
      const spender = toAddress(`0x${index.toString(16).padStart(40, '0')}`)

      logs.push(approval(USDC, spender, 1n))
      node.allowances.set(`${USDC.toLowerCase()}:${spender.toLowerCase()}`, 1n)
    }

    node.logs = logs

    const page = await service.list(OWNER, CHAIN_ID)

    expect(page.items).toHaveLength(60)
    expect(page.limits.skipped).toBe(10)
  })
})

describe('Record standard', () => {
  it('a token approval is marked as ERC-20', async () => {
    node.logs = [approval(USDC, EXCHANGE, 5n)]
    node.allowances.set(`${USDC.toLowerCase()}:${EXCHANGE.toLowerCase()}`, 5n)

    expect((await service.list(OWNER, CHAIN_ID)).items[0]?.standard).toBe(TOKEN_STANDARD.Erc20)
  })

  it('a collection approval is marked as ERC-721', async () => {
    node.logs = [approvalForAll(PUNKS, EXCHANGE)]
    node.operators.add(`${PUNKS.toLowerCase()}:${EXCHANGE.toLowerCase()}`)

    expect((await service.list(OWNER, CHAIN_ID)).items[0]?.standard).toBe(TOKEN_STANDARD.Erc721)
  })
})
