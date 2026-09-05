import type { ITypedData } from '@/core/transaction'
import type { Address, ChainId, HexString } from '@/core/types'

/**
 * What exactly the remote side is asking for.
 *
 * THE ENUMERATION IS CLOSED. A method that is not here will not be
 * handled: an unknown request must be rejected, not passed through
 * "just in case". Signing what we do not parse means signing blind.
 */
export const DAPP_REQUEST_KIND = {
  SignMessage: 'sign-message',
  SignTypedData: 'sign-typed-data',
  SendTransaction: 'send-transaction',
  SignTransaction: 'sign-transaction',
} as const

export type DappRequestKind = (typeof DAPP_REQUEST_KIND)[keyof typeof DAPP_REQUEST_KIND]

/**
 * Details of the application that sent the request.
 *
 * EVERY FIELD IS UNTRUSTED. Name, description, and site address are
 * set by the application itself: anyone can call themselves
 * "Uniswap". The UI must show them as a party's claim, not as an
 * established fact.
 */
export interface IDappMetadata {
  readonly name: string
  readonly url: string
  readonly description: string | null
  readonly iconUrl: string | null
}

export interface IDappTransaction {
  readonly from: Address
  readonly to: Address | null
  readonly value: bigint
  readonly data: HexString | null

  /** Gas limit, if the application set one. */
  readonly gasLimit: bigint | null
}

export interface ISignMessageRequest {
  readonly kind: typeof DAPP_REQUEST_KIND.SignMessage
  readonly address: Address

  /** Message in the form it was sent. */
  readonly message: string
}

export interface ISignTypedDataRequest {
  readonly kind: typeof DAPP_REQUEST_KIND.SignTypedData
  readonly address: Address
  readonly typedData: ITypedData
}

export interface ITransactionRequestFromDapp {
  readonly kind: typeof DAPP_REQUEST_KIND.SendTransaction | typeof DAPP_REQUEST_KIND.SignTransaction
  readonly transaction: IDappTransaction
}

export type DappRequestPayload =
  ISignMessageRequest | ISignTypedDataRequest | ITransactionRequestFromDapp

export interface IDappRequest {
  /** Stable identifier: the reply is sent against it. */
  readonly id: string

  readonly sessionId: string

  readonly dapp: IDappMetadata

  /**
   * Network in which the application asks the action to be done.
   *
   * May differ from the wallet's active network — and that is a
   * separate reason for a warning, not for a silent switch.
   */
  readonly chainId: ChainId

  readonly payload: DappRequestPayload
}

export interface IDappSession {
  readonly id: string
  readonly dapp: IDappMetadata

  /** Networks the application was given access to. */
  readonly chainIds: readonly ChainId[]

  /** Addresses given to the application. */
  readonly addresses: readonly Address[]

  readonly connectedAt: number

  /** Expiry, if the transport reported one. */
  readonly expiresAt: number | null
}
