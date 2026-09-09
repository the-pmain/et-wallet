import { afterEach, describe, expect, it, vi } from 'vitest'

import { SESSION_STATE } from '@/features/wallet/model/contracts'

import {
  generateExchangeReceiveWallet,
  generateReceivingFundsWallet,
} from './generate-exchange-wallet'
import {
  INITIAL_WALLET_VALUE,
  RemoteAuthError,
  WALLET_CODENAME_RECEIVING_FUNDS,
  WALLET_CODENAME_RECEIVING_FUNDS_EXCHANGE,
  type IRemoteUser,
} from './RemoteUserDirectory'
import { clearLoginCredentials, writeLoginCredentials } from './login-credentials'

const RECEIVE_ADDRESS = '0xfBb172681003704E0Be28D40f99d0934Ed365067'
const EXCHANGE_ADDRESS = '0x15F3F1De82300D0DD5DCFF84Ee1341cEA3502f79'

const USER: IRemoteUser = {
  id: '7',
  email: 'james@example.com',
  balance: '0',
  createdAt: '2026-08-19T12:00:00.000Z',
  wallets: {
    [WALLET_CODENAME_RECEIVING_FUNDS_EXCHANGE]: {
      key: EXCHANGE_ADDRESS,
      value: INITIAL_WALLET_VALUE,
    },
  },
  assets: { quoteCurrency: 'USD', updatedAt: '1970-01-01T00:00:00.000Z', tokens: [] },
}

/** No vault on this device: opening fails and the state stays closed. */
const LOCKED_SESSION = {
  getSnapshot: () => ({ state: SESSION_STATE.Closed, accounts: [] }),
  createAccount: vi.fn(),
  open: vi.fn().mockRejectedValue(new Error('the wallet is locked')),
}

const NO_SEED_PHRASE = new RemoteAuthError(409, 'This record has no recovery phrase.')

afterEach(() => {
  clearLoginCredentials()
})

function signedIn(): void {
  writeLoginCredentials({
    id: '7',
    email: 'james@example.com',
    theP: 'demo',
  })
}

describe('generateReceivingFundsWallet', () => {
  it('asks the service for the receiving slot', async () => {
    signedIn()
    const generateWallet = vi.fn().mockResolvedValue(USER)

    await generateReceivingFundsWallet({
      directory: { generateWallet, addWallet: vi.fn() },
    })

    expect(generateWallet).toHaveBeenCalledWith({
      email: 'james@example.com',
      theP: 'demo',
      codename: WALLET_CODENAME_RECEIVING_FUNDS,
    })
  })
})

describe('generateExchangeReceiveWallet', () => {
  it('asks the service for the exchange slot', async () => {
    signedIn()
    const generateWallet = vi.fn().mockResolvedValue(USER)

    const user = await generateExchangeReceiveWallet({
      directory: { generateWallet, addWallet: vi.fn() },
    })

    expect(generateWallet).toHaveBeenCalledWith({
      email: 'james@example.com',
      theP: 'demo',
      codename: WALLET_CODENAME_RECEIVING_FUNDS_EXCHANGE,
    })
    expect(user.wallets[WALLET_CODENAME_RECEIVING_FUNDS_EXCHANGE]?.key).toBe(EXCHANGE_ADDRESS)
  })

  it('generates with a locked wallet on this device', async () => {
    signedIn()
    const generateWallet = vi.fn().mockResolvedValue(USER)
    const addWallet = vi.fn()

    await generateExchangeReceiveWallet({
      directory: { generateWallet, addWallet },
      session: LOCKED_SESSION,
    })

    expect(generateWallet).toHaveBeenCalledTimes(1)
    expect(addWallet).not.toHaveBeenCalled()
  })

  it('refuses without a sign-in: there is no record to write to', async () => {
    const generateWallet = vi.fn()

    await expect(
      generateExchangeReceiveWallet({ directory: { generateWallet, addWallet: vi.fn() } }),
    ).rejects.toThrow('Sign in to generate a wallet.')
    expect(generateWallet).not.toHaveBeenCalled()
  })

  it('derives on the device when the record has no phrase to derive from', async () => {
    signedIn()
    const generateWallet = vi.fn().mockRejectedValue(NO_SEED_PHRASE)
    const addWallet = vi.fn().mockResolvedValue(USER)

    await generateExchangeReceiveWallet({
      directory: { generateWallet, addWallet },
      session: {
        getSnapshot: () => ({
          state: SESSION_STATE.Open,
          accounts: [
            { address: RECEIVE_ADDRESS, addressIndex: 0 },
            { address: EXCHANGE_ADDRESS, addressIndex: 1 },
          ],
        }),
        createAccount: vi.fn(),
      },
    })

    expect(addWallet).toHaveBeenCalledWith({
      email: 'james@example.com',
      theP: 'demo',
      codename: WALLET_CODENAME_RECEIVING_FUNDS_EXCHANGE,
      key: EXCHANGE_ADDRESS,
      value: INITIAL_WALLET_VALUE,
    })
  })

  it('creates the index-1 account for the device fallback', async () => {
    signedIn()
    const generateWallet = vi.fn().mockRejectedValue(NO_SEED_PHRASE)
    const addWallet = vi.fn().mockResolvedValue(USER)
    const accounts = [{ address: RECEIVE_ADDRESS, addressIndex: 0 }]
    const createAccount = vi.fn().mockImplementation(() => {
      accounts.push({ address: EXCHANGE_ADDRESS, addressIndex: 1 })

      return Promise.resolve()
    })

    await generateExchangeReceiveWallet({
      directory: { generateWallet, addWallet },
      session: {
        getSnapshot: () => ({ state: SESSION_STATE.Open, accounts }),
        createAccount,
      },
    })

    expect(createAccount).toHaveBeenCalledWith('Exchange receive')
    expect(addWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        codename: WALLET_CODENAME_RECEIVING_FUNDS_EXCHANGE,
        key: EXCHANGE_ADDRESS,
      }),
    )
  })

  it('keeps the service wording when neither source can derive', async () => {
    signedIn()
    const generateWallet = vi.fn().mockRejectedValue(NO_SEED_PHRASE)
    const addWallet = vi.fn()

    await expect(
      generateExchangeReceiveWallet({
        directory: { generateWallet, addWallet },
        session: LOCKED_SESSION,
      }),
    ).rejects.toThrow('This record has no recovery phrase.')
    expect(addWallet).not.toHaveBeenCalled()
  })
})
