import { describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import { EventBus } from '@/core/events'
import type { IFeeData, ILogEntry, IProvider, ProviderEventMap } from '@/core/provider'
import { toWei, type Address, type ChainId, type HexString, type TxHash } from '@/core/types'
import { NullLogger } from '@/test/doubles'

import { DEFAULT_GAP_LIMIT, MAX_SCANNED_ADDRESSES, discoverUsedAccounts } from './AccountDiscovery'

/** Адрес по номеру: значение не важно, важна различимость. */
function addressAt(index: number): Address {
  return toAddress(`0x${index.toString(16).padStart(40, '0')}`)
}

/**
 * Узел, у которого заданы занятые адреса.
 *
 * Занятость задаётся раздельно счётчиком и балансом: адрес, на который
 * только присылали, имеет нулевой счётчик, а опустошённый — нулевой
 * баланс, и оба обязаны находиться.
 */
class DiscoveryNode implements IProvider {
  readonly chainId = 1n as ChainId
  readonly rpcUrl = 'https://stub.example'
  readonly isActive = true

  /** Индексы адресов, с которых отправляли. */
  sent = new Set<number>()

  /** Индексы адресов, на которых лежат средства. */
  funded = new Set<number>()

  /** Отказ узла. Прерывает поиск, а не пропускает адрес. */
  failure: Error | null = null

  /** Сколько адресов было опрошено. */
  queried = 0

  readonly #events = new EventBus<ProviderEventMap>()

  #indexOf(address: Address): number {
    return Number.parseInt(address.slice(2), 16)
  }

  getTransactionCount(address: Address): Promise<number> {
    if (this.failure !== null) {
      return Promise.reject(this.failure)
    }

    this.queried += 1

    return Promise.resolve(this.sent.has(this.#indexOf(address)) ? 3 : 0)
  }

  getBalance(address: Address): Promise<ReturnType<typeof toWei>> {
    if (this.failure !== null) {
      return Promise.reject(this.failure)
    }

    return Promise.resolve(toWei(this.funded.has(this.#indexOf(address)) ? 10n ** 18n : 0n))
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

  call(): Promise<HexString> {
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

  request<TResult>(): Promise<TResult> {
    return Promise.reject(new Error('not supported'))
  }

  destroy(): void {
    /* Дублёру нечего освобождать. */
  }

  on = this.#events.on.bind(this.#events)
  once = this.#events.once.bind(this.#events)
  off = this.#events.off.bind(this.#events)
}

const logger = new NullLogger()

describe('Признаки использованного адреса', () => {
  it('адрес с отправленными транзакциями находится', async () => {
    const node = new DiscoveryNode()

    node.sent.add(0)

    expect((await discoverUsedAccounts(node, addressAt, logger)).usedIndexes).toEqual([0])
  })

  it('адрес с балансом находится, даже если с него не отправляли', async () => {
    /* На адрес только присылали: счётчик транзакций у него нулевой,
       и по одному этому признаку он был бы потерян. */
    const node = new DiscoveryNode()

    node.funded.add(0)

    expect((await discoverUsedAccounts(node, addressAt, logger)).usedIndexes).toEqual([0])
  })

  it('опустошённый адрес находится по счётчику', async () => {
    /* Всё вывели: баланс нулевой, но адресом пользовались, и терять
       его нельзя — на нём может лежать токен либо предмет. */
    const node = new DiscoveryNode()

    node.sent.add(2)

    expect((await discoverUsedAccounts(node, addressAt, logger)).usedIndexes).toEqual([2])
  })

  it('пустой кошелёк даёт пустой список', async () => {
    expect(
      (await discoverUsedAccounts(new DiscoveryNode(), addressAt, logger)).usedIndexes,
    ).toEqual([])
  })
})

describe('Промежуток пустых адресов', () => {
  it('поиск не останавливается на первом пустом', async () => {
    /* Кошельки пропускают адреса при создании: остановка на первом
       пустом потеряла бы всё, что за ним. */
    const node = new DiscoveryNode()

    node.sent.add(0)
    node.funded.add(5)

    expect((await discoverUsedAccounts(node, addressAt, logger)).usedIndexes).toEqual([0, 5])
  })

  it('находит адрес на границе промежутка', async () => {
    const node = new DiscoveryNode()

    node.sent.add(DEFAULT_GAP_LIMIT - 1)

    expect((await discoverUsedAccounts(node, addressAt, logger)).usedIndexes).toEqual([
      DEFAULT_GAP_LIMIT - 1,
    ])
  })

  it('за промежутком не ищет', async () => {
    /* Правило BIP-44: двадцать подряд пустых означают конец. Искать
       дальше значило бы опрашивать узел без предела. */
    const node = new DiscoveryNode()

    node.sent.add(DEFAULT_GAP_LIMIT + 5)

    expect((await discoverUsedAccounts(node, addressAt, logger)).usedIndexes).toEqual([])
  })

  it('промежуток отсчитывается заново после находки', async () => {
    const node = new DiscoveryNode()

    node.sent.add(0)
    node.sent.add(DEFAULT_GAP_LIMIT)

    expect((await discoverUsedAccounts(node, addressAt, logger)).usedIndexes).toEqual([
      0,
      DEFAULT_GAP_LIMIT,
    ])
  })

  it('пустой кошелёк опрашивается ровно на глубину промежутка', async () => {
    const node = new DiscoveryNode()

    const result = await discoverUsedAccounts(node, addressAt, logger)

    expect(result.scanned).toBe(DEFAULT_GAP_LIMIT)
    expect(node.queried).toBe(DEFAULT_GAP_LIMIT)
  })
})

describe('Пределы и отказы', () => {
  it('поиск ограничен сверху', async () => {
    /* Узел, сообщающий активность по любому адресу, не должен уводить
       поиск в бесконечность. */
    const node = new DiscoveryNode()

    for (let index = 0; index < 500; index += 1) {
      node.sent.add(index)
    }

    const result = await discoverUsedAccounts(node, addressAt, logger, { maxScanned: 30 })

    expect(result.scanned).toBe(30)
    expect(result.stoppedByLimit).toBe(true)
  })

  it('остановка по промежутку пределом не считается', async () => {
    /* Разница важна для интерфейса: в одном случае «это всё»,
       в другом — «дальше могло остаться». */
    expect(
      (await discoverUsedAccounts(new DiscoveryNode(), addressAt, logger)).stoppedByLimit,
    ).toBe(false)
  })

  it('отказ узла прерывает поиск и возвращает найденное', async () => {
    /* Пропустить адрес значило бы молча потерять аккаунт — ровно то,
       против чего написан весь этот поиск. */
    const node = new DiscoveryNode()

    node.sent.add(0)

    const first = await discoverUsedAccounts(node, addressAt, logger)

    node.failure = new Error('the node did not answer')

    const second = await discoverUsedAccounts(node, addressAt, logger)

    expect(first.usedIndexes).toEqual([0])
    expect(second.usedIndexes).toEqual([])
    expect(second.stoppedByLimit).toBe(false)
  })

  it('настраиваемый промежуток соблюдается', async () => {
    const node = new DiscoveryNode()

    node.sent.add(3)

    expect(
      (await discoverUsedAccounts(node, addressAt, logger, { gapLimit: 2 })).usedIndexes,
    ).toEqual([])
  })
})

describe('Недостоверный ответ узла', () => {
  it('узел, отвечающий за любой адрес, упирается в предел', async () => {
    /* Так выглядит либо узел-обманка, либо неисправность: у живого
       кошелька две сотни занятых адресов подряд не бывает. Отличить
       это от настоящей находки может только вызывающий, и признак
       для него — остановка пределом. */
    const node = new DiscoveryNode()

    for (let index = 0; index < MAX_SCANNED_ADDRESSES + 10; index += 1) {
      node.funded.add(index)
    }

    const result = await discoverUsedAccounts(node, addressAt, logger)

    expect(result.stoppedByLimit).toBe(true)
    expect(result.scanned).toBe(MAX_SCANNED_ADDRESSES)
  })
})
