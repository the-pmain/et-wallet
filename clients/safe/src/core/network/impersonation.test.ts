import { describe, expect, it } from 'vitest'

import { toChainId } from '@/core/types'

import { BUILT_IN_CHAIN_ID, BUILT_IN_NETWORKS } from './built-in'
import { findForeignCharacters, toNameSkeleton } from '@/core/security'
import { IMPERSONATION_KIND, findImpersonation } from './impersonation'

const FOREIGN_CHAIN = toChainId(777_777n)

describe('findImpersonation', () => {
  it('catches a foreign network under a built-in name', () => {
    const found = findImpersonation({ chainId: FOREIGN_CHAIN, name: 'Ethereum' }, BUILT_IN_NETWORKS)

    /* Checking chainId with the node will not catch this: the node
       will honestly confirm its identifier. The only signal is the
       name match. */
    expect(found?.name).toBe('Ethereum')
    expect(found?.impersonated.chainId).toBe(BUILT_IN_CHAIN_ID.Ethereum)
  })

  it('is not bypassed by changing case', () => {
    expect(
      findImpersonation({ chainId: FOREIGN_CHAIN, name: 'ETHEREUM' }, BUILT_IN_NETWORKS),
    ).not.toBeNull()
    expect(
      findImpersonation({ chainId: FOREIGN_CHAIN, name: 'ethereum' }, BUILT_IN_NETWORKS),
    ).not.toBeNull()
  })

  it('is not bypassed by surrounding spaces', () => {
    expect(
      findImpersonation({ chainId: FOREIGN_CHAIN, name: '  Ethereum  ' }, BUILT_IN_NETWORKS),
    ).not.toBeNull()
  })

  it('lets through a network with a unique name', () => {
    expect(
      findImpersonation({ chainId: FOREIGN_CHAIN, name: 'My Private Chain' }, BUILT_IN_NETWORKS),
    ).toBeNull()
  })

  it('does not treat an identifier match as impersonation', () => {
    /* The same chainId means the same network, not a fake. A second
       add is cut off by a separate existence check. */
    expect(
      findImpersonation(
        { chainId: BUILT_IN_CHAIN_ID.Ethereum, name: 'Ethereum' },
        BUILT_IN_NETWORKS,
      ),
    ).toBeNull()
  })

  it('does not fire on a currency-symbol match', () => {
    /* Optimism, Arbitrum and Base lawfully use the ETH symbol.
       A warning on every such match would be a false alarm, and
       that trains people not to read warnings. */
    const found = findImpersonation(
      { chainId: FOREIGN_CHAIN, name: 'Some L2 Rollup' },
      BUILT_IN_NETWORKS,
    )

    expect(found).toBeNull()
  })

  it('catches the name of any built-in network, not only the main one', () => {
    expect(
      findImpersonation({ chainId: FOREIGN_CHAIN, name: 'Polygon' }, BUILT_IN_NETWORKS),
    ).not.toBeNull()
    expect(
      findImpersonation({ chainId: FOREIGN_CHAIN, name: 'Base' }, BUILT_IN_NETWORKS),
    ).not.toBeNull()
  })

  it('finds no impersonation in an empty built-in list', () => {
    expect(findImpersonation({ chainId: FOREIGN_CHAIN, name: 'Ethereum' }, [])).toBeNull()
  })
})

