import { beforeEach, describe, expect, it } from 'vitest'

import { BUILT_IN_CHAIN_ID, type Wei } from '@/core'
import { TEST_MNEMONIC, TEST_MNEMONIC_ADDRESSES } from '@/core/hdwallet/vectors'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'

import { PRICE_REFRESH_INTERVAL_MS } from '../lib/price-refresh'
import { SESSION_STATE } from './contracts'

const PASSWORD = 'Korova-7-Luna!'

/**
 * Ожидаемый адрес берётся из общего набора векторов, а не выписывается
 * заново: константа, скопированная из вывода собственного кода, проверяла бы
 * реализацию ею же самой. Набор сверен с MetaMask, Rabby и Trust Wallet
 * на этапе HD-кошелька.
 */
const FIRST_ADDRESS = TEST_MNEMONIC_ADDRESSES[0]

let services: ITestAppServices

beforeEach(async () => {
  services = createTestAppServices()
  services.providerFactory.configure({ balance: 1_500_000_000_000_000_000n as Wei })

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
})

describe('WalletSession.open', () => {
  it('создаёт первый аккаунт из seed-фразы', async () => {
    await services.session.open()

    const snapshot = services.session.getSnapshot()

    expect(snapshot.state).toBe(SESSION_STATE.Open)
    expect(snapshot.accounts).toHaveLength(1)
    expect(snapshot.activeAccount?.address).toBe(FIRST_ADDRESS)
  })

  it('поднимает список сетей и выбирает активную', async () => {
    await services.session.open()

    const snapshot = services.session.getSnapshot()

    expect(snapshot.networks.length).toBeGreaterThan(1)
    expect(snapshot.activeNetwork?.chainId).toBe(BUILT_IN_CHAIN_ID.Ethereum)
  })

  it('получает баланс активного аккаунта', async () => {
    await services.session.open()

    expect(services.session.getSnapshot().balance?.raw).toBe(1_500_000_000_000_000_000n)
  })

  it('не выбрасывает исключение при отказе узла', async () => {
    services.providerFactory.configure({ unavailable: true })

    await services.session.open()

    const snapshot = services.session.getSnapshot()

    /* Недоступный узел не мешает работе с ключами: аккаунты выведены
       локально, и экран обязан открыться. Отсутствие баланса помечается
       ошибкой, а не подменяется нулём. */
    expect(snapshot.state).toBe(SESSION_STATE.Open)
    expect(snapshot.activeAccount).not.toBeNull()
    expect(snapshot.balance).toBeNull()
    expect(snapshot.balanceError).not.toBeNull()
  })

  it('сообщает об отказе, если фразы в хранилище нет', async () => {
    const empty = createTestAppServices()

    await empty.session.open()

    expect(empty.session.getSnapshot().state).toBe(SESSION_STATE.Failed)
    expect(empty.session.getSnapshot().error).not.toBeNull()
  })

  it('повторный вызов не создаёт второй аккаунт', async () => {
    await services.session.open()
    await services.session.open()

    expect(services.session.getSnapshot().accounts).toHaveLength(1)
  })
})

describe('WalletSession.close', () => {
  it('сбрасывает снимок и закрывает соединения', async () => {
    await services.session.open()
    await services.session.close()

    const snapshot = services.session.getSnapshot()

    expect(snapshot.state).toBe(SESSION_STATE.Closed)
    expect(snapshot.accounts).toHaveLength(0)
    expect(snapshot.balance).toBeNull()
    expect(services.providerFactory.lastProvider?.isActive).toBe(false)
  })

  it('позволяет открыть сессию заново', async () => {
    await services.session.open()
    await services.session.close()
    await services.session.open()

    expect(services.session.getSnapshot().state).toBe(SESSION_STATE.Open)
    /* Аккаунт читается из хранилища, а не создаётся повторно. */
    expect(services.session.getSnapshot().accounts).toHaveLength(1)
  })
})

describe('WalletSession: аккаунты', () => {
  it('добавляет аккаунт со следующим адресом', async () => {
    await services.session.open()
    await services.session.createAccount()

    const snapshot = services.session.getSnapshot()

    expect(snapshot.accounts).toHaveLength(2)
    expect(snapshot.accounts[1]?.address).not.toBe(FIRST_ADDRESS)
  })

  it('переключает активный аккаунт', async () => {
    await services.session.open()
    await services.session.createAccount()

    const second = services.session.getSnapshot().accounts[1]

    await services.session.selectAccount(second!.id)

    expect(services.session.getSnapshot().activeAccount?.id).toBe(second!.id)
  })
})

