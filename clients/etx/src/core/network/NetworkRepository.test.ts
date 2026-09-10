import { beforeEach, describe, expect, it } from 'vitest'

import type { SecureStorage } from '@/core/encryption'
import { BUILT_IN_CHAIN_ID } from '@/core/network'
import { MemoryStorageService, STORAGE_NAMESPACE, toStorageKey } from '@/core/storage'
import { toChainId, type ChainId } from '@/core/types'
import { createSecureMemoryStorage } from '@/test/doubles'

import { NetworkRepository } from './NetworkRepository'
import type { INetworkConfig } from './types'

const CUSTOM_CHAIN = toChainId(999n)

/** Адрес узла с ключом учётной записи в строке — обычный вид у оператора. */
const SECRET_RPC = 'https://rpc.example.com/v2/9f8c1b7e5a3d4f2e'

function config(overrides: Partial<INetworkConfig> = {}): INetworkConfig {
  return {
    chainId: CUSTOM_CHAIN,
    name: 'My Private Chain',
    rpcUrls: [SECRET_RPC],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: [],
    isTestnet: false,
    isBuiltIn: false,
    supportsEip1559: true,
    ...overrides,
  }
}

/**
 * Сырое содержимое хранилища строкой.
 *
 * Проверка секретов возможна только по тому, что реально лежит
 * на диске: значение, прошедшее через репозиторий, уже расшифровано.
 */
async function rawDump(storage: MemoryStorageService): Promise<string> {
  const parts: string[] = []

  for (const namespace of [STORAGE_NAMESPACE.Networks, STORAGE_NAMESPACE.Settings]) {
    for (const key of await storage.keys(namespace)) {
      parts.push(JSON.stringify(await storage.get(namespace, key)))
    }
  }

  return parts.join('|')
}

let plain: MemoryStorageService
let secure: SecureStorage
let repository: NetworkRepository

beforeEach(async () => {
  plain = new MemoryStorageService()
  secure = await createSecureMemoryStorage(plain)
  repository = new NetworkRepository(secure, plain)
})

describe('Хранение сетей', () => {
  it('сохранённая сеть читается обратно', async () => {
    await repository.save(config())

    const restored = await repository.findByChainId(CUSTOM_CHAIN)

    expect(restored?.rpcUrls).toEqual([SECRET_RPC])
  })

  it('адрес узла не лежит в хранилище открытым текстом', async () => {
    /* У пользовательской сети в `rpcUrls` обычно стоит адрес с ключом
       учётной записи прямо в строке. Открытым текстом на диске это
       равнозначно записанному паролю от стороннего сервиса. */
    await repository.save(config())

    const dump = await rawDump(plain)

    expect(dump).not.toContain('9f8c1b7e5a3d4f2e')
    expect(dump).not.toContain('rpc.example.com')
  })

  it('удалённая сеть больше не находится', async () => {
    await repository.save(config())
    await repository.delete(CUSTOM_CHAIN)

    expect(await repository.findByChainId(CUSTOM_CHAIN)).toBeNull()
  })
})

describe('Перенос из открытого хранилища', () => {
  /** Кладёт сеть так, как её писали прежние версии: открытым текстом. */
  async function writeLegacy(chainId: ChainId = CUSTOM_CHAIN): Promise<void> {
    await plain.set(STORAGE_NAMESPACE.Networks, toStorageKey(chainId.toString()), {
      chainId: chainId.toString(),
      name: 'Legacy Chain',
      rpcUrls: [SECRET_RPC],
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      blockExplorerUrls: [],
      isTestnet: false,
      isBuiltIn: false,
      supportsEip1559: true,
    })
  }

  it('сеть прежнего формата не теряется', async () => {
    /* Кошельки, созданные до шифрования сетей, обязаны продолжать
       работать: пользовательская сеть — это его настройка, а не кэш. */
    await writeLegacy()

    const restored = await repository.findAll()

    expect(restored).toHaveLength(1)
    expect(restored[0]?.rpcUrls).toEqual([SECRET_RPC])
  })

  it('после переноса открытая запись удаляется', async () => {
    /* Оставить её значило бы, что шифрование ничего не даёт. */
    await writeLegacy()
    await repository.findAll()

    const dump = await rawDump(plain)

    expect(dump).not.toContain('9f8c1b7e5a3d4f2e')
  })

  it('перенос выполняется и при поиске по идентификатору', async () => {
    await writeLegacy()

    expect(await repository.findByChainId(CUSTOM_CHAIN)).not.toBeNull()
  })

  it('повторный перенос ничего не ломает', async () => {
    await writeLegacy()
    await repository.findAll()

    expect(await repository.findAll()).toHaveLength(1)
  })

  it('без открытого хранилища перенос не выполняется', async () => {
    /* Репозиторий, собранный без прежнего хранилища, работает как
       обычно: переносить нечего. */
    const isolated = new NetworkRepository(secure)

    await isolated.save(config({ chainId: BUILT_IN_CHAIN_ID.Ethereum }))

    expect(await isolated.findAll()).toHaveLength(1)
  })
})
