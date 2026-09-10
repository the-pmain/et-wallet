import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ConsoleLogger,
  LOG_LEVEL,
  SecretBuffer,
  SecureStorage,
  STORAGE_NAMESPACE,
  VAULT_KEY,
  toStorageKey,
  type MemoryStorageService,
  type Wei,
} from '@/core'
import { TEST_MNEMONIC } from '@/core/hdwallet/vectors'
import {
  createTestAppServices,
  FastEncryptionService,
  InMemoryStorageService,
  type ITestAppServices,
} from '@/test/doubles'

const PASSWORD = 'Korova-7-Luna!'
const EMAIL = 'owner@example.com'

/** Первое слово тестовой фразы. Ищется в сыром хранилище как маркер утечки. */
const PHRASE_MARKER = 'abandon'

let services: ITestAppServices

/**
 * Собирает всё, что лежит в хранилище, в одну строку.
 *
 * Обходятся все пространства имён: утечка в любом из них равносильна
 * утечке вообще, а проверка одного создавала бы ложное спокойствие.
 */
async function dumpStorage(storage: MemoryStorageService): Promise<string> {
  const parts: string[] = []

  for (const namespace of Object.values(STORAGE_NAMESPACE)) {
    for (const key of await storage.keys(namespace)) {
      parts.push(key, JSON.stringify(await storage.get(namespace, key)))
    }
  }

  return parts.join('\n')
}

beforeEach(() => {
  services = createTestAppServices()
})

describe('Секреты не попадают в хранилище открытым текстом', () => {
  it('seed-фраза записана только зашифрованной', async () => {
    await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD, EMAIL)

    const dump = await dumpStorage(services.storage)

    expect(dump).not.toContain(PHRASE_MARKER)
    expect(dump).not.toContain(TEST_MNEMONIC)
  })

  it('пароль нигде не сохраняется', async () => {
    /* Хранилище держит проверочный блок, расшифровываемый паролем,
       но не сам пароль: иначе смысл вывода ключа пропадает. */
    await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD, EMAIL)

    expect(await dumpStorage(services.storage)).not.toContain(PASSWORD)
  })

  it('адрес почты записан зашифрованным', async () => {
    /* Это персональные данные, связывающие устройство с личностью. */
    await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD, EMAIL)

    expect(await dumpStorage(services.storage)).not.toContain(EMAIL)
  })

  it('имена полей значения тоже не раскрываются', async () => {
    /* Наблюдатель не должен узнавать даже структуру записи: сама
       по себе она подсказывает, что искать. */
    const storage = new InMemoryStorageService()
    const secure = new SecureStorage(storage, new FastEncryptionService())

    await secure.initialize(PASSWORD)
    await secure.set(STORAGE_NAMESPACE.Vault, toStorageKey('проба'), {
      privateKey: '0xdeadbeef',
    })

    const dump = await dumpStorage(storage)

    expect(dump).not.toContain('privateKey')
    expect(dump).not.toContain('deadbeef')
  })

  it('заблокированное хранилище не отдаёт записанное', async () => {
    await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
    services.onboarding.lock()

    await expect(
      services.secureStorage.get(STORAGE_NAMESPACE.Vault, VAULT_KEY.Mnemonic),
    ).rejects.toThrow()
  })
})

describe('Секреты не попадают в журнал', () => {
  it('поля с секретными именами заменяются пометкой', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      new ConsoleLogger({ minimumLevel: LOG_LEVEL.Warn }).warn('проба', {
        privateKey: '0xdeadbeef',
        mnemonic: TEST_MNEMONIC,
        password: PASSWORD,
        seed: 'что-то',
      })

      const printed = JSON.stringify(warn.mock.calls)

      expect(printed).not.toContain('deadbeef')
      expect(printed).not.toContain(PHRASE_MARKER)
      expect(printed).not.toContain(PASSWORD)
    } finally {
      warn.mockRestore()
    }
  })

  it('адрес почты скрывается по виду значения, а не по имени поля', () => {
    /* Адрес попадает в журнал как имя аккаунта — под именем `name`,
       которое секретным не выглядит. */
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      new ConsoleLogger({ minimumLevel: LOG_LEVEL.Warn }).warn('проба', { name: EMAIL })

      expect(JSON.stringify(warn.mock.calls)).not.toContain(EMAIL)
    } finally {
      warn.mockRestore()
    }
  })

  it('адрес кошелька усекается', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      new ConsoleLogger({ minimumLevel: LOG_LEVEL.Warn }).warn('проба', {
        owner: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      })

      expect(JSON.stringify(warn.mock.calls)).not.toContain(
        '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      )
    } finally {
      warn.mockRestore()
    }
  })
})

describe('Секреты не выживают в сериализации состояния', () => {
  it('буфер секрета не раскрывается ни строкой, ни JSON', () => {
    /* Подстановка объекта в шаблон и отладочный дамп состояния —
       два самых частых способа случайно напечатать ключ. */
    const secret = SecretBuffer.copyOf(new TextEncoder().encode('очень-секретно'))

    try {
      expect(`${secret as unknown as string}`).not.toContain('секретно')
      expect(JSON.stringify({ secret })).not.toContain('секретно')
    } finally {
      secret.wipe()
    }
  })

  it('затирание обнуляет байты, а не только помечает буфер', () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const secret = SecretBuffer.copyOf(bytes)
    const view = secret.bytes

    secret.wipe()

    expect([...view]).toEqual([0, 0, 0, 0])
  })

  it('снимок сессии не содержит ни фразы, ни ключей', async () => {
    /* Снимок уходит в дерево React и попадает в любой отладочный дамп
       состояния. */
    services.providerFactory.configure({ balance: 0n as Wei })
    await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD, EMAIL)
    await services.session.open()

    const snapshot = JSON.stringify(services.session.getSnapshot(), (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    )

    expect(snapshot).not.toContain(PHRASE_MARKER)
    expect(snapshot).not.toContain(PASSWORD)
  })
})
