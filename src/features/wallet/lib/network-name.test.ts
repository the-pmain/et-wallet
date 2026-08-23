import { describe, expect, it } from 'vitest'

import { toAddress, toChainId } from '@/core'

import { networkNameForChainId, tokenExplorerUrl } from './network-name'

const ETHEREUM = toChainId(1n)
const OPTIMISM = toChainId(10n)
const UNKNOWN = toChainId(999n)
const USDC = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

describe('tokenExplorerUrl', () => {
  it('для нативной валюты даёт корень обозревателя', () => {
    expect(tokenExplorerUrl(ETHEREUM, null)).toBe('https://etherscan.io')
  })

  it('для контракта даёт страницу токена той же сети', () => {
    expect(tokenExplorerUrl(ETHEREUM, USDC)).toBe(`https://etherscan.io/token/${USDC}`)
    expect(tokenExplorerUrl(OPTIMISM, USDC)).toBe(`https://optimistic.etherscan.io/token/${USDC}`)
  })

  it('для неизвестной сети ссылки нет', () => {
    expect(tokenExplorerUrl(UNKNOWN, USDC)).toBeNull()
    expect(networkNameForChainId(UNKNOWN)).toBe('Chain 999')
  })
})
