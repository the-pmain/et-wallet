import { describe, expect, it } from 'vitest'

import { encodeUintWord } from '@/core/abi/encoding'
import { toAddress } from '@/core/address'
import { RpcError } from '@/core/errors'
import { EventBus } from '@/core/events'
import { addressToTopic, TRANSFER_SINGLE_TOPIC, TRANSFER_TOPIC } from '@/core/history'
import type { IFeeData, ILogEntry, IProvider, ProviderEventMap } from '@/core/provider'
import { toWei, type ChainId, type HexString, type TxHash, type Wei } from '@/core/types'

import { MOVEMENT_KIND, SIMULATION_OUTCOME, simulateTransaction } from './simulate'

const OWNER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const PEER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')
const TOKEN = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

/**
 * Псевдоадрес нативной валюты.
 *
 * Значение снято с живого узла: именно его подставляет `eth_simulateV1`
 * в синтетический журнал при `traceTransfers`. Захардкожено в тесте
 * намеренно — если модуль поменяет константу, тест обязан упасть.
 */
const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

const REQUEST = {
  from: OWNER,
  to: PEER,
  data: '0x' as HexString,
  value: toWei(1_000n),
}

/** Узел, отвечающий на `eth_simulateV1` заданным образом. */
class SimulatingNode implements IProvider {
  readonly chainId = 1n as ChainId
  readonly rpcUrl = 'https://stub.example'
  readonly isActive = true

  /** Что вернуть на запрос. */
  response: unknown = null

  /** Чем отказать вместо ответа. */
  failure: Error | null = null

  readonly #events = new EventBus<ProviderEventMap>()

  request<TResult>(): Promise<TResult> {
    return this.failure === null
      ? Promise.resolve(this.response as TResult)
      : Promise.reject(this.failure)
  }

  call(): Promise<HexString> {
    return Promise.resolve('0x' as HexString)
  }

  getBalance(): Promise<Wei> {
    return Promise.resolve(toWei(0n))
  }

  getTransactionCount(): Promise<number> {
    return Promise.resolve(0)
  }

  getNonce(): Promise<number> {
    return Promise.resolve(0)
  }

  getBlockNumber(): Promise<bigint> {
    return Promise.resolve(1n)
  }

  getChainId(): Promise<ChainId> {
    return Promise.resolve(this.chainId)
  }

  getCode(): Promise<HexString> {
    return Promise.resolve('0x' as HexString)
  }

  estimateGas(): Promise<bigint> {
    return Promise.resolve(21_000n)
  }

