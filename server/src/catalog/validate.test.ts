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
  provenance: ['Список токенов', 'Сверка с контрактом'],
  verifiedAt: '2026-07-31',
}

const NOTIFICATION: INotificationEntry = {
  id: 'test',
  severity: NOTIFICATION_SEVERITY.Info,
  title: 'Заголовок',
  body: 'Текст уведомления без ссылок.',
  publishedAt: '2026-07-31T00:00:00.000Z',
  expiresAt: null,
}

const KNOWN = new Set([1n])

describe('Проверка каталога сетей', () => {
  it('принимает корректный каталог', () => {
    expect(validateNetworks([NETWORK])).toEqual(new Set([1n]))
  })

  it('отвергает пустой каталог', () => {
    expect(() => validateNetworks([])).toThrow(/пуст/u)
  })

  it('отвергает повторяющийся идентификатор сети', () => {
    /* Две сети с одним идентификатором неразличимы для кошелька:
       он выберет любую и обратится не туда. */
    expect(() => validateNetworks([NETWORK, { ...NETWORK, name: 'Другая' }])).toThrow(/дважды/u)
  })

  it('отвергает обозреватель по незашифрованному протоколу', () => {
    expect(() =>
      validateNetworks([{ ...NETWORK, blockExplorerUrls: ['http://etherscan.io'] }]),
    ).toThrow(/только https/u)
  })

  it('отвергает недопустимое число знаков валюты', () => {
    expect(() =>
      validateNetworks([
        { ...NETWORK, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 99 } },
      ]),
    ).toThrow(/число знаков/u)
  })
})

describe('Проверка каталога RPC', () => {
  it('принимает корректный каталог', () => {
    expect(() => {
      validateRpcEndpoints([RPC], KNOWN)
    }).not.toThrow()
  })

  it('отвергает адрес неизвестной сети', () => {
    expect(() => {
      validateRpcEndpoints([{ ...RPC, chainId: 999n }], KNOWN)
    }).toThrow(/отсутствует в каталоге сетей/u)
  })

  it('отвергает незашифрованный адрес', () => {
    /* Ответ узла по http подменяется по дороге: баланс, nonce
       и стоимость газа приходят от того, кто вклинился. */
    expect(() => {
      validateRpcEndpoints([{ ...RPC, url: 'http://node.example.com' }], KNOWN)
    }).toThrow(/только https/u)
  })

  it('отвергает сеть без единого узла', () => {
    /* Переключение на такую сеть дало бы неработающий кошелёк:
       обратиться будет некуда. */
    expect(() => {
      validateRpcEndpoints([], KNOWN)
    }).toThrow(/не имеет ни одного RPC/u)
  })

  it('отвергает повторяющийся адрес в одной сети', () => {
    expect(() => {
      validateRpcEndpoints([RPC, RPC], KNOWN)
    }).toThrow(/повторяется/u)
  })
})

describe('Проверка каталога токенов', () => {
  it('принимает корректную запись', () => {
    expect(() => {
      validateTokens([TOKEN], KNOWN)
    }).not.toThrow()
  })

  it('отвергает адрес без контрольной суммы EIP-55', () => {
    /* Контрольная сумма ловит опечатку в адресе при загрузке — до того,
       как ошибочный адрес разойдётся по кошелькам пользователей. */
    expect(() => {
      validateTokens([{ ...TOKEN, address: TOKEN.address.toLowerCase() }], KNOWN)
    }).toThrow(/контрольной суммы/u)
  })

  it('отвергает адрес с испорченным символом', () => {
    const broken = `${TOKEN.address.slice(0, -1)}9`

    expect(() => {
      validateTokens([{ ...TOKEN, address: broken }], KNOWN)
    }).toThrow(/контрольной суммы/u)
  })

  it('отвергает запись без указания источника', () => {
    /* Рекомендация без основания — это чужое доверие, выданное за своё. */
    expect(() => {
      validateTokens([{ ...TOKEN, provenance: [] }], KNOWN)
    }).toThrow(/источник/u)
  })

  it('отвергает повторяющийся адрес в одной сети', () => {
    expect(() => {
      validateTokens([TOKEN, { ...TOKEN, symbol: 'FAKE' }], KNOWN)
    }).toThrow(/повторяется/u)
  })

  it('отвергает токен неизвестной сети', () => {
    expect(() => {
      validateTokens([{ ...TOKEN, chainId: 999n }], KNOWN)
    }).toThrow(/отсутствует в каталоге сетей/u)
  })
})

