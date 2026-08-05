import { describe, expect, it } from 'vitest'

import { BUILT_IN_CHAIN_ID, toAddress, toChainId } from '@/core'

import { findTokenLogo } from './token-logo'

/** Настоящий USDC в Ethereum — запись встроенного реестра. */
const REAL_USDC = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

/** Произвольный адрес: такой контракт может выпустить кто угодно. */
const FAKE = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

describe('findTokenLogo: знак полагается только проверенному', () => {
  it('выдаёт знак настоящему USDC', () => {
    expect(findTokenLogo(BUILT_IN_CHAIN_ID.Ethereum, REAL_USDC)?.src).toBe('/logos/usdc.svg')
  })

  it('НЕ выдаёт знак подделке с тем же обозначением', () => {
    /* Главная проверка этого модуля. Выпустить контракт с символом
       «USDC» может кто угодно почти бесплатно. Знак, выданный по
       обозначению, добавил бы подделке убедительности; знак, выданный
       по адресу, наоборот отличает её от настоящего токена. */
    expect(findTokenLogo(BUILT_IN_CHAIN_ID.Ethereum, FAKE)).toBeNull()
  })

  it('НЕ выдаёт знак тому же адресу в другой сети', () => {
    /* Один адрес в разных сетях — разные контракты. Реестр проверен
       по паре «сеть и адрес», и знак следует за этой парой. */
    expect(findTokenLogo(BUILT_IN_CHAIN_ID.BnbChain, REAL_USDC)).toBeNull()
  })

  it('выдаёт знак нативной валюты по сети', () => {
    expect(findTokenLogo(BUILT_IN_CHAIN_ID.Ethereum, null)?.src).toBe('/logos/eth.svg')
    expect(findTokenLogo(BUILT_IN_CHAIN_ID.BnbChain, null)?.src).toBe('/logos/bnb.svg')

    /* У сетей второго уровня нативная валюта — эфир, и знак у неё
       эфирный: это не упрощение, а то, чем там платят. */
    expect(findTokenLogo(BUILT_IN_CHAIN_ID.Base, null)?.src).toBe('/logos/eth.svg')
  })

  it('молчит о неизвестной сети вместо догадки', () => {
    expect(findTokenLogo(toChainId(9999n), null)).toBeNull()
    expect(findTokenLogo(null, REAL_USDC)).toBeNull()
  })

  it('у эфира есть вариант для тёмной темы', () => {
    /* Официальный ромб нарисован серыми тонами от `#141414` и на
       тёмном фоне пропадает. У остальных знаков такой беды нет,
       и лишнего файла им не заводится. */
    expect(findTokenLogo(BUILT_IN_CHAIN_ID.Ethereum, null)?.srcOnDark).toBe(
      '/logos/eth-on-dark.svg',
    )
    expect(findTokenLogo(BUILT_IN_CHAIN_ID.Ethereum, REAL_USDC)?.srcOnDark).toBeNull()
  })

  it('обёрнутый актив носит знак исходного', () => {
    /* WETH — эфир в обёртке ERC-20, один к одному. Собственного знака
       у обёртки нет, и выдумывать его незачем. */
    const weth = toAddress('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2')

    expect(findTokenLogo(BUILT_IN_CHAIN_ID.Ethereum, weth)?.src).toBe('/logos/eth.svg')
  })
})
