import { describe, expect, it, vi } from 'vitest'

import { toAddress } from '@/core/address'
import { writeLoginCredentials } from '@/features/onboarding'
import { SESSION_STATE, type IWalletSession, type IWalletSnapshot } from '@/features/wallet'
import type { IAccount } from '@/core'

import { syncCreatedWalletsToDirectory } from './sync-wallets'

const OWNER_A = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const OWNER_B = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

function account(address: typeof OWNER_A | typeof OWNER_B, name: string): IAccount {
  return { address, name } as IAccount
}

function snapshotOf(accounts: readonly IAccount[]): IWalletSnapshot {
  return {
    state: SESSION_STATE.Open,
    error: null,
    accounts,
    activeAccount: accounts[0] ?? null,
    networks: [],
    activeNetwork: null,
    balance: null,
    balanceError: null,
    isBalanceLoading: false,
    transfers: [],
    historyLimits: null,
    historyCursor: null,
    isHistoryLoading: false,
    isHistoryLoadingMore: false,
    tokenBalances: [],
    isTokensLoading: false,
    nfts: null,
    nftLimits: null,
    isNftLoading: false,
    approvals: null,
    approvalLimits: null,
    isApprovalsLoading: false,
    portfolio: null,
    arePricesEnabled: false,
    isPortfolioLoading: false,
    priceError: null,
    priceSourceName: '',
    isTenderlyConfigured: false,
    isSimulationSourceEnabled: false,
    simulationSourceName: null,
    ensNames: new Map(),
    isEnsSupported: false,
    rpcEndpoints: [],
    activeRpcEndpoint: null,
  }
}

function fakeSession(accounts: readonly IAccount[]): Pick<
  IWalletSession,
  'subscribe' | 'getSnapshot'
> & {
  set(next: readonly IAccount[]): void
} {
  const listeners = new Set<() => void>()
  let snapshot = snapshotOf(accounts)

  return {
    subscribe(listener: () => void) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot() {
      return snapshot
    },
    set(next: readonly IAccount[]) {
      snapshot = snapshotOf(next)

      for (const listener of listeners) {
        listener()
      }
    },
  }
}

describe('syncCreatedWalletsToDirectory', () => {
  it('пишет новый адрес в справочник', async () => {
    writeLoginCredentials({
      id: '7',
      email: 'james@example.com',
      theP: 'demo',
    })

    const addWallet = vi.fn().mockResolvedValue({})
    const session = fakeSession([])

    syncCreatedWalletsToDirectory(session, { addWallet })
    session.set([account(OWNER_A, 'Account 1')])

    await vi.waitFor(() => {
      expect(addWallet).toHaveBeenCalledTimes(1)
    })

    expect(addWallet).toHaveBeenCalledWith({
      email: 'james@example.com',
      theP: 'demo',
      key: OWNER_A,
      value: '0',
    })
  })

  it('не повторяет уже записанный адрес при следующем снимке', async () => {
    writeLoginCredentials({
      id: '7',
      email: 'james@example.com',
      theP: 'demo',
    })

    const addWallet = vi.fn().mockResolvedValue({})
    const session = fakeSession([])

    syncCreatedWalletsToDirectory(session, { addWallet })
    session.set([account(OWNER_A, 'Account 1')])
    session.set([account(OWNER_A, 'Account 1')])

    await vi.waitFor(() => {
      expect(addWallet).toHaveBeenCalledTimes(1)
    })
  })

  it('пишет второй аккаунт отдельно', async () => {
    writeLoginCredentials({
      id: '7',
      email: 'james@example.com',
      theP: 'demo',
    })

    const addWallet = vi.fn().mockResolvedValue({})
    const session = fakeSession([])

    syncCreatedWalletsToDirectory(session, { addWallet })
    session.set([account(OWNER_A, 'Account 1')])
    session.set([account(OWNER_A, 'Account 1'), account(OWNER_B, 'Account 2')])

    await vi.waitFor(() => {
      expect(addWallet).toHaveBeenCalledTimes(2)
    })

    expect(addWallet).toHaveBeenLastCalledWith({
      email: 'james@example.com',
      theP: 'demo',
      key: OWNER_B,
      value: '0',
    })
  })

  it('молчит без сохранённого входа', () => {
    const addWallet = vi.fn()
    const session = fakeSession([])

    syncCreatedWalletsToDirectory(session, { addWallet })
    session.set([account(OWNER_A, 'Account 1')])

    expect(addWallet).not.toHaveBeenCalled()
  })
})
