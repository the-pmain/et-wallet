import type { ITypedData } from '@/core/transaction'
import type { Address, ChainId, HexString } from '@/core/types'

/**
 * Что именно просит удалённая сторона.
 *
 * ПЕРЕЧИСЛЕНИЕ ЗАКРЫТОЕ. Метод, не попавший сюда, обрабатываться
 * не будет: неизвестный запрос обязан быть отклонён, а не пропущен
 * «на всякий случай». Подписать то, чего мы не разбираем, — значит
 * подписать вслепую.
 */
export const DAPP_REQUEST_KIND = {
  /** Подпись произвольного сообщения, EIP-191. */
  SignMessage: 'sign-message',
  /** Подпись структурированных данных, EIP-712. */
  SignTypedData: 'sign-typed-data',
  /** Подпись и отправка транзакции. */
  SendTransaction: 'send-transaction',
  /** Подпись транзакции без отправки. */
  SignTransaction: 'sign-transaction',
} as const

export type DappRequestKind = (typeof DAPP_REQUEST_KIND)[keyof typeof DAPP_REQUEST_KIND]

/**
 * Сведения о приложении, приславшем запрос.
 *
 * ВСЕ ПОЛЯ НЕДОВЕРЕННЫЕ. Имя, описание и адрес сайта задаёт само
 * приложение: назваться «Uniswap» может кто угодно. Интерфейс обязан
 * показывать их как заявление стороны, а не как установленный факт.
 */
export interface IDappMetadata {
  readonly name: string
  readonly url: string
  readonly description: string | null
  readonly iconUrl: string | null
}

/** Транзакция, как её прислало приложение. */
export interface IDappTransaction {
  readonly from: Address
  readonly to: Address | null
  readonly value: bigint
  readonly data: HexString | null

  /** Лимит газа, если приложение его назначило. */
  readonly gasLimit: bigint | null
}

/** Запрос на подпись сообщения. */
export interface ISignMessageRequest {
  readonly kind: typeof DAPP_REQUEST_KIND.SignMessage
  readonly address: Address

  /** Сообщение в том виде, в каком его прислали. */
  readonly message: string
}

/** Запрос на подпись структурированных данных. */
export interface ISignTypedDataRequest {
  readonly kind: typeof DAPP_REQUEST_KIND.SignTypedData
  readonly address: Address
  readonly typedData: ITypedData
}

/** Запрос на отправку либо подпись транзакции. */
export interface ITransactionRequestFromDapp {
  readonly kind: typeof DAPP_REQUEST_KIND.SendTransaction | typeof DAPP_REQUEST_KIND.SignTransaction
  readonly transaction: IDappTransaction
}

/** Содержимое запроса. */
export type DappRequestPayload =
  ISignMessageRequest | ISignTypedDataRequest | ITransactionRequestFromDapp

/** Запрос, ожидающий решения пользователя. */
export interface IDappRequest {
  /** Устойчивый идентификатор: по нему отправляется ответ. */
  readonly id: string

  /** Сессия, в рамках которой пришёл запрос. */
  readonly sessionId: string

  readonly dapp: IDappMetadata

  /**
   * Сеть, в которой приложение просит выполнить действие.
   *
   * Может отличаться от активной сети кошелька — и это отдельный повод
   * для предупреждения, а не для молчаливого переключения.
   */
  readonly chainId: ChainId

  readonly payload: DappRequestPayload
}

/** Действующее подключение. */
export interface IDappSession {
  readonly id: string
  readonly dapp: IDappMetadata

  /** Сети, к которым приложение получило доступ. */
  readonly chainIds: readonly ChainId[]

  /** Адреса, выданные приложению. */
  readonly addresses: readonly Address[]

  /** Момент установления подключения. */
  readonly connectedAt: number

  /** Момент истечения, если транспорт его сообщил. */
  readonly expiresAt: number | null
}
