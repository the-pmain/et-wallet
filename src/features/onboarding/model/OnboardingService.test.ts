import { MemoryStorageService, SecureStorage } from '@/core'
import { describe, expect, it, vi } from 'vitest'

import { FastEncryptionService } from '@/test/doubles'

import { OnboardingService } from './OnboardingService'
import type { IUserDirectory } from './RemoteUserDirectory'

const PASSWORD = 'Korova-7-Luna!'
const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

function createService(userDirectory?: IUserDirectory) {
  const storage = new MemoryStorageService()
  const secureStorage = new SecureStorage(storage, new FastEncryptionService())

  return new OnboardingService({
    secureStorage,
    ...(userDirectory === undefined ? {} : { userDirectory }),
  })
}

describe('OnboardingService: запись пользователя на сервер', () => {
  it('передаёт имя, нулевой баланс и пароль после создания кошелька', async () => {
    const register = vi.fn().mockResolvedValue(undefined)
    const service = createService({ register })

    await service.createWallet(service.generateMnemonic(128), PASSWORD, 'James')

    expect(register).toHaveBeenCalledWith({ username: 'James', balance: '0', theP: PASSWORD })
  })

  it('передаёт имя после импорта', async () => {
    const register = vi.fn().mockResolvedValue(undefined)
    const service = createService({ register })

    await service.importWallet(TEST_MNEMONIC, PASSWORD, 'Maria')

    expect(register).toHaveBeenCalledWith({ username: 'Maria', balance: '0', theP: null })
  })

  it('не откатывает кошелёк, если справочник отказал', async () => {
    const service = createService({
      register: vi.fn().mockRejectedValue(new Error('offline')),
    })

    await service.importWallet(TEST_MNEMONIC, PASSWORD, 'James')

    expect(service.getState()).toBe('unlocked')
  })
})