  getTransactionReceipt(): Promise<null> {
    return Promise.resolve(null)
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

  getLogs(): Promise<readonly ILogEntry[]> {
    return Promise.resolve([])
  }

  destroy(): void {
    /* Дублёру нечего освобождать. */
  }

  on = this.#events.on.bind(this.#events)
  once = this.#events.once.bind(this.#events)
  off = this.#events.off.bind(this.#events)
}

/** Собирает ответ узла с одним вызовом и заданными журналами. */
function answer(status: string, logs: readonly unknown[], returnData = '0x'): unknown {
  return [{ calls: [{ status, gasUsed: '0x5246', returnData, logs }] }]
}

describe('simulateTransaction: исход', () => {
  it('сообщает об успехе и израсходованном газе', async () => {
    const node = new SimulatingNode()
    node.response = answer('0x1', [])

    const result = await simulateTransaction(node, REQUEST)

    expect(result.outcome).toBe(SIMULATION_OUTCOME.Succeeded)
    expect(result.gasUsed).toBe(0x5246n)
  })

  it('отличает откат от успеха и достаёт причину', async () => {
    const node = new SimulatingNode()
    /* `Error("no")`: признак функции, смещение, длина, тело. */
    const revert = `0x08c379a0${encodeUintWord(32n)}${encodeUintWord(2n)}${Buffer.from('no').toString('hex').padEnd(64, '0')}`
    node.response = answer('0x0', [], revert)

    const result = await simulateTransaction(node, REQUEST)

    expect(result.outcome).toBe(SIMULATION_OUTCOME.Reverted)
    expect(result.reason).toBe('no')
  })

  it('отличает «узел не умеет» от «узел не ответил»', async () => {
    const node = new SimulatingNode()

    /* Разница не косметическая: в первом случае повторять бессмысленно,
       во втором — осмысленно, и владельцу говорят разное. */
    node.failure = new RpcError(-32601, 'the method does not exist')
    expect((await simulateTransaction(node, REQUEST)).outcome).toBe(SIMULATION_OUTCOME.Unsupported)

    node.failure = new RpcError(-32005, 'rate limit exceeded')
    expect((await simulateTransaction(node, REQUEST)).outcome).toBe(SIMULATION_OUTCOME.Unavailable)
  })

  it('не выдаёт неожиданный ответ за отсутствие перемещений', async () => {
    const node = new SimulatingNode()

    /* Пустой перечень при исходе «не удалось» означает «неизвестно»,
       а не «ничего не двинется»: именно эту подмену и нельзя допустить. */
    for (const response of [null, {}, [], [{}], [{ calls: [] }]]) {
      node.response = response

      const result = await simulateTransaction(node, REQUEST)

      expect(result.outcome).toBe(SIMULATION_OUTCOME.Unavailable)
      expect(result.movements).toStrictEqual([])
    }
  })
})

describe('simulateTransaction: перемещения', () => {
  it('разбирает перевод нативной валюты', async () => {
    const node = new SimulatingNode()
    node.response = answer('0x1', [
      {
        address: NATIVE,
        topics: [TRANSFER_TOPIC, addressToTopic(OWNER), addressToTopic(PEER)],
        data: `0x${encodeUintWord(1_000n)}`,
      },
    ])

    const [movement] = (await simulateTransaction(node, REQUEST)).movements

    /* Нативная валюта отличается ОТСУТСТВИЕМ контракта, а не особым
       адресом: псевдоадрес — деталь протокола, наружу она не идёт. */
    expect(movement?.kind).toBe(MOVEMENT_KIND.Native)
    expect(movement?.contract).toBeNull()
    expect(movement?.amount).toBe(1_000n)
  })

  it('разбирает перевод ERC-20', async () => {
    const node = new SimulatingNode()
    node.response = answer('0x1', [
      {
        address: TOKEN,
        topics: [TRANSFER_TOPIC, addressToTopic(OWNER), addressToTopic(PEER)],
        data: `0x${encodeUintWord(5n)}`,
      },
    ])

    const [movement] = (await simulateTransaction(node, REQUEST)).movements

    expect(movement?.kind).toBe(MOVEMENT_KIND.Erc20)
    expect(movement?.contract).toBe(TOKEN)
    expect(movement?.from).toBe(OWNER)
    expect(movement?.to).toBe(PEER)
    expect(movement?.amount).toBe(5n)
  })

  it('отличает ERC-721 от ERC-20 по числу тем', async () => {
    const node = new SimulatingNode()
    node.response = answer('0x1', [
      {
        address: TOKEN,
        topics: [
          TRANSFER_TOPIC,
          addressToTopic(OWNER),
          addressToTopic(PEER),
          `0x${encodeUintWord(7n)}`,
        ],
        data: '0x',
      },
    ])

    const [movement] = (await simulateTransaction(node, REQUEST)).movements

    /* У ERC-721 номер предмета лежит в теме, а не в данных: та же
       подпись события означает другое. */
    expect(movement?.kind).toBe(MOVEMENT_KIND.Erc721)
    expect(movement?.tokenId).toBe(7n)
    expect(movement?.amount).toBe(1n)
  })

  it('разбирает одиночную передачу ERC-1155', async () => {
    const node = new SimulatingNode()
    node.response = answer('0x1', [
      {
        address: TOKEN,
        topics: [
          TRANSFER_SINGLE_TOPIC,
          addressToTopic(OWNER),
          addressToTopic(OWNER),
          addressToTopic(PEER),
        ],
        data: `0x${encodeUintWord(3n)}${encodeUintWord(9n)}`,
      },
    ])

    const [movement] = (await simulateTransaction(node, REQUEST)).movements

    expect(movement?.kind).toBe(MOVEMENT_KIND.Erc1155)
    expect(movement?.tokenId).toBe(3n)
    expect(movement?.amount).toBe(9n)
    expect(movement?.to).toBe(PEER)
  })

  it('пропускает журналы, не означающие перемещения', async () => {
    const node = new SimulatingNode()
    node.response = answer('0x1', [
      { address: TOKEN, topics: ['0xdeadbeef'], data: '0x' },
      { address: TOKEN, topics: [], data: '0x' },
      { topics: [TRANSFER_TOPIC], data: '0x' },
    ])

    expect((await simulateTransaction(node, REQUEST)).movements).toStrictEqual([])
  })
})
