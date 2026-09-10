import { beforeEach, describe, expect, it } from 'vitest'

import { BUILT_IN_CHAIN_ID, type Wei } from '@/core'
import { TEST_MNEMONIC, TEST_MNEMONIC_ADDRESSES } from '@/core/hdwallet/vectors'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'

import { SESSION_STATE } from './contracts'

const PASSWORD = 'Korova-7-Luna!'

/**
 * Expected address comes from the shared vector set, not rewritten
 * here: a constant copied from this code's own output would test the
 * implementation against itself. The set was checked against MetaMask,
 * Rabby, and Trust Wallet at the HD-wallet stage.
 */
const FIRST_ADDRESS = TEST_MNEMONIC_ADDRESSES[0]

let services: ITestAppServices

beforeEach(async () => {
  services = createTestAppServices()
  services.providerFactory.configure({ balance: 1_500_000_000_000_000_000n as Wei })

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
})

describe('WalletSession.open', () => {
  it('creates the first account from the seed phrase', async () => {
    await services.session.open()

    const snapshot = services.session.getSnapshot()

    expect(snapshot.state).toBe(SESSION_STATE.Open)
    expect(snapshot.accounts).toHaveLength(1)
    expect(snapshot.activeAccount?.address).toBe(FIRST_ADDRESS)
  })

  it('loads the network list and selects the active one', async () => {
    await services.session.open()

    const snapshot = services.session.getSnapshot()

    expect(snapshot.networks.length).toBeGreaterThan(1)
    expect(snapshot.activeNetwork?.chainId).toBe(BUILT_IN_CHAIN_ID.Ethereum)
  })

  it('fetches the active-account balance', async () => {
    await services.session.open()

    expect(services.session.getSnapshot().balance?.raw).toBe(1_500_000_000_000_000_000n)
  })

  it('does not throw when the node refuses', async () => {
    services.providerFactory.configure({ unavailable: true })

    await services.session.open()

    const snapshot = services.session.getSnapshot()

    /* An unavailable node does not block key work: accounts are
       derived locally and the screen must open. A missing balance is
       marked as an error, not replaced with zero. */
    expect(snapshot.state).toBe(SESSION_STATE.Open)
    expect(snapshot.activeAccount).not.toBeNull()
    expect(snapshot.balance).toBeNull()
    expect(snapshot.balanceError).not.toBeNull()
  })

  it('reports failure when the phrase is not in storage', async () => {
    const empty = createTestAppServices()

    await empty.session.open()

    expect(empty.session.getSnapshot().state).toBe(SESSION_STATE.Failed)
    expect(empty.session.getSnapshot().error).not.toBeNull()
  })

  it('a second call does not create a second account', async () => {
    await services.session.open()
    await services.session.open()

    expect(services.session.getSnapshot().accounts).toHaveLength(1)
  })
})

describe('WalletSession.close', () => {
  it('resets the snapshot and closes connections', async () => {
    await services.session.open()
    await services.session.close()

    const snapshot = services.session.getSnapshot()

    expect(snapshot.state).toBe(SESSION_STATE.Closed)
    expect(snapshot.accounts).toHaveLength(0)
    expect(snapshot.balance).toBeNull()
    expect(services.providerFactory.lastProvider?.isActive).toBe(false)
  })

  it('allows the session to be opened again', async () => {
    await services.session.open()
    await services.session.close()
    await services.session.open()

    expect(services.session.getSnapshot().state).toBe(SESSION_STATE.Open)
    /* The account is read from storage, not created again. */
    expect(services.session.getSnapshot().accounts).toHaveLength(1)
  })
})

describe('WalletSession: accounts', () => {
  it('adds an account with the next address', async () => {
    await services.session.open()
    await services.session.createAccount()

    const snapshot = services.session.getSnapshot()

    expect(snapshot.accounts).toHaveLength(2)
    expect(snapshot.accounts[1]?.address).not.toBe(FIRST_ADDRESS)
  })

  it('switches the active account', async () => {
    await services.session.open()
    await services.session.createAccount()

    const second = services.session.getSnapshot().accounts[1]

    await services.session.selectAccount(second!.id)

    expect(services.session.getSnapshot().activeAccount?.id).toBe(second!.id)
  })
})

describe('WalletSession: networks', () => {
  it('switches the active network', async () => {
    await services.session.open()
    await services.session.switchNetwork(BUILT_IN_CHAIN_ID.Polygon)

    expect(services.session.getSnapshot().activeNetwork?.chainId).toBe(BUILT_IN_CHAIN_ID.Polygon)
  })

  it('does not show the previous chain\'s balance after switching', async () => {
    await services.session.open()

    services.providerFactory.configure({ balance: 7n as Wei })
    await services.session.switchNetwork(BUILT_IN_CHAIN_ID.Polygon)

    /* The value must be re-fetched: a balance from one chain under
       another chain's name is direct misinformation about funds. */
    expect(services.session.getSnapshot().balance?.raw).toBe(7n)
  })
})

describe('WalletSession: subscription', () => {
  it('notifies subscribers when the snapshot changes', async () => {
    let notifications = 0
    const unsubscribe = services.session.subscribe(() => {
      notifications += 1
    })

    await services.session.open()
    unsubscribe()

    expect(notifications).toBeGreaterThan(0)
  })

  it('stops notifying after unsubscribe', async () => {
    let notifications = 0
    const unsubscribe = services.session.subscribe(() => {
      notifications += 1
    })

    unsubscribe()
    await services.session.open()

    expect(notifications).toBe(0)
  })
})
