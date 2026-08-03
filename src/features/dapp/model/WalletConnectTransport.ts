import {
  toAddress,
  toChainId,
  type Address,
  type ChainId,
  type DappResponse,
  type HexString,
  type IDappRequest,
  type IDappSession,
  type ILogger,
  type ISessionTransport,
  type SessionTransportEventMap,
} from '@/core'

import { parseCaip2, toCaip2, toCaip10 } from './caip'
import { toDappRequest } from './request-mapping'
import { TransportEvents } from './TransportEvents'

const TRANSPORT_ID = 'walletconnect'
const TRANSPORT_NAME = 'WalletConnect'

/**
 * Пространство имён CAIP-2 для сетей EVM.
 *
 * Кошелёк работает только с ними: заявить поддержку другой цепи
 * значило бы пообещать подпись ключом, которого у нас нет.
 */
const EVM_NAMESPACE = 'eip155'

/**
 * Методы, которые кошелёк умеет выполнять.
 *
 * `eth_sign` В СПИСОК НЕ ВХОДИТ НАМЕРЕННО. Он подписывает произвольные
 * 32 байта без префикса, то есть позволяет приложению получить подпись
 * под хэшем транзакции, ничего не показав владельцу. Заявлять поддержку
 * метода, который мы отвергаем при исполнении, нельзя: приложение
 * построило бы на нём работу и получило отказ в самый неподходящий
 * момент.
 */
const SUPPORTED_METHODS: readonly string[] = [
  'personal_sign',
  'eth_signTypedData',
  'eth_signTypedData_v4',
  'eth_sendTransaction',
  'eth_signTransaction',
]

/** События, на которые кошелёк подписывает приложение. */
const SUPPORTED_EVENTS: readonly string[] = ['accountsChanged', 'chainChanged']

/** Настройки транспорта. */
export interface IWalletConnectOptions {
  /** Идентификатор проекта в Reown (WalletConnect Cloud). Без него relay не пускает. */
  readonly projectId: string

  /** Сведения о кошельке, показываемые приложению. */
  readonly metadata: {
    readonly name: string
    readonly description: string
    readonly url: string
    readonly icons: readonly string[]
  }

  readonly logger: ILogger
}

/**
 * Подключение к приложениям по WalletConnect v2.
 *
 * ЗАГРУЖАЕТСЯ ЛЕНИВО. Библиотека весит около трёх мегабайт
 * в распакованном виде; загружать её при старте значило бы заставить
 * экран ввода пароля ждать код, который может не понадобиться вовсе.
 * Импорт выполняется в `init`, то есть при первом обращении к разделу
 * подключений.
 *
 * ЧТО ВИДИТ RELAY-СЕРВЕР. Адрес кошелька, метаданные каждого
 * приложения и время каждого запроса. Это утечка уровня индексатора,
 * и поэтому подключения включаются явным действием пользователя,
 * а не сами по себе.
 *
 * ТРАНСПОРТ НЕ ПРИНИМАЕТ РЕШЕНИЙ. Он превращает сообщения relay
 * в запросы понятного ядру вида и отправляет обратно то, что решил
 * пользователь. Оценка риска, показ и подтверждение живут выше.
 */
export class WalletConnectTransport implements ISessionTransport {
  readonly id = TRANSPORT_ID
  readonly name = TRANSPORT_NAME

  readonly #options: IWalletConnectOptions
  readonly #logger: ILogger
  readonly #events = new TransportEvents()

  /* Тип клиента не импортируется на верхнем уровне: это втянуло бы
     библиотеку в основной чанк и отменило ленивую загрузку. */
  #client: WalletConnectClient | null = null

  constructor(options: IWalletConnectOptions) {
    this.#options = options
    this.#logger = options.logger.child(TRANSPORT_NAME)
  }

