import { beforeEach, describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import { SecureStorage } from '@/core/encryption'
import {
  GasEstimationFailedError,
  InsufficientFundsError,
  InsufficientTokenBalanceError,
  NftNotOwnedError,
} from '@/core/errors'
import { EventBus } from '@/core/events'
import {
  BUILT_IN_CHAIN_ID,
  BUILT_IN_NETWORKS,
  DEFAULT_CHAIN_ID,
  NetworkRepository,
  NetworkService,
} from '@/core/network'
import type { IFeeData, ILogEntry, IProvider, ProviderEventMap } from '@/core/provider'
import { MemoryStorageService } from '@/core/storage'
import { TOKEN_STANDARD } from '@/core/token'
import { toWei, type ChainId, type HexString, type TxHash, type Wei } from '@/core/types'
import { FakeClock, FakeProviderFactory, FastEncryptionService, NullLogger } from '@/test/doubles'

import { TransactionRepository } from './TransactionRepository'
import { TransactionService } from './TransactionService'
import { FEE_PRIORITY, TRANSACTION_TYPE, type ISignedTransaction } from './types'

const PASSWORD = 'Korova-7-Luna!'

const CHAIN_ID = BUILT_IN_CHAIN_ID.Ethereum
const SENDER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const RECIPIENT = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

/** Один эфир в минимальных единицах. */
const ONE_ETHER = 10n ** 18n

class StubProvider implements IProvider {
  readonly chainId = CHAIN_ID
  readonly rpcUrl = 'https://stub.example'
  readonly isActive = true

  balance: bigint = ONE_ETHER * 10n
  nonce = 7
  gasEstimate: bigint | Error = 21_000n
  feeData: IFeeData = {
    baseFeePerGas: 20_000_000_000n,
    maxFeePerGas: 30_000_000_000n,
    maxPriorityFeePerGas: 2_000_000_000n,
    gasPrice: 25_000_000_000n,
  }

  sentRaw: HexString | null = null
  sendError: Error | null = null

  readonly #events = new EventBus<ProviderEventMap>()

  getNonce(): Promise<number> {
    return Promise.resolve(this.nonce)
  }

  /** Байт-код по адресу. Обычный адрес: проверок контракта в этих тестах нет. */
  getCode(): Promise<HexString> {
    return Promise.resolve('0x' as HexString)
  }
  estimateGas(): Promise<bigint> {
    return this.gasEstimate instanceof Error
      ? Promise.reject(this.gasEstimate)
      : Promise.resolve(this.gasEstimate)
  }

  getFeeData(): Promise<IFeeData> {
    return Promise.resolve(this.feeData)
  }

  getBalance(): Promise<Wei> {
    return Promise.resolve(toWei(this.balance))
  }

  sendRawTransaction(raw: HexString): Promise<TxHash> {
    if (this.sendError !== null) {
      return Promise.reject(this.sendError)
    }

    this.sentRaw = raw

    return Promise.resolve('0xdeadbeef' as TxHash)
  }

  getTransactionReceipt(): Promise<null> {
    return Promise.resolve(null)
  }

  getBlockNumber(): Promise<bigint> {
    return Promise.resolve(1n)
  }

  getChainId(): Promise<ChainId> {
    return Promise.resolve(CHAIN_ID)
  }

  request<TResult>(): Promise<TResult> {
    return Promise.reject(new Error('не поддержано'))
  }

  getTransactionCount(): Promise<number> {
    return Promise.resolve(this.nonce)
  }

  /** Ответ контракта на `call`. По умолчанию — баланс токена. */
  tokenBalance = 1_000_000n

  /** Владелец предмета, которого назовёт `ownerOf`. */
  nftOwner: string | null = null

  /** Отказ узла при чтении баланса токена. */
  callError: Error | null = null

  call(request: { readonly data?: HexString }): Promise<HexString> {
    if (this.callError !== null) {
      return Promise.reject(this.callError)
    }

    /* `ownerOf` отвечает адресом; отсутствие владельца — откат,
       как у сожжённого предмета. */
    if (this.nftOwner !== null && (request.data ?? '').startsWith('0x6352211e')) {
      return Promise.resolve(
        `0x${this.nftOwner.slice(2).toLowerCase().padStart(64, '0')}` as HexString,
      )
    }

    return Promise.resolve(`0x${this.tokenBalance.toString(16).padStart(64, '0')}` as HexString)
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
let service: TransactionService
let repository: TransactionRepository

const request = { chainId: CHAIN_ID, from: SENDER, to: RECIPIENT, value: toWei(ONE_ETHER) }

beforeEach(async () => {
  node = new StubProvider()

  const storage = new MemoryStorageService()
  const secure = new SecureStorage(storage, new FastEncryptionService())

  await secure.initialize(PASSWORD)

  const logger = new NullLogger()
  const networks = new NetworkService({
    repository: new NetworkRepository(storage),
    providerFactory: new FakeProviderFactory(),
    logger,
    builtInNetworks: BUILT_IN_NETWORKS,
    defaultChainId: DEFAULT_CHAIN_ID,
  })

  await networks.init()

  repository = new TransactionRepository(secure)
  service = new TransactionService({
    resolver: { get: () => Promise.resolve(node) },
    networks,
    repository,
    clock: new FakeClock(1_700_000_000_000),
    logger,
  })
})

describe('TransactionService.prepare', () => {
  it('берёт nonce с учётом мемпула', async () => {
    /* Значение без учёта ожидающих транзакций заставило бы новую
       заменить собой предыдущую вместо постановки в очередь. */
    expect((await service.prepare(request)).nonce).toBe(7)
  })

  it('подставляет chainId сети в подписываемые данные', async () => {
    /* Без chainId подпись действительна во всех сетях EVM сразу
       и проигрывается в основной сети (EIP-155). */
    expect((await service.prepare(request)).chainId).toBe(CHAIN_ID)
  })

  it('добавляет запас к оценке лимита газа', async () => {
    node.gasEstimate = 21_000n

    /* Оценка выполняется на текущем блоке, а транзакция попадёт
       в следующий: точного лимита может не хватить, а неизрасходованный
       газ возвращается. */
    expect((await service.prepare(request)).gasLimit).toBe(25_200n)
  })

  it('строит транзакцию EIP-1559 в поддерживающей сети', async () => {
    const transaction = await service.prepare(request)

    expect(transaction.type).toBe(TRANSACTION_TYPE.Eip1559)
    expect(transaction.maxFeePerGas).toBe(30_000_000_000n)
    expect(transaction.gasPrice).toBeNull()
  })

  it('строит транзакцию прежнего формата, когда узел не сообщает базовую комиссию', async () => {
    node.feeData = { ...node.feeData, maxFeePerGas: null, maxPriorityFeePerGas: null }

    const transaction = await service.prepare(request)

    /* Сеть заявляет EIP-1559, но узел данных не дал: транзакция второго
       типа была бы отвергнута. */
    expect(transaction.type).toBe(TRANSACTION_TYPE.Legacy)
    expect(transaction.gasPrice).toBe(25_000_000_000n)
  })

  it('не отправляет транзакцию, которая откатится', async () => {
    node.gasEstimate = new GasEstimationFailedError('вызов завершится откатом')

    /* Откат означает списание газа без выполнения операции. Назначить
       лимит произвольно в этом случае — гарантированно сжечь средства. */
    await expect(service.prepare(request)).rejects.toBeInstanceOf(GasEstimationFailedError)
  })

  it('отвергает перевод, на который не хватает средств вместе с комиссией', async () => {
    node.balance = ONE_ETHER

    /* Сумма равна балансу, но комиссию платить нечем. Проверка
       выполняется по верхней границе комиссии — именно её проверяет узел. */
    await expect(service.prepare(request)).rejects.toBeInstanceOf(InsufficientFundsError)
  })

  it('пропускает перевод, когда средств хватает вместе с комиссией', async () => {
    node.balance = ONE_ETHER * 2n

    await expect(service.prepare(request)).resolves.toBeDefined()
  })

  it('уважает явно заданные nonce и лимит газа', async () => {
    const transaction = await service.prepare({ ...request, nonce: 42, gasLimit: 100_000n })

    expect(transaction.nonce).toBe(42)
    expect(transaction.gasLimit).toBe(100_000n)
  })
})

describe('TransactionService.estimateFees', () => {
  it('предлагает три уровня срочности', async () => {
    const fees = await service.estimateFees(await service.prepare(request))

    expect(fees.map((fee) => fee.priority)).toEqual([
      FEE_PRIORITY.Low,
      FEE_PRIORITY.Medium,
      FEE_PRIORITY.High,
    ])
  })

  it('повышает приоритетную надбавку с ростом срочности', async () => {
    const fees = await service.estimateFees(await service.prepare(request))
    const tips = fees.map((fee) => fee.maxPriorityFeePerGas ?? 0n)

    expect(tips[0]).toBeLessThan(tips[1] ?? 0n)
    expect(tips[1]).toBeLessThan(tips[2] ?? 0n)
  })

  it('не обещает время подтверждения', async () => {
    const fees = await service.estimateFees(await service.prepare(request))

    /* Время зависит от загрузки сети в момент включения в блок.
       Выдуманное число было бы обещанием, за которое кошелёк
       не отвечает. */
    expect(fees.every((fee) => fee.estimatedSeconds === null)).toBe(true)
  })

  it('считает верхнюю границу списания', async () => {
    const transaction = await service.prepare(request)
    const [fee] = await service.estimateFees(transaction)

    expect(fee?.maxCost).toBe(transaction.gasLimit * (fee?.maxFeePerGas ?? 0n))
  })
})

describe('TransactionService.send', () => {
  const signed = (raw: string): ISignedTransaction => ({
    raw: raw as HexString,
    hash: '0xdeadbeef' as TxHash,
    transaction: {
      type: TRANSACTION_TYPE.Eip1559,
      chainId: CHAIN_ID,
      from: SENDER,
      to: RECIPIENT,
      value: toWei(ONE_ETHER),
      data: '0x' as HexString,
      nonce: 7,
      gasLimit: 21_000n,
      maxFeePerGas: 30_000_000_000n,
      maxPriorityFeePerGas: 2_000_000_000n,
      gasPrice: null,
    },
  })

  it('публикует подписанные байты без изменений', async () => {
    await service.send(signed('0xsigned'))

    expect(node.sentRaw).toBe('0xsigned')
  })

  it('возвращает хэш транзакции', async () => {
    expect(await service.send(signed('0xsigned'))).toBe('0xdeadbeef')
  })

  it('заносит запись в историю после успешной публикации', async () => {
    await service.send(signed('0xsigned'))

    const record = await repository.findByHash('0xdeadbeef' as TxHash)

    expect(record?.status).toBe('pending')
    expect(record?.value).toBe(ONE_ETHER)
  })

  it('не сохраняет запись, если публикация не удалась', async () => {
    node.sendError = new Error('узел не ответил')

    await expect(service.send(signed('0xsigned'))).rejects.toThrow()

    /* Запись о транзакции, которой в сети нет, заставила бы пользователя
       ждать подтверждения того, что никуда не отправлено. */
    expect(await repository.findByHash('0xdeadbeef' as TxHash)).toBeNull()
  })

  it('сообщает о публикации событием', async () => {
    let submitted = 0
    service.on('transaction:submitted', () => {
      submitted += 1
    })

    await service.send(signed('0xsigned'))

    expect(submitted).toBe(1)
  })
})

describe('Перевод токена', () => {
  const TOKEN = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

  const tokenRequest = {
    chainId: CHAIN_ID,
    from: SENDER,
    token: TOKEN,
    to: RECIPIENT,
    amount: 250_000n,
  }

  it('транзакция адресована контракту, а не получателю', async () => {
    /* Перевод токена — вызов функции контракта. Поставить в `to` адрес
       человека значило бы отправить ему нативную валюту вместо токена. */
    const transaction = await service.prepareTokenTransfer(tokenRequest)

    expect(transaction.to).toBe(TOKEN)
  })

  it('нативная валюта не переводится', async () => {
    expect((await service.prepareTokenTransfer(tokenRequest)).value).toBe(0n)
  })

  it('получатель и сумма лежат в данных вызова', async () => {
    const transaction = await service.prepareTokenTransfer(tokenRequest)

    expect(transaction.data).toBe(
      '0xa9059cbb' +
        '000000000000000000000000fb6916095ca1df60bb79ce92ce3ea74c37c5d359' +
        '000000000000000000000000000000000000000000000000000000000003d090',
    )
  })

  it('лимит газа оценивается узлом, а не назначается', async () => {
    /* Вызов контракта стоит дороже простого перевода, и насколько —
       зависит от контракта: у токена с начислениями или чёрным списком
       расход выше. Назначенный наугад лимит приводит к откату
       со списанием газа. */
    node.gasEstimate = 65_000n

    expect((await service.prepareTokenTransfer(tokenRequest)).gasLimit).toBeGreaterThan(65_000n)
  })

  it('отказывает, если токенов на балансе меньше суммы', async () => {
    /* Иначе контракт откатил бы вызов, газ списался, а перевода
       не случилось бы. Отказ узла в оценке газа причину не называет. */
    node.tokenBalance = 100n

    await expect(service.prepareTokenTransfer(tokenRequest)).rejects.toThrow(
      InsufficientTokenBalanceError,
    )
  })

  it('называет требуемое и доступное количество', async () => {
    node.tokenBalance = 100n

    await expect(service.prepareTokenTransfer(tokenRequest)).rejects.toMatchObject({
      required: 250_000n,
      available: 100n,
    })
  })

  it('недоступность контракта не выдаётся за нулевой баланс', async () => {
    /* «Проверить не удалось» и «токенов нет» — разные утверждения.
       Отказ по неполученному значению не давал бы отправить перевод
       из-за недоступности узла. */
    node.tokenBalance = 0n
    node.callError = new Error('узел не ответил')

    await expect(service.prepareTokenTransfer(tokenRequest)).resolves.toMatchObject({ to: TOKEN })
  })

  it('нехватка нативной валюты на комиссию по-прежнему ловится', async () => {
    /* Токенов достаточно, а газ платить нечем. */
    node.balance = 1n

    await expect(service.prepareTokenTransfer(tokenRequest)).rejects.toThrow(InsufficientFundsError)
  })
})

describe('Передача коллекционного предмета', () => {
  const COLLECTION = toAddress('0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D')

  const nftRequest = {
    chainId: CHAIN_ID,
    from: SENDER,
    contract: COLLECTION,
    to: RECIPIENT,
    tokenId: 777n,
    standard: TOKEN_STANDARD.Erc721,
  }

  it('транзакция адресована контракту коллекции', async () => {
    node.nftOwner = SENDER

    expect((await service.prepareNftTransfer(nftRequest)).to).toBe(COLLECTION)
  })

  it('нативная валюта не переводится', async () => {
    node.nftOwner = SENDER

    expect((await service.prepareNftTransfer(nftRequest)).value).toBe(0n)
  })

  it('вызывается безопасная передача', async () => {
    /* Обычный `transferFrom` отправит предмет и контракту, который
       не умеет их принимать: оттуда он не вернётся никогда. */
    node.nftOwner = SENDER

    expect((await service.prepareNftTransfer(nftRequest)).data.startsWith('0x42842e0e')).toBe(true)
  })

  it('отправитель входит в данные вызова', async () => {
    /* `safeTransferFrom` принимает его явным аргументом: контракт
       разрешает передачу и доверенному лицу. */
    node.nftOwner = SENDER

    const data = (await service.prepareNftTransfer(nftRequest)).data

    expect(data.slice(10, 74)).toContain(SENDER.slice(2).toLowerCase())
  })

  it('отказывает, если предмет принадлежит другому адресу', async () => {
    /* Контракт отверг бы вызов и сам, но газ при этом списался бы,
       а причина осталась бы невнятной. */
    node.nftOwner = RECIPIENT

    await expect(service.prepareNftTransfer(nftRequest)).rejects.toThrow(NftNotOwnedError)
  })

  it('ERC-1155 передаётся с количеством', async () => {
    node.tokenBalance = 5n

    const transaction = await service.prepareNftTransfer({
      ...nftRequest,
      standard: TOKEN_STANDARD.Erc1155,
      amount: 3n,
    })

    expect(transaction.data.startsWith('0xf242432a')).toBe(true)
    expect(BigInt(`0x${transaction.data.slice(202, 266)}`)).toBe(3n)
  })

  it('ERC-1155 отказывает, когда экземпляров меньше', async () => {
    node.tokenBalance = 1n

    await expect(
      service.prepareNftTransfer({
        ...nftRequest,
        standard: TOKEN_STANDARD.Erc1155,
        amount: 3n,
      }),
    ).rejects.toThrow(NftNotOwnedError)
  })

  it('недоступность контракта не запрещает передачу', async () => {
    /* «Проверить не удалось» и «предмет не ваш» — разные утверждения.
       Отказ по молчанию узла не дал бы распорядиться своим имуществом. */
    node.callError = new Error('узел не ответил')

    await expect(service.prepareNftTransfer(nftRequest)).resolves.toMatchObject({
      to: COLLECTION,
    })
  })
})
