import { describe, expect, it } from 'vitest'

import { InsecureRpcUrlError, InvalidArgumentError, InvalidRpcUrlError } from '@/core/errors'

import { assertValidExplorerUrl, assertValidRpcUrl, assertValidRpcUrls } from './rpc-url'

describe('assertValidRpcUrl', () => {
  it('принимает https', () => {
    expect(() => {
      assertValidRpcUrl('https://ethereum-rpc.publicnode.com')
    }).not.toThrow()
  })

  it('принимает wss', () => {
    expect(() => {
      assertValidRpcUrl('wss://node.example.com/ws')
    }).not.toThrow()
  })

  it('отвергает открытый http', () => {
    expect(() => {
      assertValidRpcUrl('http://node.example.com')
    }).toThrow(InsecureRpcUrlError)
  })

  it('отвергает незащищённый websocket', () => {
    expect(() => {
      assertValidRpcUrl('ws://node.example.com')
    }).toThrow(InsecureRpcUrlError)
  })

  it('отвергает file и прочие локальные схемы', () => {
    expect(() => {
      assertValidRpcUrl('file:///etc/passwd')
    }).toThrow(InsecureRpcUrlError)
  })

  it('отвергает javascript: как вектор исполнения кода', () => {
    expect(() => {
      assertValidRpcUrl('javascript:alert(1)')
    }).toThrow(InsecureRpcUrlError)
  })

  it('отвергает строку, не являющуюся URL', () => {
    expect(() => {
      assertValidRpcUrl('не url')
    }).toThrow(InvalidRpcUrlError)
  })

  it('отвергает пустую строку', () => {
    expect(() => {
      assertValidRpcUrl('')
    }).toThrow(InvalidRpcUrlError)
  })
})

describe('assertValidRpcUrls', () => {
  it('принимает непустой список защищённых адресов', () => {
    expect(() => {
      assertValidRpcUrls(['https://a.example.com', 'wss://b.example.com'])
    }).not.toThrow()
  })

  it('отвергает пустой список', () => {
    expect(() => {
      assertValidRpcUrls([])
    }).toThrow(InvalidArgumentError)
  })

  it('отвергает список, где незащищён хотя бы один адрес', () => {
    expect(() => {
      assertValidRpcUrls(['https://a.example.com', 'http://b.example.com'])
    }).toThrow(InsecureRpcUrlError)
  })
})

describe('assertValidExplorerUrl', () => {
  it('принимает https', () => {
    expect(() => {
      assertValidExplorerUrl('https://etherscan.io')
    }).not.toThrow()
  })

  it('отвергает http', () => {
    expect(() => {
      assertValidExplorerUrl('http://etherscan.io')
    }).toThrow(InsecureRpcUrlError)
  })

  it('отвергает wss: обозреватель открывается в браузере, а не по сокету', () => {
    expect(() => {
      assertValidExplorerUrl('wss://etherscan.io')
    }).toThrow(InsecureRpcUrlError)
  })
})
