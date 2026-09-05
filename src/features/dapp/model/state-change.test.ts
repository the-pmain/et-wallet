import { describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import { toChainId } from '@/core/types'

import { buildStateChangeEmissions } from './WalletConnectTransport'

const OWNER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const ETHEREUM = toChainId(1n)
const POLYGON = toChainId(137n)

function session(topic: string, chains: readonly string[]) {
  return {
    topic,
    expiry: 0,
    peer: { metadata: {} },
    namespaces: { eip155: { chains } },
  }
}

describe('Building state-change events', () => {
  it('sends two events for every matching connection', () => {
    /* The app needs both: the network to prepare an operation for
       the right chain, the account to show the right address. */
    const emissions = buildStateChangeEmissions([session('a', ['eip155:1'])], ETHEREUM, [OWNER])

    expect(emissions.map((entry) => entry.event.name)).toEqual(['chainChanged', 'accountsChanged'])
  })

  it('sends the network as a hex string', () => {
    /* EIP-1193 format: apps expect `0x89`, not the number 137. */
    const emissions = buildStateChangeEmissions([session('a', ['eip155:137'])], POLYGON, [OWNER])

    expect(emissions[0]?.event.data).toBe('0x89')
  })

  it('sends addresses in CAIP-10 form', () => {
    /* Same form issued at connect: some apps reject a bare address. */
    const emissions = buildStateChangeEmissions([session('a', ['eip155:1'])], ETHEREUM, [OWNER])

    expect(emissions[1]?.event.data).toEqual([`eip155:1:${OWNER}`])
  })

  it('sends the event only to sessions that approved this network', () => {
    /* Relay would reject an app that did not request the network,
       and iterating mismatched networks fills the log. */
    const emissions = buildStateChangeEmissions(
      [session('approved', ['eip155:1']), session('did not approve', ['eip155:137'])],
      ETHEREUM,
      [OWNER],
    )

    expect(new Set(emissions.map((entry) => entry.topic))).toEqual(new Set(['approved']))
  })

  it('emits nothing without connections', () => {
    expect(buildStateChangeEmissions([], ETHEREUM, [OWNER])).toEqual([])
  })

  it('the event envelope carries the same network as the change', () => {
    /* Relay checks the envelope chainId against the session's
       approved networks; a mismatch with the event itself would
       be rejected. */
    const emissions = buildStateChangeEmissions([session('a', ['eip155:1'])], ETHEREUM, [OWNER])

    expect(emissions.every((entry) => entry.chainId === 'eip155:1')).toBe(true)
  })
})
