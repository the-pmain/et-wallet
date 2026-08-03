import { describe, expect, it } from 'vitest'

import { toChainId } from '@/core/types'

import { BUILT_IN_CHAIN_ID, BUILT_IN_NETWORKS } from './built-in'
import { findForeignCharacters, toNameSkeleton } from './confusable'
import { IMPERSONATION_KIND, findImpersonation } from './impersonation'

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

describe('Подмена похожими символами', () => {
  /** Имя `Ethereum`, где `e` — кириллическая. Выглядит неотличимо. */
  const CYRILLIC_ETHEREUM = `Eth\u0435r\u0435um`

  it('кириллическая буква внутри латинского имени распознаётся', () => {
    /* Ни одного совпадающего байта с настоящим именем, и при этом
       на экране — то же самое слово. */
    const found = findImpersonation(
      { chainId: toChainId(999n), name: CYRILLIC_ETHEREUM },
      BUILT_IN_NETWORKS,
    )

    expect(found?.impersonated.name).toBe('Ethereum')
    expect(found?.kind).toBe(IMPERSONATION_KIND.LookAlike)
  })

  it('чужие буквы перечисляются для показа пользователю', () => {
    /* Человек видит два одинаковых названия; без перечня букв
       сообщение выглядит ошибкой кошелька. */
    const found = findImpersonation(
      { chainId: toChainId(999n), name: CYRILLIC_ETHEREUM },
      BUILT_IN_NETWORKS,
    )

    expect(found?.foreignCharacters).toEqual(['\u0435'])
  })

  it('совпадение по тем же буквам подменой символов не называется', () => {
    /* Разные случаи требуют разных объяснений: одинаковые буквы человек
       видит сам. */
    const found = findImpersonation(
      { chainId: toChainId(999n), name: 'ethereum' },
      BUILT_IN_NETWORKS,
    )

    expect(found?.kind).toBe(IMPERSONATION_KIND.SameName)
    expect(found?.foreignCharacters).toEqual([])
  })

  it('цифра на месте буквы распознаётся', () => {
    /* Та же подмена средствами ASCII, без всякого Unicode:
       `P0lygon` от `Polygon` на экране не отличить. */
    expect(
      findImpersonation({ chainId: toChainId(999n), name: 'P0lygon' }, BUILT_IN_NETWORKS)
        ?.impersonated.name,
    ).toBe('Polygon')
  })

  it('дефис и пробелы имя не спасают', () => {
    expect(
      findImpersonation({ chainId: toChainId(999n), name: 'E-the-reum' }, BUILT_IN_NETWORKS)
        ?.impersonated.name,
    ).toBe('Ethereum')
  })

  it('невидимые символы внутри имени не спасают', () => {
    /* Символ нулевой ширины не виден ни на экране, ни при сверке
       глазами. */
    expect(
      findImpersonation({ chainId: toChainId(999n), name: 'Ethe\u200breum' }, BUILT_IN_NETWORKS)
        ?.impersonated.name,
    ).toBe('Ethereum')
  })

  it('математическое начертание не спасает', () => {
    /* Приводится нормализацией NFKD, отдельной таблицы не требует. */
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

  it('название другой сети ложной тревоги не вызывает', () => {
    /* Ложная тревога хуже отсутствия проверки: она приучает
       не читать предупреждения. */
    expect(
      findImpersonation({ chainId: toChainId(999n), name: 'Ethereum Classic' }, BUILT_IN_NETWORKS),
    ).toBeNull()
    expect(
      findImpersonation({ chainId: toChainId(999n), name: 'My Test Chain' }, BUILT_IN_NETWORKS),
    ).toBeNull()
  })

  it('имя из одних знаков препинания совпадением не считается', () => {
    /* Пустой скелет совпал бы с любым встроенным именем сразу. */
    expect(
      findImpersonation({ chainId: toChainId(999n), name: '---' }, BUILT_IN_NETWORKS),
    ).toBeNull()
  })
})

describe('Приведение имени к скелету', () => {
  it('кириллическое и латинское написание дают один скелет', () => {
    expect(toNameSkeleton('Eth\u0435r\u0435um')).toBe(toNameSkeleton('Ethereum'))
  })

  it('единица и строчная L неразличимы', () => {
    expect(toNameSkeleton('Po1ygon')).toBe(toNameSkeleton('Polygon'))
  })

  it('разные названия остаются разными', () => {
    expect(toNameSkeleton('Base')).not.toBe(toNameSkeleton('Ethereum'))
    expect(toNameSkeleton('Arbitrum')).not.toBe(toNameSkeleton('Avalanche'))
  })

  it('латинские буквы чужими не считаются', () => {
    expect(findForeignCharacters('Ethereum 2')).toEqual([])
  })
})
