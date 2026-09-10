import { createContext, use } from 'react'

import type { IDappSnapshot } from './DappSessionService'

const EMPTY: IDappSnapshot = {
  isReady: false,
  error: null,
  sessions: [],
  proposal: null,
  request: null,
}

export interface IDappContextValue {
  readonly snapshot: IDappSnapshot

  readonly init: () => Promise<void>
  readonly pair: (uri: string) => Promise<void>
  readonly respondToProposal: (isApproved: boolean) => Promise<void>
  readonly respondToRequest: (isApproved: boolean) => Promise<void>
  readonly disconnect: (sessionId: string) => Promise<void>
}

/**
 * Context of connections to applications.
 *
 * THE DEFAULT VALUE APPROVES NOTHING. A component outside the
 * provider gets empty state and no-op actions. The opposite —
 * "outside the provider everything is allowed" — would turn a
 * forgotten provider into a silent consent to sign.
 */
export const DappContext = createContext<IDappContextValue>({
  snapshot: EMPTY,
  init: () => Promise.resolve(),
  pair: () => Promise.resolve(),
  respondToProposal: () => Promise.resolve(),
  respondToRequest: () => Promise.resolve(),
  disconnect: () => Promise.resolve(),
})

export function useDapp(): IDappContextValue {
  return use(DappContext)
}
