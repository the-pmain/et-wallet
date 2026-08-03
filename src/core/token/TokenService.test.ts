import { beforeEach, describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import { SecureStorage } from '@/core/encryption'
import {
  InvalidTokenContractError,
  NotInitializedError,
  TokenNotFoundError,
  UnsupportedTokenStandardError,
} from '@/core/errors'
import { EventBus } from '@/core/events'
import {
  BUILT_IN_CHAIN_ID,
  BUILT_IN_NETWORKS,
  DEFAULT_CHAIN_ID,
  NetworkRepository,
  NetworkService,
  type INetworkConfig,
} from '@/core/network'
import type { ICallRequest, ILogEntry, IProvider, ProviderEventMap } from '@/core/provider'
import { MemoryStorageService } from '@/core/storage'
import type { ChainId, HexString, Wei } from '@/core/types'
import {
  FakeClock,
  FakeProviderFactory,
  FastEncryptionService,
  NullLogger,
  createSecureMemoryStorage,
} from '@/test/doubles'

import { BALANCE_OF_SELECTOR, DECIMALS_SELECTOR, NAME_SELECTOR, SYMBOL_SELECTOR } from './erc20'
import { TokenRepository } from './TokenRepository'
import { TokenService } from './TokenService'
import { TOKEN_STANDARD } from './types'

const PASSWORD = 'Korova-7-Luna!'

const CHAIN_ID = BUILT_IN_CHAIN_ID.Ethereum
const OWNER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const TOKEN = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

/** Дополняет значение до слова ABI. */
function word(value: string): string {
  return value.padStart(64, '0')
}

/** Кодирует текст как строку переменной длины ABI. */
function encodeText(text: string): HexString {
  const bytes = [...new TextEncoder().encode(text)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

  return `0x${word('20')}${word((bytes.length / 2).toString(16))}${bytes.padEnd(64, '0')}` as HexString
}

/** Ответы контракта на вызовы. `null` означает отказ. */
interface IContractResponses {
  decimals?: string | null
  symbol?: HexString | null
  name?: HexString | null
  balance?: string | null
}

class StubProvider implements IProvider {
  readonly chainId = CHAIN_ID
  readonly rpcUrl = 'https://stub.example'
  readonly isActive = true

  responses: IContractResponses = {}
  logs: readonly ILogEntry[] = []
  calls: ICallRequest[] = []

  readonly #events = new EventBus<ProviderEventMap>()

  call(request: ICallRequest): Promise<HexString> {
    this.calls.push(request)

    const data = request.data ?? ''
    const selector = data.slice(2, 10)
    const answer = this.#answer(selector)

    return answer === null || answer === undefined
      ? Promise.reject(new Error('контракт отказал'))
      : Promise.resolve(answer)
  }

  #answer(selector: string): HexString | null | undefined {
    if (selector === DECIMALS_SELECTOR) {
      const value = this.responses.decimals

      return value === null || value === undefined ? value : (`0x${word(value)}` as HexString)
    }

    if (selector === SYMBOL_SELECTOR) {
      return this.responses.symbol
    }

    if (selector === NAME_SELECTOR) {
      return this.responses.name
    }

    if (selector === BALANCE_OF_SELECTOR) {
      const value = this.responses.balance

      return value === null || value === undefined ? value : (`0x${word(value)}` as HexString)
    }

    return null
  }

  getLogs(): Promise<readonly ILogEntry[]> {
    return Promise.resolve(this.logs)
  }

  getBlockNumber(): Promise<bigint> {
    return Promise.resolve(20_000n)
  }

  getChainId(): Promise<ChainId> {
    return Promise.resolve(CHAIN_ID)
  }

  request<TResult>(): Promise<TResult> {
    return Promise.reject(new Error('не поддержано'))
  }

  getBalance(): Promise<Wei> {
    return Promise.resolve(0n as Wei)
  }

  getTransactionCount(): Promise<number> {
    return Promise.resolve(0)
  }

  getNonce(): Promise<number> {
    return Promise.resolve(0)
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

  destroy(): void {
    /* Дублёру нечего освобождать. */
  }

  on = this.#events.on.bind(this.#events)
  once = this.#events.once.bind(this.#events)
  off = this.#events.off.bind(this.#events)
}

let node: StubProvider
let service: TokenService
let secure: SecureStorage

async function createService(): Promise<TokenService> {
  const storage = new MemoryStorageService()

  secure = new SecureStorage(storage, new FastEncryptionService())
  await secure.initialize(PASSWORD)

  const logger = new NullLogger()
  const networks = new NetworkService({
    repository: new NetworkRepository(secure),
    providerFactory: new FakeProviderFactory(),
    logger,
    builtInNetworks: BUILT_IN_NETWORKS,
    defaultChainId: DEFAULT_CHAIN_ID,
  })

  await networks.init()

  return new TokenService({
    repository: new TokenRepository(secure),
    resolver: { get: (_network: INetworkConfig) => Promise.resolve(node) },
    networks,
    clock: new FakeClock(1_700_000_000_000),
    logger,
  })
}

beforeEach(async () => {
  node = new StubProvider()
  node.responses = {
    decimals: '6',
    symbol: encodeText('USDC'),
    name: encodeText('USD Coin'),
    balance: '1e8480',
  }

  service = await createService()
  await service.init()
})

describe('TokenService: список', () => {
  it('всегда содержит нативную валюту первой', () => {
    const [first] = service.list(CHAIN_ID)

    expect(first?.address).toBeNull()
    expect(first?.standard).toBe(TOKEN_STANDARD.Native)
    expect(first?.symbol).toBe('ETH')
  })

  it('не помечает нативную валюту непроверенной', () => {
    /* Она часть конфигурации сети, а не пользовательская добавка. */
    expect(service.list(CHAIN_ID)[0]?.isCustom).toBe(false)
  })

  it('отказывает до инициализации', async () => {
    const fresh = await createService()

    expect(() => fresh.list(CHAIN_ID)).toThrow(NotInitializedError)
  })

  it('возвращает пустой список для неизвестной сети', () => {
    expect(service.list(999_999n as ChainId)).toHaveLength(0)
  })
})

describe('TokenService: чтение метаданных', () => {
  it('читает символ, имя и число знаков из контракта', async () => {
    const metadata = await service.fetchMetadata(CHAIN_ID, TOKEN)

    expect(metadata.symbol).toBe('USDC')
    expect(metadata.name).toBe('USD Coin')
    expect(metadata.decimals).toBe(6)
  })

  it('отвергает контракт, не сообщающий число знаков', async () => {
    node.responses.decimals = null

    /* Без числа знаков любая показанная сумма — выдумка. */
    await expect(service.fetchMetadata(CHAIN_ID, TOKEN)).rejects.toBeInstanceOf(
      InvalidTokenContractError,
    )
  })

  it('отвергает недопустимое число знаков', async () => {
    node.responses.decimals = 'ff'

    await expect(service.fetchMetadata(CHAIN_ID, TOKEN)).rejects.toBeInstanceOf(
      InvalidTokenContractError,
    )
  })

  it('подставляет усечённый адрес вместо отсутствующего символа', async () => {
    node.responses.symbol = null
    node.responses.name = null

    const metadata = await service.fetchMetadata(CHAIN_ID, TOKEN)

    /* Символ и имя объявлены стандартом необязательными: отказ добавить
       такой токен был бы чрезмерным, а усечённый адрес правдив. */
    expect(metadata.symbol).toContain('0xA0b8')
    expect(metadata.name).toContain('0xA0b8')
  })

  it('читает символ старого токена в виде bytes32', async () => {
    const bytes = [...new TextEncoder().encode('MKR')]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')

    node.responses.symbol = `0x${bytes.padEnd(64, '0')}` as HexString

    expect((await service.fetchMetadata(CHAIN_ID, TOKEN)).symbol).toBe('MKR')
  })
})

describe('TokenService: добавление', () => {
  it('добавляет токен с метаданными из контракта', async () => {
    const token = await service.add({ chainId: CHAIN_ID, address: TOKEN })

    expect(token.symbol).toBe('USDC')
    expect(token.decimals).toBe(6)
    expect(service.list(CHAIN_ID)).toHaveLength(2)
  })

  it('помечает добавленный токен непроверенным', async () => {
    /* Выпустить токен с обозначением известного проекта может кто угодно.
       Встроенного списка проверенных нет: вписанный по памяти адрес
       рисковал бы пометить подделку как настоящую. */
    expect((await service.add({ chainId: CHAIN_ID, address: TOKEN })).isCustom).toBe(true)
  })

  it('отвергает расхождение числа знаков с контрактом', async () => {
    /* Токен с шестью знаками, записанный как восемнадцатизначный,
       покажет одну миллионную настоящего баланса. */
    await expect(
      service.add({ chainId: CHAIN_ID, address: TOKEN, decimals: 18 }),
    ).rejects.toBeInstanceOf(InvalidTokenContractError)
  })

  it('принимает совпадающее число знаков', async () => {
    await expect(
      service.add({ chainId: CHAIN_ID, address: TOKEN, decimals: 6 }),
    ).resolves.toBeDefined()
  })

  it('позволяет переопределить обозначение', async () => {
    /* Символ — подпись на экране, а не арифметика: пользователь вправе
       отличить подделку от настоящего собственной пометкой. */
    const token = await service.add({ chainId: CHAIN_ID, address: TOKEN, symbol: 'USDC (fake?)' })

    expect(token.symbol).toBe('USDC (fake?)')
    expect(token.decimals).toBe(6)
  })

  it('отвергает значение, не являющееся адресом', async () => {
    await expect(
      service.add({ chainId: CHAIN_ID, address: 'не адрес' as typeof TOKEN }),
    ).rejects.toBeInstanceOf(InvalidTokenContractError)
  })

  it('отвергает неподдерживаемый стандарт', async () => {
    await expect(
      service.add({ chainId: CHAIN_ID, address: TOKEN, standard: TOKEN_STANDARD.Erc721 }),
    ).rejects.toBeInstanceOf(UnsupportedTokenStandardError)
  })

  it('переживает перезапуск сессии', async () => {
    await service.add({ chainId: CHAIN_ID, address: TOKEN })

    const restored = await createServiceWith(secure)
    await restored.init()

    expect(restored.list(CHAIN_ID)).toHaveLength(2)
  })

  it('порождает событие смены списка', async () => {
    let changed = 0
    service.on('token:listChanged', () => {
      changed += 1
    })

    await service.add({ chainId: CHAIN_ID, address: TOKEN })

    expect(changed).toBe(1)
  })
})

describe('TokenService: удаление', () => {
  it('убирает токен из списка', async () => {
    await service.add({ chainId: CHAIN_ID, address: TOKEN })
    await service.remove({ chainId: CHAIN_ID, address: TOKEN })

    expect(service.list(CHAIN_ID)).toHaveLength(1)
  })

  it('не позволяет убрать нативную валюту', async () => {
    /* Её отсутствие в списке означало бы, что баланс сети неизвестен. */
    await expect(service.remove({ chainId: CHAIN_ID, address: null })).rejects.toBeInstanceOf(
      UnsupportedTokenStandardError,
    )
  })

  it('отказывает по неизвестному токену', async () => {
    await expect(service.remove({ chainId: CHAIN_ID, address: TOKEN })).rejects.toBeInstanceOf(
      TokenNotFoundError,
    )
  })
})

describe('TokenService: баланс', () => {
  it('читает баланс токена', async () => {
    const balance = await service.getBalance({ chainId: CHAIN_ID, address: TOKEN }, OWNER)

    expect(balance).toBe(0x1e8480n)
  })

  it('передаёт адрес владельца в вызов', async () => {
    await service.getBalance({ chainId: CHAIN_ID, address: TOKEN }, OWNER)

    const call = node.calls.find((item) => (item.data ?? '').includes(BALANCE_OF_SELECTOR))

    expect(call?.data).toContain(OWNER.slice(2).toLowerCase())
  })

  it('отказывает по нативной валюте', async () => {
    await expect(
      service.getBalance({ chainId: CHAIN_ID, address: null }, OWNER),
    ).rejects.toBeInstanceOf(UnsupportedTokenStandardError)
  })

  it('доводит отказ контракта до вызывающего кода', async () => {
    node.responses.balance = null

    /* Ноль вместо отказа означал бы утверждение «средств нет». */
    await expect(
      service.getBalance({ chainId: CHAIN_ID, address: TOKEN }, OWNER),
    ).rejects.toBeInstanceOf(InvalidTokenContractError)
  })
})

/** Пересоздаёт сервис поверх того же защищённого хранилища. */
async function createServiceWith(storage: SecureStorage): Promise<TokenService> {
  const logger = new NullLogger()
  const networks = new NetworkService({
    repository: new NetworkRepository(await createSecureMemoryStorage()),
    providerFactory: new FakeProviderFactory(),
    logger,
    builtInNetworks: BUILT_IN_NETWORKS,
    defaultChainId: DEFAULT_CHAIN_ID,
  })

  await networks.init()

  return new TokenService({
    repository: new TokenRepository(storage),
    resolver: { get: () => Promise.resolve(node) },
    networks,
    clock: new FakeClock(1_700_000_000_000),
    logger,
  })
}

describe('Проверенные контракты', () => {
  /* `TOKEN` — адрес USDC в Ethereum, он входит во встроенный список.
     Дублёр отвечает теми же символом и числом знаков, что записаны
     в списке. */
  const UNKNOWN = toAddress('0x1111111111111111111111111111111111111111')

  it('токен из списка помечается проверенным', async () => {
    expect((await service.add({ chainId: CHAIN_ID, address: TOKEN })).isVerified).toBe(true)
  })

  it('признаки независимы: добавлен вручную и при этом проверен', async () => {
    /* «Добавлен вручную» говорит о том, как токен попал в список,
       «проверен» — о том, известен ли адрес. */
    const token = await service.add({ chainId: CHAIN_ID, address: TOKEN })

    expect(token.isCustom).toBe(true)
    expect(token.isVerified).toBe(true)
  })

  it('незнакомый контракт проверенным не считается', async () => {
    /* Это не обвинение в подделке: список заведомо неполон. */
    expect((await service.add({ chainId: CHAIN_ID, address: UNKNOWN })).isVerified).toBe(false)
  })

  it('расхождение с контрактом снимает пометку', async () => {
    /* Контракт с обновляемой реализацией вправе изменить символ,
       а список в коде мог устареть. Помечать такую запись проверенной
       значило бы поручиться за то, что изменилось без нашего ведома. */
    node.responses.symbol = encodeText('USDX')

    expect((await service.add({ chainId: CHAIN_ID, address: TOKEN })).isVerified).toBe(false)
  })

  it('нативная валюта проверена всегда', () => {
    /* Она часть конфигурации сети, а не пользовательская добавка. */
    const native = service.list(CHAIN_ID)[0]

    expect(native?.address).toBeNull()
    expect(native?.isVerified).toBe(true)
  })
})
