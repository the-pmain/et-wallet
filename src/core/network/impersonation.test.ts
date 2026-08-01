import { describe, expect, it } from 'vitest'

import { toChainId } from '@/core/types'

import { BUILT_IN_CHAIN_ID, BUILT_IN_NETWORKS } from './built-in'
import { findImpersonation } from './impersonation'

const FOREIGN_CHAIN = toChainId(777_777n)

describe('findImpersonation', () => {
  it('ловит чужую сеть под именем встроенной', () => {
    const found = findImpersonation({ chainId: FOREIGN_CHAIN, name: 'Ethereum' }, BUILT_IN_NETWORKS)

    /* Сверка chainId с узлом этого не поймает: узел честно подтвердит
       свой идентификатор. Единственный признак — совпадение имени. */
    expect(found?.name).toBe('Ethereum')
    expect(found?.impersonated.chainId).toBe(BUILT_IN_CHAIN_ID.Ethereum)
  })

  it('не обходится сменой регистра', () => {
    expect(
      findImpersonation({ chainId: FOREIGN_CHAIN, name: 'ETHEREUM' }, BUILT_IN_NETWORKS),
    ).not.toBeNull()
    expect(
      findImpersonation({ chainId: FOREIGN_CHAIN, name: 'ethereum' }, BUILT_IN_NETWORKS),
    ).not.toBeNull()
  })

  it('не обходится краевыми пробелами', () => {
    expect(
      findImpersonation({ chainId: FOREIGN_CHAIN, name: '  Ethereum  ' }, BUILT_IN_NETWORKS),
    ).not.toBeNull()
  })

  it('пропускает сеть с уникальным именем', () => {
    expect(
      findImpersonation({ chainId: FOREIGN_CHAIN, name: 'My Private Chain' }, BUILT_IN_NETWORKS),
    ).toBeNull()
  })

  it('не считает подменой совпадение идентификатора', () => {
    /* Тот же chainId означает ту же сеть, а не подделку. Повторное
       добавление отсекается отдельной проверкой на существование. */
    expect(
      findImpersonation(
        { chainId: BUILT_IN_CHAIN_ID.Ethereum, name: 'Ethereum' },
        BUILT_IN_NETWORKS,
      ),
    ).toBeNull()
  })

  it('не срабатывает на совпадении символа валюты', () => {
    /* Символ ETH законно используют Optimism, Arbitrum и Base.
       Предупреждение на каждое такое совпадение было бы ложной тревогой,
       а она приучает не читать предупреждения. */
    const found = findImpersonation(
      { chainId: FOREIGN_CHAIN, name: 'Some L2 Rollup' },
      BUILT_IN_NETWORKS,
    )

    expect(found).toBeNull()
  })

  it('ловит имя любой встроенной сети, не только основной', () => {
    expect(
      findImpersonation({ chainId: FOREIGN_CHAIN, name: 'Polygon' }, BUILT_IN_NETWORKS),
    ).not.toBeNull()
    expect(
      findImpersonation({ chainId: FOREIGN_CHAIN, name: 'Base' }, BUILT_IN_NETWORKS),
    ).not.toBeNull()
  })

  it('не находит подмены в пустом списке встроенных сетей', () => {
    expect(findImpersonation({ chainId: FOREIGN_CHAIN, name: 'Ethereum' }, [])).toBeNull()
  })
})