describe('Impersonation by look-alike characters', () => {
  /** The name `Ethereum` with a Cyrillic `e`. Looks identical. */
  const CYRILLIC_ETHEREUM = `Eth\u0435r\u0435um`

  it('a Cyrillic letter inside a Latin name is recognised', () => {
    /* Not one matching byte with the real name, and on screen it
       is the same word. */
    const found = findImpersonation(
      { chainId: toChainId(999n), name: CYRILLIC_ETHEREUM },
      BUILT_IN_NETWORKS,
    )

    expect(found?.impersonated.name).toBe('Ethereum')
    expect(found?.kind).toBe(IMPERSONATION_KIND.LookAlike)
  })

  it('foreign letters are listed for display to the user', () => {
    /* The person sees two identical names; without a list of
       letters the message looks like a wallet bug. */
    const found = findImpersonation(
      { chainId: toChainId(999n), name: CYRILLIC_ETHEREUM },
      BUILT_IN_NETWORKS,
    )

    expect(found?.foreignCharacters).toEqual(['\u0435'])
  })

  it('a match in the same letters is not called a character impersonation', () => {
    /* Different cases need different explanations: the person can
       see identical letters themselves. */
    const found = findImpersonation(
      { chainId: toChainId(999n), name: 'ethereum' },
      BUILT_IN_NETWORKS,
    )

    expect(found?.kind).toBe(IMPERSONATION_KIND.SameName)
    expect(found?.foreignCharacters).toEqual([])
  })

  it('a digit in place of a letter is recognised', () => {
    /* The same impersonation by ASCII means, with no Unicode at
       all: `P0lygon` cannot be told from `Polygon` on screen. */
    expect(
      findImpersonation({ chainId: toChainId(999n), name: 'P0lygon' }, BUILT_IN_NETWORKS)
        ?.impersonated.name,
    ).toBe('Polygon')
  })

  it('hyphens and spaces do not save the name', () => {
    expect(
      findImpersonation({ chainId: toChainId(999n), name: 'E-the-reum' }, BUILT_IN_NETWORKS)
        ?.impersonated.name,
    ).toBe('Ethereum')
  })

  it('invisible characters inside the name do not save it', () => {
    /* A zero-width character is visible neither on screen nor in
       an eye check. */
    expect(
      findImpersonation({ chainId: toChainId(999n), name: 'Ethe\u200breum' }, BUILT_IN_NETWORKS)
        ?.impersonated.name,
    ).toBe('Ethereum')
  })

  it('mathematical letter-forms do not save it', () => {
    /* NFKD normalisation folds it; no separate table is needed. */
    expect(
      findImpersonation(
        {
          chainId: toChainId(999n),
          name: '\u{1D404}\u{1D42D}\u{1D421}\u{1D41E}\u{1D42B}\u{1D41E}\u{1D42E}\u{1D426}',
        },
        BUILT_IN_NETWORKS,
      )?.impersonated.name,
    ).toBe('Ethereum')
  })

  it('another network name does not raise a false alarm', () => {
    /* A false alarm is worse than no check: it trains people not
       to read warnings. */
    expect(
      findImpersonation({ chainId: toChainId(999n), name: 'Ethereum Classic' }, BUILT_IN_NETWORKS),
    ).toBeNull()
    expect(
      findImpersonation({ chainId: toChainId(999n), name: 'My Test Chain' }, BUILT_IN_NETWORKS),
    ).toBeNull()
  })

  it('a name of punctuation alone is not treated as a match', () => {
    /* An empty skeleton would match every built-in name at once. */
    expect(
      findImpersonation({ chainId: toChainId(999n), name: '---' }, BUILT_IN_NETWORKS),
    ).toBeNull()
  })
})

describe('Reducing a name to a skeleton', () => {
  it('Cyrillic and Latin spellings yield one skeleton', () => {
    expect(toNameSkeleton('Eth\u0435r\u0435um')).toBe(toNameSkeleton('Ethereum'))
  })

  it('a one and a lowercase L are indistinguishable', () => {
    expect(toNameSkeleton('Po1ygon')).toBe(toNameSkeleton('Polygon'))
  })

  it('different names stay different', () => {
    expect(toNameSkeleton('Base')).not.toBe(toNameSkeleton('Ethereum'))
    expect(toNameSkeleton('Arbitrum')).not.toBe(toNameSkeleton('Avalanche'))
  })

  it('Latin letters are not treated as foreign', () => {
    expect(findForeignCharacters('Ethereum 2')).toEqual([])
  })
})
