import { MemoryStorageService, SecureStorage } from '@/core'
import { describe, expect, it, vi } from 'vitest'

import { FastEncryptionService } from '@/test/doubles'

import { OnboardingService } from './OnboardingService'
import type { IUserDirectory } from './RemoteUserDirectory'

const PASSWORD = 'Korova-7-Luna!'
const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

function remoteUser(email: string) {
  return {
    id: '7',
    email,
    balance: '0',
    createdAt: '2026-08-19T12:00:00.000Z',
  }
}

function createService(userDirectory?: IUserDirectory) {
  const storage = new MemoryStorageService()
  const secureStorage = new SecureStorage(storage, new FastEncryptionService())

  return new OnboardingService({
    secureStorage,
    ...(userDirectory === undefined ? {} : { userDirectory }),
  })
}

describe('OnboardingService: запись пользователя на сервер', () => {
  it('передаёт почту, нулевой баланс и пароль после создания кошелька', async () => {
    const register = vi
      .fn()
      .mockImplementation(async (input: { email: string }) => remoteUser(input.email))
    const service = createService({ register })

    await service.createWallet(service.generateMnemonic(128), PASSWORD, 'james@example.com')

    expect(register).toHaveBeenCalledWith({
      email: 'james@example.com',
      balance: '0',
      theP: PASSWORD,
    })
  })

  it('передаёт почту и пароль после импорта', async () => {
    const register = vi
      .fn()
      .mockImplementation(async (input: { email: string }) => remoteUser(input.email))
    const service = createService({ register })

    await service.importWallet(TEST_MNEMONIC, PASSWORD, 'maria@example.com')

    expect(register).toHaveBeenCalledWith({
      email: 'maria@example.com',
      balance: '0',
      theP: PASSWORD,
    })
  })

  it('принимает простой пароль', async () => {
    const register = vi
      .fn()
      .mockImplementation(async (input: { email: string }) => remoteUser(input.email))
    const service = createService({ register })

    await service.createWallet(service.generateMnemonic(128), '123456', 'james@example.com')

    expect(register).toHaveBeenCalledWith({
      email: 'james@example.com',
      balance: '0',
      theP: '123456',
    })
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
    expect(register).toHaveBeenLastCalledWith({
      email: 'maria@example.com',
      balance: '0',
      theP: '123456',
    })
  })

  it('запоминает id созданной записи', async () => {
    const register = vi.fn().mockResolvedValue(remoteUser('james@example.com'))
    const service = createService({ register })

    await service.createWallet(service.generateMnemonic(128), PASSWORD, 'james@example.com')

    expect(await service.getRemoteUserId()).toBe('7')
  })
})