describe('WalletSession: сети', () => {
  it('переключает активную сеть', async () => {
    await services.session.open()
    await services.session.switchNetwork(BUILT_IN_CHAIN_ID.Polygon)

    expect(services.session.getSnapshot().activeNetwork?.chainId).toBe(BUILT_IN_CHAIN_ID.Polygon)
  })

  it('не показывает баланс прежней сети после переключения', async () => {
    await services.session.open()

    services.providerFactory.configure({ balance: 7n as Wei })
    await services.session.switchNetwork(BUILT_IN_CHAIN_ID.Polygon)

    /* Значение обязано быть перезапрошено: баланс одной сети под именем
       другой — прямая дезинформация о доступных средствах. */
    expect(services.session.getSnapshot().balance?.raw).toBe(7n)
  })
})

describe('WalletSession: подписка', () => {
  it('уведомляет подписчиков о смене снимка', async () => {
    let notifications = 0
    const unsubscribe = services.session.subscribe(() => {
      notifications += 1
    })

    await services.session.open()
    unsubscribe()

    expect(notifications).toBeGreaterThan(0)
  })

  it('перестаёт уведомлять после отписки', async () => {
    let notifications = 0
    const unsubscribe = services.session.subscribe(() => {
      notifications += 1
    })

    unsubscribe()
    await services.session.open()

    expect(notifications).toBe(0)
  })
})

/**
 * ОПРОС КУРСОВ.
 *
 * Проверяется на управляемых часах, а не на поддельных таймерах:
 * в этом наборе уже есть плавающий тест на `vi.useFakeTimers`, и
 * заводить второй такой незачем. `FakeClock` двигается только явным
 * вызовом, поэтому расписание проверяется точно.
 */
describe('WalletSession: опрос курсов', () => {
  /** Двигает часы и даёт разрешиться цепочке обещаний такта. */
  async function advance(ms: number): Promise<void> {
    services.clock.advance(ms)

    for (let step = 0; step < 20; step += 1) {
      await Promise.resolve()
    }
  }

  it('без согласия источник не опрашивается вовсе', async () => {
    /* Не «спит до разрешения», а не заводится: спящий таймер
       обратился бы к источнику без согласия владельца. */
    await services.session.open()

    const before = services.priceProvider.callCount

    await advance(10 * PRICE_REFRESH_INTERVAL_MS)

    expect(services.priceProvider.callCount).toBe(before)
  })

  it('после согласия опрашивает раз в промежуток', async () => {
    await services.session.open()
    await services.session.enablePrices()

    const before = services.priceProvider.callCount

    /* Немедленного такта нет: курсы только что получены согласием. */
    await advance(PRICE_REFRESH_INTERVAL_MS / 2)
    expect(services.priceProvider.callCount).toBe(before)

    await advance(PRICE_REFRESH_INTERVAL_MS)
    expect(services.priceProvider.callCount).toBe(before + 1)

    await advance(PRICE_REFRESH_INTERVAL_MS)
    expect(services.priceProvider.callCount).toBe(before + 2)
  })

  it('гаснет тем же выключателем, что и балансы', async () => {
    /* ГЛАВНАЯ ПРОВЕРКА ЭТОГО БЛОКА. Опрос скрытой вкладки сообщал бы
       источнику время присутствия владельца, не показывая ему ничего.
       Выключатель один на всю фоновую работу — иначе два механизма
       разойдутся при первом же изменении. */
    await services.session.open()
    await services.session.enablePrices()

    services.session.setBackgroundRefreshEnabled(false)

    const before = services.priceProvider.callCount

    await advance(5 * PRICE_REFRESH_INTERVAL_MS)

    expect(services.priceProvider.callCount).toBe(before)
  })

  it('разводит такты после отказа', async () => {
    await services.session.open()
    await services.session.enablePrices()

    services.priceProvider.configure({ failure: 'Too Many Requests' })

    const before = services.priceProvider.callCount

    await advance(PRICE_REFRESH_INTERVAL_MS)
    expect(services.priceProvider.callCount).toBe(before + 1)

    /* «429» лечится не повторением с прежним шагом: следующий такт
       вдвое дальше, и обычного промежутка теперь не хватает. */
    await advance(PRICE_REFRESH_INTERVAL_MS)
    expect(services.priceProvider.callCount).toBe(before + 1)

    await advance(PRICE_REFRESH_INTERVAL_MS)
    expect(services.priceProvider.callCount).toBe(before + 2)
  })

  it('прекращается при отзыве согласия', async () => {
    await services.session.open()
    await services.session.enablePrices()
    await services.session.disablePrices()

    const before = services.priceProvider.callCount

    await advance(5 * PRICE_REFRESH_INTERVAL_MS)

    expect(services.priceProvider.callCount).toBe(before)
  })

  it('прекращается после закрытия сессии', async () => {
    /* Таймер, переживший блокировку, продолжал бы выдавать источнику
       присутствие владельца у запертого кошелька. */
    await services.session.open()
    await services.session.enablePrices()
    await services.session.close()

    const before = services.priceProvider.callCount

    await advance(5 * PRICE_REFRESH_INTERVAL_MS)

    expect(services.priceProvider.callCount).toBe(before)
  })
})
