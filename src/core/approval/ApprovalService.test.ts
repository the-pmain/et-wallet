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
import { MemoryStorageService } from '@/core/storage'
import { DECIMALS_SELECTOR, SYMBOL_SELECTOR, TOKEN_STANDARD } from '@/core/token'
import { toWei, type Address, type ChainId, type HexString, type TxHash } from '@/core/types'
import { FakeProviderFactory, NullLogger } from '@/test/doubles'

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

/** Наибольшее значение uint256: так выглядит неограниченное разрешение. */
const UNLIMITED = (1n << 256n) - 1n

function word(value: bigint): string {
  return value.toString(16).padStart(64, '0')
}

/** Событие выдачи разрешения ERC-20: три темы, сумма в данных. */
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

/** Событие разрешения на всю коллекцию. */
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

/** Событие `Approval` ERC-721: четыре темы, номер предмета в теме. */
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

  /** Действующие разрешения ERC-20: ключ — «контракт:получатель». */
  allowances = new Map<string, bigint>()

  /** Действующие разрешения на коллекции. */
  operators = new Set<string>()

  /** Символы контрактов. */
  symbols = new Map<string, string>()

  /** Число знаков контрактов. */
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
        ? Promise.reject(new Error('функции нет'))
        : Promise.resolve(encodeText(symbol))
    }

    if (data.startsWith(`0x${DECIMALS_SELECTOR}`)) {
      const value = this.decimals.get(contract)

      return value === undefined
        ? Promise.reject(new Error('функции нет'))
        : Promise.resolve(`0x${word(BigInt(value))}` as HexString)
    }

    return Promise.reject(new Error('не поддержано'))
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
    return Promise.reject(new Error('не поддержано'))
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
    return Promise.reject(new Error('не поддержано'))
  }

  destroy(): void {
    /* Дублёру нечего освобождать. */
  }

  on = this.#events.on.bind(this.#events)
  once = this.#events.once.bind(this.#events)
  off = this.#events.off.bind(this.#events)
}

/** Строка переменной длины в кодировке ABI. */
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
    repository: new NetworkRepository(new MemoryStorageService()),
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

describe('Действительность проверяется, а не берётся из журнала', () => {
  it('действующее разрешение попадает в список', async () => {
    node.logs = [approval(USDC, EXCHANGE, 1_000_000n)]
    node.allowances.set(`${USDC.toLowerCase()}:${EXCHANGE.toLowerCase()}`, 1_000_000n)

    const page = await service.list(OWNER, CHAIN_ID)

    expect(page.items).toHaveLength(1)
    expect(page.items[0]?.amount).toBe(1_000_000n)
  })

  it('отозванное разрешение в список не попадает', async () => {
    /* Журнал хранит историю выдач навсегда. Показать отозванное
       как действующее значило бы пугать владельца тем, чего нет,
       и обесценить настоящие находки. */
    node.logs = [approval(USDC, EXCHANGE, 1_000_000n)]

    expect((await service.list(OWNER, CHAIN_ID)).items).toHaveLength(0)
  })

  it('количество берётся из контракта, а не из события', async () => {
    /* Событие описывает момент выдачи; с тех пор часть разрешения
       могла быть израсходована. */
    node.logs = [approval(USDC, EXCHANGE, 1_000_000n)]
    node.allowances.set(`${USDC.toLowerCase()}:${EXCHANGE.toLowerCase()}`, 400n)

    expect((await service.list(OWNER, CHAIN_ID)).items[0]?.amount).toBe(400n)
  })
})

describe('Неограниченное разрешение', () => {
  it('помечается признаком', async () => {
    node.logs = [approval(USDC, EXCHANGE, UNLIMITED)]
    node.allowances.set(`${USDC.toLowerCase()}:${EXCHANGE.toLowerCase()}`, UNLIMITED)

    expect((await service.list(OWNER, CHAIN_ID)).items[0]?.isUnlimited).toBe(true)
  })

  it('признак ставится и для значений чуть меньше предела', async () => {
    /* Приложения запрашивают и `2^255`. Разница между «весь баланс»
       и «почти весь баланс» для владельца отсутствует. */
    node.logs = [approval(USDC, EXCHANGE, 1n << 255n)]
    node.allowances.set(`${USDC.toLowerCase()}:${EXCHANGE.toLowerCase()}`, 1n << 255n)

    expect((await service.list(OWNER, CHAIN_ID)).items[0]?.isUnlimited).toBe(true)
  })

  it('обычная сумма признака не получает', async () => {
    node.logs = [approval(USDC, EXCHANGE, 1_000_000n)]
    node.allowances.set(`${USDC.toLowerCase()}:${EXCHANGE.toLowerCase()}`, 1_000_000n)

    expect((await service.list(OWNER, CHAIN_ID)).items[0]?.isUnlimited).toBe(false)
  })
})

