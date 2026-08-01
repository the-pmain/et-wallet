import { describe, expect, it } from 'vitest'

import { BUILT_IN_CHAIN_ID, BUILT_IN_NETWORKS, DEFAULT_CHAIN_ID } from './built-in'
import { assertValidExplorerUrl, assertValidRpcUrls } from './rpc-url'

/**
 * Справочник сетей — это данные, а не логика. Тесты здесь защищают
 * от опечаток, которые компилятор не поймает: повторяющийся chainId,
 * незащищённый адрес узла, забытое число десятичных знаков.
 */

describe('BUILT_IN_NETWORKS', () => {
  it('содержит семь сетей', () => {
    expect(BUILT_IN_NETWORKS).toHaveLength(7)
  })

  it('не содержит повторяющихся идентификаторов', () => {
    const chainIds = BUILT_IN_NETWORKS.map((network) => network.chainId)

    expect(new Set(chainIds).size).toBe(chainIds.length)
  })

  it('покрывает все объявленные идентификаторы', () => {
    const declared = new Set(Object.values(BUILT_IN_CHAIN_ID))
    const present = new Set(BUILT_IN_NETWORKS.map((network) => network.chainId))

    expect(present).toEqual(declared)
  })

  it('помечает все сети как встроенные и основные', () => {
    for (const network of BUILT_IN_NETWORKS) {
      expect(network.isBuiltIn).toBe(true)
      expect(network.isTestnet).toBe(false)
    }
  })

  it('использует только защищённые RPC-адреса', () => {
    for (const network of BUILT_IN_NETWORKS) {
      expect(() => {
        assertValidRpcUrls(network.rpcUrls)
      }).not.toThrow()
    }
  })

  it('предоставляет несколько узлов на каждую сеть', () => {
    for (const network of BUILT_IN_NETWORKS) {
      expect(network.rpcUrls.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('не содержит повторяющихся RPC-адресов внутри сети', () => {
    for (const network of BUILT_IN_NETWORKS) {
      expect(new Set(network.rpcUrls).size).toBe(network.rpcUrls.length)
    }
  })

  it('указывает обозреватель блоков по https', () => {
    for (const network of BUILT_IN_NETWORKS) {
      expect(network.blockExplorerUrls.length).toBeGreaterThanOrEqual(1)

      for (const url of network.blockExplorerUrls) {
        expect(() => {
          assertValidExplorerUrl(url)
        }).not.toThrow()
      }
    }
  })

  it('описывает нативную валюту полностью', () => {
    for (const network of BUILT_IN_NETWORKS) {
      expect(network.nativeCurrency.name.length).toBeGreaterThan(0)
      expect(network.nativeCurrency.symbol.length).toBeGreaterThan(0)
      expect(network.nativeCurrency.decimals).toBe(18)
    }
  })

  it('содержит ожидаемые идентификаторы сетей', () => {
    expect(BUILT_IN_CHAIN_ID.Ethereum).toBe(1n)
    expect(BUILT_IN_CHAIN_ID.Optimism).toBe(10n)
    expect(BUILT_IN_CHAIN_ID.BnbChain).toBe(56n)
    expect(BUILT_IN_CHAIN_ID.Polygon).toBe(137n)
    expect(BUILT_IN_CHAIN_ID.Base).toBe(8453n)
    expect(BUILT_IN_CHAIN_ID.Arbitrum).toBe(42161n)
    expect(BUILT_IN_CHAIN_ID.Avalanche).toBe(43114n)
  })

  it('помечает BNB Chain как сеть без действующего EIP-1559', () => {
    const bnb = BUILT_IN_NETWORKS.find((network) => network.chainId === BUILT_IN_CHAIN_ID.BnbChain)

    expect(bnb?.supportsEip1559).toBe(false)
  })

  it('использует символ POL для Polygon', () => {
    const polygon = BUILT_IN_NETWORKS.find(
      (network) => network.chainId === BUILT_IN_CHAIN_ID.Polygon,
    )

    expect(polygon?.nativeCurrency.symbol).toBe('POL')
  })

  it('назначает Ethereum сетью по умолчанию', () => {
    expect(DEFAULT_CHAIN_ID).toBe(BUILT_IN_CHAIN_ID.Ethereum)
  })
})
