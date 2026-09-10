import { describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import { toChainId, type ChainId } from '@/core/types'

import { notifyDappsOnWalletChange } from './createAppServices'

const OWNER_A = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const OWNER_B = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')
const ETHEREUM = toChainId(1n)
const POLYGON = toChainId(137n)

function fakeSession(chainId: ChainId, address: string) {
  const listeners = new Set<() => void>()
  let snapshot = { activeNetwork: { chainId }, activeAccount: { address } }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
    getSnapshot() {
      return snapshot
    },
    set(next: { chainId?: ChainId; address?: string }) {
      snapshot = {
        activeNetwork: { chainId: next.chainId ?? snapshot.activeNetwork.chainId },
        activeAccount: { address: next.address ?? snapshot.activeAccount.address },
      }

      for (const listener of listeners) {
        listener()
      }
    },
  }
}

describe('dapp notification on wallet state change', () => {
  it('notifies when the network changes', () => {
    const session = fakeSession(ETHEREUM, OWNER_A)
    let calls = 0

    notifyDappsOnWalletChange(session as never, {
      notifyWalletState: () => {
        calls += 1

        return Promise.resolve()
      },
    })

    session.set({ chainId: POLYGON })

    expect(calls).toBe(1)
  })

  it('notifies when the account changes', () => {
    const session = fakeSession(ETHEREUM, OWNER_A)
    let calls = 0

    notifyDappsOnWalletChange(session as never, {
      notifyWalletState: () => {
        calls += 1

        return Promise.resolve()
      },
    })

    session.set({ address: OWNER_B })

    expect(calls).toBe(1)
  })

  it('does not emit a second event for the same pair', () => {
    /* The session publishes the whole snapshot on any change —
       balance, history, token list. Settling the pair the first time
       must notify: the app needs the current network and address.
       A later update with the same pair must not, or an event would
       fire on every balance recalculation. */
    const session = fakeSession(ETHEREUM, OWNER_A)
    let calls = 0

    notifyDappsOnWalletChange(session as never, {
      notifyWalletState: () => {
        calls += 1

        return Promise.resolve()
      },
    })

    session.set({ chainId: POLYGON })
    const afterFirstSwitch = calls

    /* Same pair as after the switch: the snapshot "updated",
       network and address did not. */
    session.set({ chainId: POLYGON, address: OWNER_A })

    expect(calls).toBe(afterFirstSwitch)
  })

  it('emits a notification for each new change', () => {
    const session = fakeSession(ETHEREUM, OWNER_A)
    let calls = 0

    notifyDappsOnWalletChange(session as never, {
      notifyWalletState: () => {
        calls += 1

        return Promise.resolve()
      },
    })

    session.set({ chainId: POLYGON })
    session.set({ address: OWNER_B })
    session.set({ chainId: ETHEREUM })

    expect(calls).toBe(3)
  })
})
