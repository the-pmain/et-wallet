import type { Address, ChainId, HexString } from '@/core/types'

import type { IDappRequest, IDappSession } from './types'

/**
 * Reply to an application request.
 *
 * A REFUSAL IS A FULL REPLY, NOT SILENCE. An application that gets
 * no reply hangs waiting and pushes the user to press again; a
 * second press leads to a second signature.
 */
export type DappResponse =
  | { readonly kind: 'approved'; readonly result: HexString }
  | { readonly kind: 'rejected'; readonly reason: string }

export interface SessionTransportEventMap {
  'session:proposal': {
    readonly id: string
    readonly dapp: IDappSession['dapp']
    readonly chainIds: readonly ChainId[]
  }

  'session:connected': { readonly session: IDappSession }

  /** Connection broken — by our side or by the application. */
  'session:disconnected': { readonly sessionId: string }

  'session:request': { readonly request: IDappRequest }
}

/**
 * Transport for connections to applications.
 *
 * WHY A SEPARATE INTERFACE IF THERE IS ONLY ONE IMPLEMENTATION.
 * Because it is not one in substance: the extension will gain a
 * built-in provider (EIP-1193) that works without any relay, and
 * the logic of showing and confirming a request must stay the same.
 * Plus all of that logic is tested without a network and without a
 * third-party service key.
 *
 * THE TRANSPORT DOES NOT DECIDE. It delivers requests and sends
 * replies. What to show the user, what it risks, and what counts as
 * consent are outside its remit.
 */
export interface ISessionTransport {
  /** Stable identifier. Goes into the log and the UI. */
  readonly id: string

  /** Display name: the user is entitled to know what they are connected through. */
  readonly name: string

  /**
   * Prepares the transport for work.
   *
   * @throws Error if the transport is not configured — for example,
   *         no relay access key is set.
   */
  init(): Promise<void>

  /**
   * Connects from an application invitation.
   *
   * @param uri Invitation string from a QR code or the clipboard.
   */
  pair(uri: string): Promise<void>

  /**
   * Replies to a connection proposal.
   *
   * @param addresses Addresses given to the application. An empty
   *        list means refusal.
   */
  respondToProposal(
    proposalId: string,
    approval: {
      readonly addresses: readonly Address[]
      readonly chainIds: readonly ChainId[]
    } | null,
  ): Promise<void>

  respondToRequest(requestId: string, response: DappResponse): Promise<void>

  /**
   * Tells connected applications about a change of active network
   * and account.
   *
   * WHY THIS IS MANDATORY. The application remembers the network
   * and address at connection time and treats them as current until
   * told otherwise. The owner switched the wallet to another
   * network — the application does not know and prepares an
   * operation for the former. At best the node rejects it, at worst
   * it goes to the wrong chain.
   *
   * BROADCAST TO EVERY CONNECTION. Each application gets both
   * events; which of them matters to it is its own decision.
   *
   * REFUSAL OF ONE CONNECTION DOES NOT KILL THE OTHERS. The
   * application may not have approved the network the wallet
   * switched to, and the relay will reject that event; that is no
   * reason to leave the other applications uninformed.
   */
  notifyStateChange(chainId: ChainId, addresses: readonly Address[]): Promise<void>

  listSessions(): readonly IDappSession[]

  /**
   * Breaks a connection.
   *
   * The application is notified: a session cut off in silence
   * leaves it sure that access remains.
   */
  disconnect(sessionId: string): Promise<void>

  on<TEvent extends keyof SessionTransportEventMap>(
    event: TEvent,
    listener: (payload: SessionTransportEventMap[TEvent]) => void,
  ): () => void

  destroy(): Promise<void>
}