describe('Проверка каталога уведомлений', () => {
  it('принимает корректную запись', () => {
    expect(() => {
      validateNotifications([NOTIFICATION])
    }).not.toThrow()
  })

  it('отвергает ссылку в тексте', () => {
    /* Сообщение сервиса внутри кошелька неотличимо для человека
       от сообщения самого кошелька, и ссылка в нём ведёт куда угодно. */
    expect(() => {
      validateNotifications([{ ...NOTIFICATION, body: 'Перейдите на https://example.com' }])
    }).toThrow(/ссылку/u)
  })

  it('отвергает адрес без схемы', () => {
    expect(() => {
      validateNotifications([{ ...NOTIFICATION, body: 'Откройте wallet-support.xyz прямо сейчас' }])
    }).toThrow(/ссылку/u)
  })

  it('отвергает ссылку в заголовке', () => {
    expect(() => {
      validateNotifications([{ ...NOTIFICATION, title: 'www.example.org' }])
    }).toThrow(/ссылку/u)
  })

  it('отвергает повторяющийся идентификатор', () => {
    expect(() => {
      validateNotifications([NOTIFICATION, NOTIFICATION])
    }).toThrow(/повторяется/u)
  })

  it('отвергает срок, истекающий раньше публикации', () => {
    expect(() => {
      validateNotifications([{ ...NOTIFICATION, expiresAt: '2020-01-01T00:00:00.000Z' }])
    }).toThrow(/раньше публикации/u)
  })

  it('отвергает слишком длинный текст', () => {
    /* Длинное сообщение сервиса вытесняет с экрана собственные
       предупреждения кошелька. */
    expect(() => {
      validateNotifications([{ ...NOTIFICATION, body: 'а'.repeat(501) }])
    }).toThrow(/превышает предел/u)
  })
})

describe('Проверка сведений о выпусках', () => {
  it('принимает корректные сведения', () => {
    expect(() => {
      validateReleases({ latest: '1.2.3', minSupported: '1.0.0', advisory: null })
    }).not.toThrow()
  })

  it('отвергает минимальную версию выше последней', () => {
    /* При таком каталоге неподдерживаемыми окажутся все, включая
       свежие установки. */
    expect(() => {
      validateReleases({ latest: '1.0.0', minSupported: '2.0.0', advisory: null })
    }).toThrow(/выше последней/u)
  })

  it('отвергает ссылку в пояснении', () => {
    /* «Скачайте обновление отсюда» — готовый способ увести пользователя
       на поддельный установщик. */
    expect(() => {
      validateReleases({
        latest: '1.0.0',
        minSupported: '1.0.0',
        advisory: 'Обновитесь: https://example.com/download',
      })
    }).toThrow(/ссылку/u)
  })

  it('отвергает версию с предвыпускной меткой', () => {
    expect(() => {
      validateReleases({ latest: '1.0.0-beta', minSupported: '1.0.0', advisory: null })
    }).toThrow(/latest/u)
  })
})

describe('Каталог из репозитория', () => {
  it('проходит собственную проверку', () => {
    /* Сервис с испорченным каталогом обязан не подняться. Этот тест
       ловит ошибку раньше развёртывания. */
    expect(() => new CatalogService(REPOSITORY_CATALOG)).not.toThrow()
  })

  it('содержит записи токенов с двумя источниками подтверждения', () => {
    for (const token of REPOSITORY_CATALOG.tokens) {
      expect(
        token.provenance.length,
        `${token.symbol} в сети ${token.chainId.toString()}`,
      ).toBeGreaterThanOrEqual(2)
    }
  })

  it('не рекомендует ни одного узла, требующего ключа', () => {
    /* Ключ, розданный всем пользователям, перестаёт быть ключом. */
    for (const endpoint of REPOSITORY_CATALOG.rpcEndpoints) {
      expect(endpoint.isPublic, endpoint.url).toBe(true)
    }
  })
})
