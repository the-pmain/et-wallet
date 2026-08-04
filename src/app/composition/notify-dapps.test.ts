import { describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import { toChainId, type ChainId } from '@/core/types'

import { notifyDappsOnWalletChange } from './createAppServices'

const OWNER_A = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const OWNER_B = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')
const ETHEREUM = toChainId(1n)
const POLYGON = toChainId(137n)

/** Сессия кошелька, у которой можно менять активную пару и дёргать подписчиков. */
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
    /** Меняет состояние и оповещает подписчиков — как настоящая сессия. */
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

describe('Уведомление приложений при смене состояния кошелька', () => {
  it('смена сети вызывает уведомление', () => {
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

  it('смена аккаунта вызывает уведомление', () => {
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

  it('повторное обновление с той же парой второго события не даёт', () => {
    /* Сессия публикует снимок целиком при любом изменении — балансе,
       истории, списке токенов. Первое оседание пары уведомить обязано:
       приложение должно узнать текущие сеть и адрес. Но следующее
       обновление с той же парой — уже нет, иначе событие уходило бы
       на каждый пересчёт баланса. */
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

    /* Та же пара, что и после переключения: снимок «обновился»,
       сеть и адрес не менялись. */
    session.set({ chainId: POLYGON, address: OWNER_A })

    expect(calls).toBe(afterFirstSwitch)
  })

  it('каждая новая смена вызывает своё уведомление', () => {
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
