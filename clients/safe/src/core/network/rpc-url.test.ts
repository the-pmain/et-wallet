import { describe, expect, it } from 'vitest'

import { InsecureRpcUrlError, InvalidArgumentError, InvalidRpcUrlError } from '@/core/errors'

import { assertValidExplorerUrl, assertValidRpcUrl, assertValidRpcUrls } from './rpc-url'

describe('assertValidRpcUrl', () => {
  it('accepts https', () => {
    expect(() => {
      assertValidRpcUrl('https://ethereum-rpc.publicnode.com')
    }).not.toThrow()
  })

  it('accepts wss', () => {
    expect(() => {
      assertValidRpcUrl('wss://node.example.com/ws')
    }).not.toThrow()
  })

  it('rejects plain http', () => {
    expect(() => {
      assertValidRpcUrl('http://node.example.com')
    }).toThrow(InsecureRpcUrlError)
  })

  it('rejects an unsecured websocket', () => {
    expect(() => {
      assertValidRpcUrl('ws://node.example.com')
    }).toThrow(InsecureRpcUrlError)
  })

  it('rejects file and other local schemes', () => {
    expect(() => {
      assertValidRpcUrl('file:///etc/passwd')
    }).toThrow(InsecureRpcUrlError)
  })

  it('rejects javascript: as a code-execution vector', () => {
    expect(() => {
      assertValidRpcUrl('javascript:alert(1)')
    }).toThrow(InsecureRpcUrlError)
  })

  it('rejects a string that is not a URL', () => {
    expect(() => {
      assertValidRpcUrl('not-a-url')
    }).toThrow(InvalidRpcUrlError)
  })

  it('rejects an empty string', () => {
    expect(() => {
      assertValidRpcUrl('')
    }).toThrow(InvalidRpcUrlError)
  })
})

describe('assertValidRpcUrls', () => {
  it('accepts a non-empty list of secured addresses', () => {
    expect(() => {
      assertValidRpcUrls(['https://a.example.com', 'wss://b.example.com'])
    }).not.toThrow()
  })

  it('rejects an empty list', () => {
    expect(() => {
      assertValidRpcUrls([])
    }).toThrow(InvalidArgumentError)
  })

  it('rejects a list where at least one address is unsecured', () => {
    expect(() => {
      assertValidRpcUrls(['https://a.example.com', 'http://b.example.com'])
    }).toThrow(InsecureRpcUrlError)
  })
})

describe('assertValidExplorerUrl', () => {
  it('accepts https', () => {
    expect(() => {
      assertValidExplorerUrl('https://etherscan.io')
    }).not.toThrow()
  })

  it('rejects http', () => {
    expect(() => {
      assertValidExplorerUrl('http://etherscan.io')
    }).toThrow(InsecureRpcUrlError)
  })

  it('rejects wss: the explorer opens in a browser, not over a socket', () => {
    expect(() => {
      assertValidExplorerUrl('wss://etherscan.io')
    }).toThrow(InsecureRpcUrlError)
  })
})