  async init(): Promise<void> {
    if (this.#client !== null) {
      return
    }

    if (this.#options.projectId === '') {
      throw new Error(
        'WalletConnect is not configured: the project identifier is missing. ' +
          'Connecting to applications is unavailable; the rest of the wallet works.',
      )
    }

    const { default: SignClient } = await import('@walletconnect/sign-client')

    const client = (await SignClient.init({
      projectId: this.#options.projectId,
      metadata: { ...this.#options.metadata, icons: [...this.#options.metadata.icons] },
    })) as unknown as WalletConnectClient

    this.#subscribe(client)
    this.#client = client

    this.#logger.info('The connection transport is ready', { sessions: this.listSessions().length })
  }

  async pair(uri: string): Promise<void> {
    await this.#requireClient().core.pairing.pair({ uri })
  }

  async respondToProposal(
    proposalId: string,
    approval: {
      readonly addresses: readonly Address[]
      readonly chainIds: readonly ChainId[]
    } | null,
  ): Promise<void> {
    const client = this.#requireClient()
    const id = Number(proposalId)

    if (approval === null) {
      /* Отказ отправляется явно: приложение, не получившее ответа,
         висит в ожидании и подталкивает пользователя нажать ещё раз. */
      await client.reject({ id, reason: { code: 5000, message: 'Rejected by the user' } })

      return
    }

    const accounts = approval.chainIds.flatMap((chainId) =>
      approval.addresses.map((address) => toCaip10(chainId, address)),
    )

    await client.approve({
      id,
      namespaces: {
        [EVM_NAMESPACE]: {
          accounts,
          chains: approval.chainIds.map((chainId) => toCaip2(chainId)),
          methods: [...SUPPORTED_METHODS],
          events: [...SUPPORTED_EVENTS],
        },
      },
    })
  }

  async respondToRequest(requestId: string, response: DappResponse): Promise<void> {
    const client = this.#requireClient()
    const [topic = '', rawId = ''] = requestId.split('|')

    await client.respond({
      topic,
      response:
        response.kind === 'approved'
          ? { id: Number(rawId), jsonrpc: '2.0', result: response.result }
          : {
              id: Number(rawId),
              jsonrpc: '2.0',
              /* Код 4001 — отказ пользователя по EIP-1193. Приложения
                 узнают его и не считают сбоем связи. */
              error: { code: 4001, message: response.reason },
            },
    })
  }

  listSessions(): readonly IDappSession[] {
    if (this.#client === null) {
      return []
    }

    return this.#client.session.getAll().map((session) => toDappSession(session))
  }

  async disconnect(sessionId: string): Promise<void> {
    await this.#requireClient().disconnect({
      topic: sessionId,
      reason: { code: 6000, message: 'Disconnected by the user' },
    })

    this.#events.emit('session:disconnected', { sessionId })
  }

  on<TEvent extends keyof SessionTransportEventMap>(
    event: TEvent,
    listener: (payload: SessionTransportEventMap[TEvent]) => void,
  ): () => void {
    return this.#events.on(event, listener)
  }

  async destroy(): Promise<void> {
    /* Соединение с relay закрывается вместе с блокировкой кошелька:
       открытый канал продолжал бы сообщать оператору, что владелец
       за устройством. */
    await this.#client?.core.relayer.transportClose()
    this.#client = null
  }

  /** Transferит события библиотеки в события транспорта. */
  #subscribe(client: WalletConnectClient): void {
    client.on('session_proposal', (event) => {
      this.#events.emit('session:proposal', {
        id: String(event.id),
        dapp: toMetadata(event.params.proposer.metadata),
        chainIds: readProposedChains(event.params),
      })
    })

    client.on('session_request', (event) => {
      const request = toDappRequest({
        topic: event.topic,
        id: event.id,
        chainId: parseCaip2(event.params.chainId),
        method: event.params.request.method,
        params: event.params.request.params,
        dapp: toMetadata(client.session.get(event.topic)?.peer.metadata),
      })

      if (request === null) {
        /* Неизвестный метод отклоняется, а не пропускается: подписать
           то, чего мы не разбираем, значит подписать вслепую. */
        void this.respondToRequest(`${event.topic}|${String(event.id)}`, {
          kind: 'rejected',
          reason: 'The method is not supported by this wallet',
        })

        return
      }

      this.#events.emit('session:request', { request })
    })

    client.on('session_delete', (event) => {
      this.#events.emit('session:disconnected', { sessionId: event.topic })
    })
  }

  #requireClient(): WalletConnectClient {
    if (this.#client === null) {
      throw new Error('The connection transport is not initialised.')
    }

    return this.#client
  }
}

