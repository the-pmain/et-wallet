import { describe, expect, it } from 'vitest'

import { NOTIFICATION_SEVERITY } from '../api/contracts.ts'

import { CatalogService, REPOSITORY_CATALOG } from './CatalogService.ts'
import type { INetworkEntry, INotificationEntry, IRpcEntry, ITokenEntry } from './types.ts'
import {
  validateNetworks,
  validateNotifications,
  validateReleases,
  validateRpcEndpoints,
  validateTokens,
} from './validate.ts'

const NETWORK: INetworkEntry = {
  chainId: 1n,
  name: 'Ethereum',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  blockExplorerUrls: ['https://etherscan.io'],
  isTestnet: false,
  supportsEip1559: true,
}

const RPC: IRpcEntry = {
  chainId: 1n,
  url: 'https://ethereum-rpc.publicnode.com',
  operator: 'PublicNode',
  isPublic: true,
}

const TOKEN: ITokenEntry = {
  chainId: 1n,
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  provenance: ['Token list', 'Checked against the contract'],
  verifiedAt: '2026-07-31',
}

const NOTIFICATION: INotificationEntry = {
  id: 'test',
  severity: NOTIFICATION_SEVERITY.Info,
  title: 'Title',
  body: 'Notification text without links.',
  publishedAt: '2026-07-31T00:00:00.000Z',
  expiresAt: null,
}

const KNOWN = new Set([1n])

describe('Network catalog validation', () => {
  it('accepts a valid catalog', () => {
    expect(validateNetworks([NETWORK])).toEqual(new Set([1n]))
  })

  it('rejects an empty catalog', () => {
    expect(() => validateNetworks([])).toThrow(/empty/u)
  })

  it('rejects a duplicate network id', () => {
    /* Two networks with one id are indistinguishable to the wallet:
       it will pick either and talk to the wrong one. */
    expect(() => validateNetworks([NETWORK, { ...NETWORK, name: 'Other' }])).toThrow(/twice/u)
  })

  it('rejects an explorer over a cleartext protocol', () => {
    expect(() =>
      validateNetworks([{ ...NETWORK, blockExplorerUrls: ['http://etherscan.io'] }]),
    ).toThrow(/only https/u)
  })

  it('rejects an invalid currency decimal count', () => {
    expect(() =>
      validateNetworks([
        { ...NETWORK, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 99 } },
      ]),
    ).toThrow(/decimal count/u)
  })
})

describe('RPC catalog validation', () => {
  it('accepts a valid catalog', () => {
    expect(() => {
      validateRpcEndpoints([RPC], KNOWN)
    }).not.toThrow()
  })

  it('rejects an address of an unknown network', () => {
    expect(() => {
      validateRpcEndpoints([{ ...RPC, chainId: 999n }], KNOWN)
    }).toThrow(/missing from the network catalog/u)
  })

  it('rejects a cleartext URL', () => {
    /* An http node response is swapped in transit: balance, nonce
       and gas price come from whoever intercepted. */
    expect(() => {
      validateRpcEndpoints([{ ...RPC, url: 'http://node.example.com' }], KNOWN)
    }).toThrow(/only https/u)
  })

  it('rejects a network with no node', () => {
    /* Switching to such a network would yield a dead wallet:
       there is nowhere to send requests. */
    expect(() => {
      validateRpcEndpoints([], KNOWN)
    }).toThrow(/has no RPC/u)
  })

  it('rejects a duplicate address on the same network', () => {
    expect(() => {
      validateRpcEndpoints([RPC, RPC], KNOWN)
    }).toThrow(/repeated/u)
  })
})

