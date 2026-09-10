import { beforeEach, describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import { EventBus } from '@/core/events'
import { BUILT_IN_CHAIN_ID } from '@/core/network'
import type { ILogEntry, IProvider, IRpcRequest, ProviderEventMap } from '@/core/provider'
import { toChainId, type ChainId, type HexString } from '@/core/types'

import { AlchemyHistoryProvider } from './AlchemyHistoryProvider'
import { TRANSFER_DIRECTION, TRANSFER_KIND } from './types'

const CHAIN_ID = BUILT_IN_CHAIN_ID.Ethereum
const OWNER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const PEER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')
const TOKEN = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

/** Ответ индексатора для конкретной выборки. */
interface IStubResponse {
  readonly sent?: readonly unknown[]
  readonly received?: readonly unknown[]

  /** Ключи следующей страницы по выборкам. Отсутствие — выдача исчерпана. */
  readonly sentPageKey?: string
  readonly receivedPageKey?: string
}

class StubProvider implements IProvider {
  readonly chainId = CHAIN_ID
  readonly rpcUrl = 'https://stub.example'
  readonly isActive = true

  response: IStubResponse = {}
  failRequest = false
  requests: IRpcRequest[] = []

  readonly #events = new EventBus<ProviderEventMap>()

  request<TResult>(request: IRpcRequest): Promise<TResult> {
    this.requests.push(request)

    if (this.failRequest) {
      return Promise.reject(new Error('метод не поддержан узлом'))
    }

    const [params] = (request.params ?? []) as readonly Record<string, unknown>[]
    const isSent = params !== undefined && 'fromAddress' in params

    const pageKey = isSent ? this.response.sentPageKey : this.response.receivedPageKey

    return Promise.resolve({
      transfers: (isSent ? this.response.sent : this.response.received) ?? [],
      ...(pageKey === undefined ? {} : { pageKey }),
    } as TResult)
  }

  getBlockNumber(): Promise<bigint> {
    return Promise.resolve(1n)
  }

  getChainId(): Promise<ChainId> {
    return Promise.resolve(CHAIN_ID)
  }

  getBalance(): Promise<never> {
    return Promise.reject(new Error('не поддержано'))
  }

  getTransactionCount(): Promise<number> {
    return Promise.resolve(0)
  }

  getNonce(): Promise<number> {
    return Promise.resolve(0)
  }

  call(): Promise<HexString> {
    return Promise.resolve('0x' as HexString)
  }

  /** Байт-код по адресу. Обычный адрес: проверок контракта в этих тестах нет. */
  getCode(): Promise<HexString> {
    return Promise.resolve('0x' as HexString)
  }
  estimateGas(): Promise<bigint> {
    return Promise.resolve(21_000n)
  }

  getFeeData(): Promise<never> {
    return Promise.reject(new Error('не поддержано'))
  }

  sendRawTransaction(): Promise<never> {
    return Promise.reject(new Error('не поддержано'))
  }

  getTransactionReceipt(): Promise<null> {
    return Promise.resolve(null)
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

let node: StubProvider
let source: AlchemyHistoryProvider

const query = { owner: OWNER, chainId: CHAIN_ID, limit: 50 }

beforeEach(() => {
  node = new StubProvider()
  source = new AlchemyHistoryProvider()
})

describe('AlchemyHistoryProvider: запрос', () => {
  it('вызывает метод индексатора', async () => {
    await source.fetch(query, node)

    expect(node.requests[0]?.method).toBe('alchemy_getAssetTransfers')
  })

  it('делает две выборки: отправленное и полученное', async () => {
    await source.fetch(query, node)

    /* Индексатор не умеет объединять условия «отправитель ИЛИ
       получатель», поэтому выборок ровно две. */
    expect(node.requests).toHaveLength(2)
  })

  it('запрашивает все пять категорий', async () => {
    await source.fetch(query, node)

    const [params] = (node.requests[0]?.params ?? []) as readonly Record<string, unknown>[]

    expect(params?.['category']).toEqual(['external', 'internal', 'erc20', 'erc721', 'erc1155'])
  })

  it('обслуживает встроенные сети и отвергает неизвестные', () => {
    expect(source.supports(CHAIN_ID)).toBe(true)
    expect(source.supports(BUILT_IN_CHAIN_ID.Polygon)).toBe(true)
    expect(source.supports(toChainId(999_999n))).toBe(false)
  })
})

describe('AlchemyHistoryProvider: точность сумм', () => {
  it('берёт сумму из необработанного поля, а не из числа JSON', async () => {
    node.response = {
      sent: [
        {
          uniqueId: 'a',
          hash: '0xhash',
          category: 'erc20',
          from: OWNER,
          to: PEER,
          blockNum: '0x10',
          /* Поле `value` — двоичная плавающая точка: суммы свыше 2^53
             теряют младшие разряды. Реализация обязана его игнорировать. */
          value: 1.0000000000000002,
          rawContract: { value: '0xffffffffffffffffffffffff', address: TOKEN, decimal: '0x6' },
        },
      ],
    }

    const [transfer] = (await source.fetch(query, node)).transfers

    expect(transfer?.value).toBe(79_228_162_514_264_337_593_543_950_335n)
  })

  it('читает число знаков из ответа', async () => {
    node.response = {
      sent: [
        {
          uniqueId: 'a',
          hash: '0xhash',
          category: 'erc20',
          from: OWNER,
          to: PEER,
          blockNum: '0x10',
          rawContract: { value: '0x1', address: TOKEN, decimal: '0x6' },
        },
      ],
    }

    expect((await source.fetch(query, node)).transfers[0]?.asset.decimals).toBe(6)
  })

  it('оставляет число знаков неизвестным, если его нет в ответе', async () => {
    node.response = {
      sent: [
        {
          uniqueId: 'a',
          hash: '0xhash',
          category: 'erc20',
          from: OWNER,
          to: PEER,
          blockNum: '0x10',
          rawContract: { value: '0x1', address: TOKEN },
        },
      ],
    }

    /* Подстановка привычных восемнадцати знаков занизила бы сумму
       токена с шестью в триллион раз. */
    expect((await source.fetch(query, node)).transfers[0]?.asset.decimals).toBeNull()
  })
})

describe('AlchemyHistoryProvider: категории', () => {
  it('относит внешние и внутренние переводы к нативной валюте', async () => {
    node.response = {
      sent: [
        {
          uniqueId: 'a',
          hash: '0xhash',
          category: 'external',
          from: OWNER,
          to: PEER,
          blockNum: '0x10',
          rawContract: { value: '0xde0b6b3a7640000', address: null, decimal: '0x12' },
        },
        {
          uniqueId: 'b',
          hash: '0xhash2',
          category: 'internal',
          from: PEER,
          to: OWNER,
          blockNum: '0x11',
          rawContract: { value: '0x1', address: null, decimal: '0x12' },
        },
      ],
    }

    const kinds = (await source.fetch(query, node)).transfers.map((item) => item.kind)

    /* Именно эти две категории недостижимы разбором журналов:
       переводы нативной валюты событий не порождают. */
    expect(kinds).toEqual([TRANSFER_KIND.Native, TRANSFER_KIND.Native])
  })

  it('распознаёт ERC-721 и не выдумывает количество', async () => {
    node.response = {
      sent: [
        {
          uniqueId: 'a',
          hash: '0xhash',
          category: 'erc721',
          from: OWNER,
          to: PEER,
          blockNum: '0x10',
          erc721TokenId: '0x2a',
          rawContract: { value: null, address: TOKEN, decimal: null },
        },
      ],
    }

    const [transfer] = (await source.fetch(query, node)).transfers

    expect(transfer?.kind).toBe(TRANSFER_KIND.Erc721)
    expect(transfer?.tokenId).toBe(42n)
    expect(transfer?.value).toBe(1n)
  })

  it('разворачивает набор предметов ERC-1155 в отдельные записи', async () => {
    node.response = {
      sent: [
        {
          uniqueId: 'a',
          hash: '0xhash',
          category: 'erc1155',
          from: OWNER,
          to: PEER,
          blockNum: '0x10',
          erc1155Metadata: [
            { tokenId: '0x1', value: '0x2' },
            { tokenId: '0x3', value: '0x4' },
          ],
          rawContract: { value: null, address: TOKEN, decimal: null },
        },
      ],
    }

    const { transfers } = await source.fetch(query, node)

    expect(transfers).toHaveLength(2)
    expect(transfers.map((item) => item.tokenId)).toEqual([1n, 3n])
    expect(new Set(transfers.map((item) => item.id)).size).toBe(2)
  })

  it('отбрасывает неизвестные категории', async () => {
    node.response = {
      sent: [
        {
          uniqueId: 'a',
          hash: '0xhash',
          category: 'specialnft',
          from: OWNER,
          to: PEER,
          blockNum: '0x10',
        },
      ],
    }

    expect((await source.fetch(query, node)).transfers).toHaveLength(0)
  })
})

describe('AlchemyHistoryProvider: недоверенный ответ', () => {
  it('переживает ответ неожиданной формы', async () => {
    node.response = { sent: ['строка', 42, null, {}] }

    /* Формат внешнего сервиса может измениться без предупреждения.
       Одна испорченная запись не должна лишать пользователя истории. */
    await expect(source.fetch(query, node)).resolves.toBeDefined()
    expect((await source.fetch(query, node)).transfers).toHaveLength(0)
  })

  it('пропускает записи без обязательных полей', async () => {
    node.response = {
      sent: [
        { uniqueId: 'a', category: 'erc20', from: OWNER },
        {
          uniqueId: 'b',
          hash: '0xhash',
          category: 'erc20',
          from: OWNER,
          to: PEER,
          blockNum: '0x10',
          rawContract: { value: '0x1', address: TOKEN, decimal: '0x6' },
        },
      ],
    }

    expect((await source.fetch(query, node)).transfers).toHaveLength(1)
  })

  it('доводит отказ узла до вызывающего кода', async () => {
    node.failRequest = true

    /* Отказ обязан быть виден: молчаливый пустой результат скрыл бы
       неработающий ключ индексатора. */
    await expect(source.fetch(query, node)).rejects.toThrow()
  })

  it('определяет направление относительно владельца', async () => {
    node.response = {
      received: [
        {
          uniqueId: 'a',
          hash: '0xhash',
          category: 'erc20',
          from: PEER,
          to: OWNER,
          blockNum: '0x10',
          rawContract: { value: '0x1', address: TOKEN, decimal: '0x6' },
        },
      ],
    }

    expect((await source.fetch(query, node)).transfers[0]?.direction).toBe(
      TRANSFER_DIRECTION.Incoming,
    )
  })

  it('сообщает, что ограничений на историю нет', async () => {
    const page = await source.fetch(query, node)

    expect(page.limits.nativeTransfersUnavailable).toBe(false)
    expect(page.limits.scannedBlocks).toBeNull()
  })
})

describe('AlchemyHistoryProvider: продолжение выдачи', () => {
  it('без ключей страниц продолжения нет', async () => {
    /* Конец выдачи объявляет индексатор, а не мы по числу записей:
       последняя страница вполне может оказаться полной. */
    expect((await source.fetch(query, node)).cursor).toBeNull()
  })

  it('ключ страницы уходит обратно в запрос', async () => {
    node.response = { sentPageKey: 'sent-2', receivedPageKey: 'received-2' }

    const first = await source.fetch(query, node)

    node.requests = []

    await source.fetch({ ...query, cursor: first.cursor }, node)

    const keys = node.requests.map(
      (request) => (request.params?.[0] as Record<string, unknown> | undefined)?.['pageKey'],
    )

    expect(keys).toContain('sent-2')
    expect(keys).toContain('received-2')
  })

  it('исчерпанная выборка на продолжении не повторяется', async () => {
    /* Отправленного и полученного у адреса разное количество. Без
       этого условия более короткая сторона выдавала бы свою первую
       страницу заново при каждом «показать более ранние». */
    node.response = { receivedPageKey: 'received-2' }

    const first = await source.fetch(query, node)

    node.requests = []

    await source.fetch({ ...query, cursor: first.cursor }, node)

    expect(node.requests).toHaveLength(1)
    expect((node.requests[0]?.params?.[0] as Record<string, unknown>)['toAddress']).toBe(OWNER)
  })

  it('исчерпание обеих выборок закрывает продолжение', async () => {
    node.response = { sentPageKey: 'sent-2' }

    const first = await source.fetch(query, node)

    node.response = {}

    expect((await source.fetch({ ...query, cursor: first.cursor }, node)).cursor).toBeNull()
  })

  it('чужая метка читается как первая страница', async () => {
    /* Метка разбора журналов — номер блока; истолковать её как ключ
       страницы индексатора нельзя. Показать начало заново — худшее,
       что при этом допустимо. */
    await source.fetch({ ...query, cursor: { providerId: 'logs', value: '19000:10000' } }, node)

    const withKey = node.requests.filter(
      (request) => 'pageKey' in ((request.params?.[0] as Record<string, unknown>) ?? {}),
    )

    expect(node.requests).toHaveLength(2)
    expect(withKey).toHaveLength(0)
  })
})
