import type { Address, ChainId, HexString } from '@/core/types'

import type { IDappRequest, IDappSession } from './types'

/**
 * Ответ на запрос приложения.
 *
 * ОТКАЗ — ПОЛНОЦЕННЫЙ ОТВЕТ, А НЕ МОЛЧАНИЕ. Приложение, не получившее
 * ответа, висит в ожидании и подталкивает пользователя нажать ещё раз;
 * второе нажатие приводит ко второй подписи.
 */
export type DappResponse =
  | { readonly kind: 'approved'; readonly result: HexString }
  | { readonly kind: 'rejected'; readonly reason: string }

/** События транспорта сессий. */
export interface SessionTransportEventMap {
  /** Приложение просит подключиться. */
  'session:proposal': {
    readonly id: string
    readonly dapp: IDappSession['dapp']
    readonly chainIds: readonly ChainId[]
  }

  /** Подключение установлено. */
  'session:connected': { readonly session: IDappSession }

  /** Подключение разорвано — своей стороной либо приложением. */
  'session:disconnected': { readonly sessionId: string }

  /** Пришёл запрос, требующий решения пользователя. */
  'session:request': { readonly request: IDappRequest }
}

/**
 * Транспорт подключений к приложениям.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ИНТЕРФЕЙС, ЕСЛИ РЕАЛИЗАЦИЯ ОДНА. Затем, что она
 * не одна по существу: у расширения появится встроенный провайдер
 * (EIP-1193), работающий без всякого relay, а логика показа
 * и подтверждения запроса при этом обязана остаться той же самой.
 * Плюс — вся эта логика проверяется тестами без сети и без ключа
 * стороннего сервиса.
 *
 * ТРАНСПОРТ НЕ ПРИНИМАЕТ РЕШЕНИЙ. Он доставляет запросы и отправляет
 * ответы. Что показать пользователю, чем это грозит и что считать
 * согласием — вне его ведения.
 */
export interface ISessionTransport {
  /** Устойчивый идентификатор. Попадает в журнал и в интерфейс. */
  readonly id: string

  /** Имя для показа: пользователь вправе знать, через что он подключён. */
  readonly name: string

  /**
   * Готовит транспорт к работе.
   *
   * @throws Error если транспорт не настроен — например, не задан ключ
   *         доступа к relay.
   */
  init(): Promise<void>

  /**
   * Подключается по приглашению приложения.
   *
   * @param uri Строка приглашения, полученная из QR-кода либо
   *        из буфера обмена.
   */
  pair(uri: string): Promise<void>

  /**
   * Отвечает на предложение подключения.
   *
   * @param addresses Адреса, выдаваемые приложению. Пустой список
   *        означает отказ.
   */
  respondToProposal(
    proposalId: string,
    approval: {
      readonly addresses: readonly Address[]
      readonly chainIds: readonly ChainId[]
    } | null,
  ): Promise<void>

  /** Отвечает на запрос подписи. */
  respondToRequest(requestId: string, response: DappResponse): Promise<void>

  /**
   * Сообщает подключённым приложениям о смене активной сети и аккаунта.
   *
   * ЗАЧЕМ ЭТО ОБЯЗАТЕЛЬНО. Приложение запоминает сеть и адрес в момент
   * подключения и считает их действующими, пока ему не сказали иное.
   * Владелец переключил кошелёк на другую сеть — приложение об этом
   * не знает и готовит операцию для прежней. В лучшем случае она
   * отвергается узлом, в худшем — уходит не в ту цепь.
   *
   * ШИРОКОВЕЩАТЕЛЬНО ПО ВСЕМ ПОДКЛЮЧЕНИЯМ. Каждое приложение получает
   * оба события; какое из них важно именно ему, решает оно само.
   *
   * ОТКАЗ ОДНОГО ПОДКЛЮЧЕНИЯ НЕ ГУБИТ ОСТАЛЬНЫЕ. Приложение могло
   * не одобрять сеть, на которую переключился кошелёк, и relay отвергнет
   * такое событие; это не повод оставить прочие приложения
   * в неведении.
   */
  notifyStateChange(chainId: ChainId, addresses: readonly Address[]): Promise<void>

  /** Действующие подключения. */
  listSessions(): readonly IDappSession[]

  /**
   * Разрывает подключение.
   *
   * Приложение уведомляется: сессия, оборванная молча, оставляет его
   * в уверенности, что доступ есть.
   */
  disconnect(sessionId: string): Promise<void>

  on<TEvent extends keyof SessionTransportEventMap>(
    event: TEvent,
    listener: (payload: SessionTransportEventMap[TEvent]) => void,
  ): () => void

  /** Закрывает соединения и освобождает ресурсы. */
  destroy(): Promise<void>
}