describe('Token catalog validation', () => {
  it('accepts a valid record', () => {
    expect(() => {
      validateTokens([TOKEN], KNOWN)
    }).not.toThrow()
  })

  it('rejects an address without an EIP-55 checksum', () => {
    /* The checksum catches an address typo on load — before a wrong
       address reaches users' wallets. */
    expect(() => {
      validateTokens([{ ...TOKEN, address: TOKEN.address.toLowerCase() }], KNOWN)
    }).toThrow(/checksum/u)
  })

  it('rejects an address with a corrupted character', () => {
    const broken = `${TOKEN.address.slice(0, -1)}9`

    expect(() => {
      validateTokens([{ ...TOKEN, address: broken }], KNOWN)
    }).toThrow(/checksum/u)
  })

  it('rejects a record with no source', () => {
    /* A recommendation with no basis is someone else's trust passed off as ours. */
    expect(() => {
      validateTokens([{ ...TOKEN, provenance: [] }], KNOWN)
    }).toThrow(/source/u)
  })

  it('rejects a duplicate address on the same network', () => {
    expect(() => {
      validateTokens([TOKEN, { ...TOKEN, symbol: 'FAKE' }], KNOWN)
    }).toThrow(/repeated/u)
  })

  it('rejects a token of an unknown network', () => {
    expect(() => {
      validateTokens([{ ...TOKEN, chainId: 999n }], KNOWN)
    }).toThrow(/missing from the network catalog/u)
  })
})

describe('Notification catalog validation', () => {
  it('accepts a valid record', () => {
    expect(() => {
      validateNotifications([NOTIFICATION])
    }).not.toThrow()
  })

  it('rejects a link in the body', () => {
    /* A service message inside the wallet is indistinguishable from
       a wallet message, and a link in it goes anywhere. */
    expect(() => {
      validateNotifications([{ ...NOTIFICATION, body: 'Go to https://example.com' }])
    }).toThrow(/link/u)
  })

  it('rejects an address without a scheme', () => {
    expect(() => {
      validateNotifications([{ ...NOTIFICATION, body: 'Open wallet-support.xyz right now' }])
    }).toThrow(/link/u)
  })

  it('rejects a link in the title', () => {
    expect(() => {
      validateNotifications([{ ...NOTIFICATION, title: 'www.example.org' }])
    }).toThrow(/link/u)
  })

  it('rejects a duplicate id', () => {
    expect(() => {
      validateNotifications([NOTIFICATION, NOTIFICATION])
    }).toThrow(/repeated/u)
  })

  it('rejects an expiry before publish', () => {
    expect(() => {
      validateNotifications([{ ...NOTIFICATION, expiresAt: '2020-01-01T00:00:00.000Z' }])
    }).toThrow(/earlier than publication/u)
  })

  it('rejects text that is too long', () => {
    /* A long service message pushes the wallet's own warnings off
       the screen. */
    expect(() => {
      validateNotifications([{ ...NOTIFICATION, body: 'a'.repeat(501) }])
    }).toThrow(/exceeds the limit/u)
  })
})

describe('Release info validation', () => {
  it('accepts valid info', () => {
    expect(() => {
      validateReleases({ latest: '1.2.3', minSupported: '1.0.0', advisory: null })
    }).not.toThrow()
  })

  it('rejects a minimum version above latest', () => {
    /* With such a catalog everyone would be unsupported, including
       fresh installs. */
    expect(() => {
      validateReleases({ latest: '1.0.0', minSupported: '2.0.0', advisory: null })
    }).toThrow(/above the latest/u)
  })

  it('rejects a link in the advisory', () => {
    /* "Download the update from here" is a ready way to send the user
       to a fake installer. */
    expect(() => {
      validateReleases({
        latest: '1.0.0',
        minSupported: '1.0.0',
        advisory: 'Update: https://example.com/download',
      })
    }).toThrow(/link/u)
  })

  it('rejects a version with a pre-release tag', () => {
    expect(() => {
      validateReleases({ latest: '1.0.0-beta', minSupported: '1.0.0', advisory: null })
    }).toThrow(/latest/u)
  })
})

describe('Repository catalog', () => {
  it('passes its own validation', () => {
    /* A service with a corrupt catalog must not start. This test
       catches the error before deploy. */
    expect(() => new CatalogService(REPOSITORY_CATALOG)).not.toThrow()
  })

  it('contains token records with two confirmation sources', () => {
    for (const token of REPOSITORY_CATALOG.tokens) {
      expect(
        token.provenance.length,
        `${token.symbol} on network ${token.chainId.toString()}`,
      ).toBeGreaterThanOrEqual(2)
    }
  })

  it('recommends no node that requires a key', () => {
    /* A key given to every user stops being a key. */
    for (const endpoint of REPOSITORY_CATALOG.rpcEndpoints) {
      expect(endpoint.isPublic, endpoint.url).toBe(true)
    }
  })
})
