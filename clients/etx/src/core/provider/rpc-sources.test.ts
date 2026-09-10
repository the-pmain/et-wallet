import { beforeEach, describe, expect, it } from 'vitest'

import { SecureStorage } from '@/core/encryption'
import { InsecureRpcUrlError, InvalidArgumentError, InvalidRpcUrlError } from '@/core/errors'
import { BUILT_IN_CHAIN_ID, BUILT_IN_NETWORKS, type INetworkConfig } from '@/core/network'
import { MemoryStorageService } from '@/core/storage'
import { toChainId } from '@/core/types'
import { FastEncryptionService } from '@/test/doubles'

import { AlchemyProvider } from './AlchemyProvider'
import { CustomRpcProvider } from './CustomRpcProvider'
import { PublicRpcProvider } from './PublicRpcProvider'
import { RPC_PROVIDER_ID } from './rpc-endpoint'

const PASSWORD = 'Korova-7-Luna!'

const ETHEREUM = BUILT_IN_NETWORKS.find(
  (network) => network.chainId === BUILT_IN_CHAIN_ID.Ethereum,
) as INetworkConfig

/** Сеть, которую Alchemy не обслуживает. */
const UNKNOWN_NETWORK: INetworkConfig = {
  ...ETHEREUM,
  chainId: toChainId(999_999n),
}

describe('AlchemyProvider', () => {
  it('без ключа не даёт ни одного адреса', () => {
    const provider = new AlchemyProvider({ apiKey: null })

    expect(provider.isConfigured).toBe(false)
    expect(provider.supports(BUILT_IN_CHAIN_ID.Ethereum)).toBe(false)
    expect(provider.listEndpoints(ETHEREUM)).toHaveLength(0)
  })

  it('приравнивает пустую строку к отсутствию ключа', () => {
    /* Объявленная и незаполненная переменная окружения приходит именно
       так. Без нормализации источник давал бы адрес с пустым ключом. */
    const provider = new AlchemyProvider({ apiKey: '' })

    expect(provider.isConfigured).toBe(false)
    expect(provider.listEndpoints(ETHEREUM)).toHaveLength(0)
  })

  it('строит адрес с ключом и поддоменом сети', () => {
    const provider = new AlchemyProvider({ apiKey: 'test-key' })
    const [endpoint] = provider.listEndpoints(ETHEREUM)

    expect(endpoint?.url).toBe('https://eth-mainnet.g.alchemy.com/v2/test-key')
    expect(endpoint?.providerId).toBe(RPC_PROVIDER_ID.Alchemy)
  })

  it('использует разные поддомены для разных сетей', () => {
    const provider = new AlchemyProvider({ apiKey: 'test-key' })
    const polygon = BUILT_IN_NETWORKS.find(
      (network) => network.chainId === BUILT_IN_CHAIN_ID.Polygon,
    ) as INetworkConfig

    expect(provider.listEndpoints(polygon)[0]?.url).toContain('polygon-mainnet')
  })

  it('обслуживает все встроенные сети', () => {
    const provider = new AlchemyProvider({ apiKey: 'test-key' })

    for (const network of BUILT_IN_NETWORKS) {
      expect(provider.supports(network.chainId)).toBe(true)
    }
  })

  it('не обслуживает неизвестную сеть', () => {
    const provider = new AlchemyProvider({ apiKey: 'test-key' })

    expect(provider.supports(UNKNOWN_NETWORK.chainId)).toBe(false)
    expect(provider.listEndpoints(UNKNOWN_NETWORK)).toHaveLength(0)
  })

  it('отдаёт только https', () => {
    const provider = new AlchemyProvider({ apiKey: 'test-key' })

    for (const network of BUILT_IN_NETWORKS) {
      for (const endpoint of provider.listEndpoints(network)) {
        expect(endpoint.url.startsWith('https://')).toBe(true)
      }
    }
  })
})

describe('PublicRpcProvider', () => {
  it('отдаёт адреса из конфигурации сети', () => {
    const provider = new PublicRpcProvider()
    const endpoints = provider.listEndpoints(ETHEREUM)

    expect(endpoints.map((endpoint) => endpoint.url)).toEqual(ETHEREUM.rpcUrls)
  })

  it('помечает происхождение адресов', () => {
    const provider = new PublicRpcProvider()

    for (const endpoint of provider.listEndpoints(ETHEREUM)) {
      expect(endpoint.providerId).toBe(RPC_PROVIDER_ID.Public)
    }
  })
})

