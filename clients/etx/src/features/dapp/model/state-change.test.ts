import { describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import { toChainId } from '@/core/types'

import { buildStateChangeEmissions } from './WalletConnectTransport'

const OWNER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const ETHEREUM = toChainId(1n)
const POLYGON = toChainId(137n)

/** Сессия, одобрившая перечисленные сети. */
function session(topic: string, chains: readonly string[]) {
  return {
    topic,
    expiry: 0,
    peer: { metadata: {} },
    namespaces: { eip155: { chains } },
  }
}

describe('Сборка событий смены состояния', () => {
  it('на каждое подходящее подключение уходит два события', () => {
    /* Приложению важно и то, и другое: сеть — чтобы готовить операцию
       для верной цепи, аккаунт — чтобы показать верный адрес. */
    const emissions = buildStateChangeEmissions([session('a', ['eip155:1'])], ETHEREUM, [OWNER])

    expect(emissions.map((entry) => entry.event.name)).toEqual(['chainChanged', 'accountsChanged'])
  })

  it('сеть передаётся шестнадцатеричной строкой', () => {
    /* Формат EIP-1193: приложения ждут `0x89`, а не число 137. */
    const emissions = buildStateChangeEmissions([session('a', ['eip155:137'])], POLYGON, [OWNER])

    expect(emissions[0]?.event.data).toBe('0x89')
  })

  it('адреса передаются в формате CAIP-10', () => {
    /* Тот же формат, в каком они выданы при подключении: голый адрес
       часть приложений не принимает. */
    const emissions = buildStateChangeEmissions([session('a', ['eip155:1'])], ETHEREUM, [OWNER])

    expect(emissions[1]?.event.data).toEqual([`eip155:1:${OWNER}`])
  })

  it('событие уходит только одобрившим эту сеть', () => {
    /* Приложению, не запрашивавшему сеть, relay всё равно откажет,
       а перебор несогласованных сетей засоряет журнал. */
    const emissions = buildStateChangeEmissions(
      [session('одобрил', ['eip155:1']), session('не одобрял', ['eip155:137'])],
      ETHEREUM,
      [OWNER],
    )

    expect(new Set(emissions.map((entry) => entry.topic))).toEqual(new Set(['одобрил']))
  })

  it('без подключений событий нет', () => {
    expect(buildStateChangeEmissions([], ETHEREUM, [OWNER])).toEqual([])
  })

  it('конверт события несёт ту же сеть, что и сам переход', () => {
    /* relay сверяет поле chainId конверта с одобренными сетями сессии;
       расхождение с самим событием было бы отвергнуто. */
    const emissions = buildStateChangeEmissions([session('a', ['eip155:1'])], ETHEREUM, [OWNER])

    expect(emissions.every((entry) => entry.chainId === 'eip155:1')).toBe(true)
  })
})
