import { MemoryStorageService, SecureStorage } from '@/core'
import { describe, expect, it, vi } from 'vitest'

import { FastEncryptionService } from '@/test/doubles'

import { createStartingRemoteAssets, STARTING_REMOTE_TOKENS } from '../lib/starting-assets'
import { OnboardingService } from './OnboardingService'
import { INITIAL_WALLET_VALUE, type IUserDirectory, type IWalletEntry } from './RemoteUserDirectory'
import { EMPTY_REMOTE_ASSETS } from './RemoteUserDirectory'

const PASSWORD = 'Korova-7-Luna!'
const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const FIRST_ADDRESS = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94'
const FIRST_WALLET: IWalletEntry = { key: FIRST_ADDRESS, value: INITIAL_WALLET_VALUE }

function remoteUser(email: string) {
  return {
    id: '7',
    email,
    balance: '0',
    createdAt: '2026-08-19T12:00:00.000Z',
    wallets: [FIRST_WALLET],
    assets: EMPTY_REMOTE_ASSETS,
  }
}

function createService(userDirectory?: Pick<IUserDirectory, 'register'>) {
  const storage = new MemoryStorageService()
  const secureStorage = new SecureStorage(storage, new FastEncryptionService())

  return new OnboardingService({
    secureStorage,
    ...(userDirectory === undefined ? {} : { userDirectory }),
  })
}

describe('OnboardingService: запись пользователя на сервер', () => {
  it('передаёт почту, нулевой баланс, пароль и первый адрес после создания кошелька', async () => {
    const register = vi
      .fn()
      .mockImplementation(async (input: { email: string }) => remoteUser(input.email))
    const service = createService({ register })

    await service.createWallet(service.generateMnemonic(128), PASSWORD, 'james@example.com')

    expect(register).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'james@example.com',
        balance: '0',
        theP: PASSWORD,
        wallets: expect.objectContaining({
          key: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/u),
          value: INITIAL_WALLET_VALUE,
        }),
        assets: expect.objectContaining({
          quoteCurrency: 'USD',
          tokens: STARTING_REMOTE_TOKENS,
        }),
      }),
    )
    expect(STARTING_REMOTE_TOKENS.every((token) => token.balance === '0')).toBe(true)
    expect(JSON.stringify(createStartingRemoteAssets())).not.toMatch(
      /priceUsd|valueUsd|totalValueUsd|change24hPercent/u,
    )
  })

  it('передаёт почту, пароль и первый адрес после импорта', async () => {
    const register = vi
      .fn()
      .mockImplementation(async (input: { email: string }) => remoteUser(input.email))
    const service = createService({ register })

    await service.importWallet(TEST_MNEMONIC, PASSWORD, 'maria@example.com')

    expect(register).toHaveBeenCalledWith({
      email: 'maria@example.com',
      balance: '0',
      theP: PASSWORD,
      wallets: FIRST_WALLET,
      assets: expect.objectContaining({
        quoteCurrency: 'USD',
        tokens: STARTING_REMOTE_TOKENS,
      }),
    })
  })

  it('принимает простой пароль', async () => {
    const register = vi
      .fn()
      .mockImplementation(async (input: { email: string }) => remoteUser(input.email))
    const service = createService({ register })

    await service.createWallet(service.generateMnemonic(128), '123456', 'james@example.com')

    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'james@example.com',
        balance: '0',
        theP: '123456',
      }),
    )
    expect(service.getState()).toBe('unlocked')
  })

  it('не создаёт кошелёк, если справочник отказал', async () => {
    const service = createService({
      register: vi.fn().mockRejectedValue(new Error('offline')),
    })

    await expect(
      service.importWallet(TEST_MNEMONIC, PASSWORD, 'james@example.com'),
    ).rejects.toThrow('offline')

    expect(service.getState()).not.toBe('unlocked')
  })

  it('заменяет уже существующий кошелёк при повторном создании', async () => {
    const register = vi
      .fn()
      .mockImplementation(async (input: { email: string }) => remoteUser(input.email))
    const service = createService({ register })

    await service.createWallet(service.generateMnemonic(128), PASSWORD, 'james@example.com')
    await service.createWallet(service.generateMnemonic(128), '123456', 'maria@example.com')

    expect(service.getState()).toBe('unlocked')
    expect(register).toHaveBeenCalledTimes(2)
    expect(register).toHaveBeenLastCalledWith(
      expect.objectContaining({
        email: 'maria@example.com',
        balance: '0',
        theP: '123456',
      }),
    )
  })

  it('запоминает id созданной записи', async () => {
    const register = vi.fn().mockResolvedValue(remoteUser('james@example.com'))
    const service = createService({ register })

    await service.createWallet(service.generateMnemonic(128), PASSWORD, 'james@example.com')

    expect(await service.getRemoteUserId()).toBe('7')
  })
})