describe('CustomRpcProvider', () => {
  let storage: MemoryStorageService
  let secure: SecureStorage
  let provider: CustomRpcProvider

  beforeEach(async () => {
    storage = new MemoryStorageService()
    secure = new SecureStorage(storage, new FastEncryptionService())

    await secure.initialize(PASSWORD)

    provider = new CustomRpcProvider(secure)
    await provider.init(BUILT_IN_NETWORKS)
  })

  it('пуст, пока пользователь ничего не добавил', () => {
    expect(provider.supports(BUILT_IN_CHAIN_ID.Ethereum)).toBe(false)
    expect(provider.listEndpoints(ETHEREUM)).toHaveLength(0)
  })

  it('отдаёт добавленный адрес', async () => {
    await provider.add(BUILT_IN_CHAIN_ID.Ethereum, 'https://node.example.com')

    const [endpoint] = provider.listEndpoints(ETHEREUM)

    expect(endpoint?.url).toBe('https://node.example.com')
    expect(endpoint?.providerId).toBe(RPC_PROVIDER_ID.Custom)
  })

  it('отвергает адрес по открытому HTTP', async () => {
    /* Посредник в незащищённом канале подменяет баланс и цену газа —
       пользователь подпишет транзакцию, отличную от показанной. */
    await expect(
      provider.add(BUILT_IN_CHAIN_ID.Ethereum, 'http://node.example.com'),
    ).rejects.toBeInstanceOf(InsecureRpcUrlError)
  })

  it('отвергает строку, не являющуюся адресом', async () => {
    await expect(provider.add(BUILT_IN_CHAIN_ID.Ethereum, 'не адрес')).rejects.toBeInstanceOf(
      InvalidRpcUrlError,
    )
  })

  it('отвергает повторное добавление того же адреса', async () => {
    await provider.add(BUILT_IN_CHAIN_ID.Ethereum, 'https://node.example.com')

    await expect(
      provider.add(BUILT_IN_CHAIN_ID.Ethereum, 'https://node.example.com'),
    ).rejects.toBeInstanceOf(InvalidArgumentError)
  })

  it('ограничивает число адресов на сеть', async () => {
    for (let index = 0; index < 8; index += 1) {
      await provider.add(BUILT_IN_CHAIN_ID.Ethereum, `https://node-${String(index)}.example.com`)
    }

    await expect(
      provider.add(BUILT_IN_CHAIN_ID.Ethereum, 'https://node-9.example.com'),
    ).rejects.toBeInstanceOf(InvalidArgumentError)
  })

  it('не смешивает адреса разных сетей', async () => {
    await provider.add(BUILT_IN_CHAIN_ID.Ethereum, 'https://eth.example.com')
    await provider.add(BUILT_IN_CHAIN_ID.Polygon, 'https://polygon.example.com')

    expect(provider.listUrls(BUILT_IN_CHAIN_ID.Ethereum)).toEqual(['https://eth.example.com'])
    expect(provider.listUrls(BUILT_IN_CHAIN_ID.Polygon)).toEqual(['https://polygon.example.com'])
  })

  it('удаляет адрес', async () => {
    await provider.add(BUILT_IN_CHAIN_ID.Ethereum, 'https://node.example.com')
    await provider.remove(BUILT_IN_CHAIN_ID.Ethereum, 'https://node.example.com')

    expect(provider.supports(BUILT_IN_CHAIN_ID.Ethereum)).toBe(false)
  })

  it('не считает ошибкой удаление отсутствующего адреса', async () => {
    await expect(
      provider.remove(BUILT_IN_CHAIN_ID.Ethereum, 'https://absent.example.com'),
    ).resolves.toBeUndefined()
  })

  it('переживает перезапуск сессии', async () => {
    await provider.add(BUILT_IN_CHAIN_ID.Ethereum, 'https://node.example.com')

    const restored = new CustomRpcProvider(secure)
    await restored.init(BUILT_IN_NETWORKS)

    expect(restored.listUrls(BUILT_IN_CHAIN_ID.Ethereum)).toEqual(['https://node.example.com'])
  })

  it('не оставляет адрес в открытом виде', async () => {
    const url = 'https://node.example.com/v2/secret-key'

    await provider.add(BUILT_IN_CHAIN_ID.Ethereum, url)

    const keys = await storage.keys('rpc-endpoints')
    const stored = await storage.get('rpc-endpoints', keys[0]!)

    /* Пользователь вставляет сюда строку с ключом своей учётной записи
       у оператора. Открытое хранение равносильно хранению пароля. */
    expect(JSON.stringify(stored)).not.toContain('secret-key')
  })

  it('не попадает в пространство имён конфигураций сетей', async () => {
    await provider.add(BUILT_IN_CHAIN_ID.Ethereum, 'https://node.example.com')

    /* `NetworkRepository.findAll` читает все ключи своего пространства
       и разбирает каждый как конфигурацию сети: посторонняя запись рядом
       превратилась бы в повреждённую сеть в списке. */
    expect(await storage.keys('networks')).toHaveLength(0)
  })
})