describe('Разрешение на коллекцию', () => {
  it('действующее показывается без количества', async () => {
    /* Распоряжаться можно всеми предметами, включая те, которых
       у владельца ещё нет. */
    node.logs = [approvalForAll(PUNKS, EXCHANGE)]
    node.operators.add(`${PUNKS.toLowerCase()}:${EXCHANGE.toLowerCase()}`)

    const record = (await service.list(OWNER, CHAIN_ID)).items[0]

    expect(record?.amount).toBeNull()
    expect(record?.isUnlimited).toBe(true)
  })

  it('снятое разрешение в список не попадает', async () => {
    node.logs = [approvalForAll(PUNKS, EXCHANGE)]

    expect((await service.list(OWNER, CHAIN_ID)).items).toHaveLength(0)
  })

  it('разрешение на один предмет не показывается', async () => {
    /* Событие `Approval` с четырьмя темами — это ERC-721. Такое
       разрешение исчезает при первой же передаче предмета, и место
       в списке оно занимало бы зря. */
    node.logs = [singleItemApproval(PUNKS, EXCHANGE, 777n)]
    node.operators.add(`${PUNKS.toLowerCase()}:${EXCHANGE.toLowerCase()}`)

    expect((await service.list(OWNER, CHAIN_ID)).items).toHaveLength(0)
  })
})

describe('Метаданные и повторы', () => {
  it('символ и число знаков читаются из контракта', async () => {
    node.logs = [approval(USDC, EXCHANGE, 5n)]
    node.allowances.set(`${USDC.toLowerCase()}:${EXCHANGE.toLowerCase()}`, 5n)
    node.symbols.set(USDC.toLowerCase(), 'USDC')
    node.decimals.set(USDC.toLowerCase(), 6)

    const record = (await service.list(OWNER, CHAIN_ID)).items[0]

    expect(record?.symbol).toBe('USDC')
    expect(record?.decimals).toBe(6)
  })

  it('молчаливый контракт не получает выдуманных метаданных', async () => {
    /* Показать «1 000 000 токенов» там, где знаков шесть, — ошибка
       на шесть порядков в вопросе о величине риска. */
    node.logs = [approval(USDC, EXCHANGE, 5n)]
    node.allowances.set(`${USDC.toLowerCase()}:${EXCHANGE.toLowerCase()}`, 5n)

    const record = (await service.list(OWNER, CHAIN_ID)).items[0]

    expect(record?.symbol).toBeNull()
    expect(record?.decimals).toBeNull()
  })

  it('несколько выдач одной паре дают одну запись', async () => {
    /* Разрешение перезаписывается, а не складывается. */
    node.logs = [approval(USDC, EXCHANGE, 100n), approval(USDC, EXCHANGE, 900n)]
    node.allowances.set(`${USDC.toLowerCase()}:${EXCHANGE.toLowerCase()}`, 900n)

    expect((await service.list(OWNER, CHAIN_ID)).items).toHaveLength(1)
  })

  it('разные получатели разрешения показываются отдельно', async () => {
    node.logs = [approval(USDC, EXCHANGE, 100n), approval(USDC, OTHER_SPENDER, 200n)]
    node.allowances.set(`${USDC.toLowerCase()}:${EXCHANGE.toLowerCase()}`, 100n)
    node.allowances.set(`${USDC.toLowerCase()}:${OTHER_SPENDER.toLowerCase()}`, 200n)

    expect((await service.list(OWNER, CHAIN_ID)).items).toHaveLength(2)
  })
})

describe('Границы выборки', () => {
  it('глубина просмотра сообщается', async () => {
    expect((await service.list(OWNER, CHAIN_ID)).limits.scannedBlocks).toBe(10_000)
  })

  it('отказ узла не выдаётся за отсутствие разрешений', async () => {
    /* «Вы никому ничего не разрешали» — сильное утверждение, которого
       кошелёк в этом случае делать не вправе. */
    node.logsError = new Error('диапазон слишком широк')

    const page = await service.list(OWNER, CHAIN_ID)

    expect(page.limits.sourceUnavailable).toBe(true)
    expect(page.limits.reason).toBe('диапазон слишком широк')
  })

  it('непроверенные выдачи считаются', async () => {
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

describe('Стандарт записи', () => {
  it('разрешение на токен помечено как ERC-20', async () => {
    node.logs = [approval(USDC, EXCHANGE, 5n)]
    node.allowances.set(`${USDC.toLowerCase()}:${EXCHANGE.toLowerCase()}`, 5n)

    expect((await service.list(OWNER, CHAIN_ID)).items[0]?.standard).toBe(TOKEN_STANDARD.Erc20)
  })

  it('разрешение на коллекцию помечено как ERC-721', async () => {
    node.logs = [approvalForAll(PUNKS, EXCHANGE)]
    node.operators.add(`${PUNKS.toLowerCase()}:${EXCHANGE.toLowerCase()}`)

    expect((await service.list(OWNER, CHAIN_ID)).items[0]?.standard).toBe(TOKEN_STANDARD.Erc721)
  })
})