/**
 * Минимальная форма клиента, которой пользуется транспорт.
 *
 * Объявлена здесь, а не импортирована: импорт типа из библиотеки
 * потянул бы её в основной чанк и отменил ленивую загрузку. Набор
 * узкий — ровно то, что вызывается ниже.
 */
interface WalletConnectClient {
  readonly core: {
    readonly pairing: { pair(params: { uri: string }): Promise<unknown> }
    readonly relayer: { transportClose(): Promise<void> }
  }
  readonly session: {
    getAll(): readonly RawSession[]
    get(topic: string): RawSession | undefined
  }
  approve(params: unknown): Promise<unknown>
  reject(params: unknown): Promise<void>
  respond(params: unknown): Promise<void>
  disconnect(params: unknown): Promise<void>
  on(event: 'session_proposal', listener: (event: RawProposal) => void): void
  on(event: 'session_request', listener: (event: RawRequest) => void): void
  on(event: 'session_delete', listener: (event: { topic: string }) => void): void
}

interface RawMetadata {
  readonly name?: string
  readonly url?: string
  readonly description?: string
  readonly icons?: readonly string[]
}

interface RawSession {
  readonly topic: string
  readonly expiry: number
  readonly peer: { readonly metadata: RawMetadata }
  readonly namespaces: Readonly<Record<string, { readonly accounts?: readonly string[] }>>
}

interface RawProposal {
  readonly id: number
  readonly params: {
    readonly proposer: { readonly metadata: RawMetadata }
    readonly requiredNamespaces?: Readonly<Record<string, { readonly chains?: readonly string[] }>>
    readonly optionalNamespaces?: Readonly<Record<string, { readonly chains?: readonly string[] }>>
  }
}

interface RawRequest {
  readonly topic: string
  readonly id: number
  readonly params: {
    readonly chainId: string
    readonly request: { readonly method: string; readonly params: unknown }
  }
}

/** Приводит метаданные приложения к виду, принятому в ядре. */
function toMetadata(metadata: RawMetadata | undefined) {
  return {
    /* Пустые значения не выдумываются: приложение, не назвавшее себя,
       обязано выглядеть безымянным, а не приобретать чужое имя. */
    name: metadata?.name ?? '',
    url: metadata?.url ?? '',
    description: metadata?.description ?? null,
    iconUrl: metadata?.icons?.[0] ?? null,
  }
}

/** Собирает сети, запрошенные приложением. */
function readProposedChains(params: RawProposal['params']): readonly ChainId[] {
  const chains = [
    ...(params.requiredNamespaces?.[EVM_NAMESPACE]?.chains ?? []),
    ...(params.optionalNamespaces?.[EVM_NAMESPACE]?.chains ?? []),
  ]

  const unique = new Set(chains)

  return [...unique].map((chain) => parseCaip2(chain)).filter((chain) => chain !== null)
}

/** Transferит сессию библиотеки в сессию ядра. */
function toDappSession(session: RawSession): IDappSession {
  const accounts = session.namespaces[EVM_NAMESPACE]?.accounts ?? []
  const addresses: Address[] = []
  const chainIds: ChainId[] = []

  for (const account of accounts) {
    const parts = account.split(':')
    const rawChain = parts[1]
    const rawAddress = parts[2]

    if (rawChain === undefined || rawAddress === undefined) {
      continue
    }

    try {
      const address = toAddress(rawAddress)
      const chainId = toChainId(BigInt(rawChain))

      if (!addresses.some((item) => item === address)) {
        addresses.push(address)
      }

      if (!chainIds.includes(chainId)) {
        chainIds.push(chainId)
      }
    } catch {
      /* Испорченная запись пропускается: одна нечитаемая строка
         не должна лишать пользователя списка подключений целиком. */
    }
  }

  return {
    id: session.topic,
    dapp: toMetadata(session.peer.metadata),
    chainIds,
    addresses,
    connectedAt: 0,
    /* Библиотека отдаёт срок в секундах. */
    expiresAt: session.expiry * 1000,
  }
}

/** Результат подписи, ожидаемый приложением. */
export type SignatureResult = HexString

/** Заготовка запроса, пригодная для тестов транспорта. */
export type { IDappRequest }
