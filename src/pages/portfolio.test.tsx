import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { priceRefKey, toAddress, toChainId, type IPriceQuote, type Wei } from '@/core'
import { TEST_MNEMONIC } from '@/core/hdwallet/vectors'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

const PASSWORD = 'Korova-7-Luna!'

/** Два эфира. */
const BALANCE = 2_000_000_000_000_000_000n as Wei

const ETHEREUM = toChainId(1n)

const USDC = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

/** Котировка эфира: цена и суточный рост. */
const ETH_QUOTE: IPriceQuote = {
  price: 2000,
  change24hPercent: 10,
  updatedAt: 1_700_000_000_000 as IPriceQuote['updatedAt'],
}

const USDC_QUOTE: IPriceQuote = {
  price: 1,
  change24hPercent: 0,
  updatedAt: 1_700_000_000_000 as IPriceQuote['updatedAt'],
}

let services: ITestAppServices

function renderApp() {
  return render(
    <AppProviders services={services}>
      <AppRouter />
    </AppProviders>,
  )
}

/** Открывает портфель с главного экрана. */
async function openPortfolio(): Promise<void> {
  const user = userEvent.setup()

  await screen.findByText('Account 1')
  await user.click(screen.getByRole('link', { name: /portfolio/i }))
  await screen.findByRole('heading', { name: 'Portfolio', level: 1 })
}

/** Даёт согласие на обращение к источнику курсов. */
async function enablePrices(): Promise<void> {
  const user = userEvent.setup()

  await user.click(screen.getByRole('button', { name: /Show the value/i }))
  await screen.findByText('Allocation')
}

/** Котировки только по нативной валюте. */
function nativeOnly(): ReadonlyMap<string, IPriceQuote> {
  return new Map([[priceRefKey({ chainId: ETHEREUM, address: null }), ETH_QUOTE]])
}

beforeEach(async () => {
  window.location.hash = ''
  services = createTestAppServices()
  services.providerFactory.configure({ balance: BALANCE })
  services.priceProvider.configure({ quotes: nativeOnly() })

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
})

describe('Портфель: согласие на источник курсов', () => {
  it('без согласия стоимость не показывается', async () => {
    renderApp()
    await openPortfolio()

    expect(screen.getByText('Portfolio value is turned off')).toBeInTheDocument()
  })

  it('без согласия источник курсов не опрашивается ни разу', async () => {
    /* Запрос курса называет сервису адрес контракта, то есть сообщает
       состав портфеля. До согласия такого запроса быть не может. */
    renderApp()
    await openPortfolio()

    expect(services.priceProvider.callCount).toBe(0)
  })

  it('перечисляет, что именно узнает сервис', async () => {
    /* Согласие, данное на общее «улучшение работы», согласием
       не является: человек не может решить о том, чего ему не назвали. */
    renderApp()
    await openPortfolio()

    expect(screen.getByText(/the composition of the portfolio/i)).toBeInTheDocument()
    expect(screen.getByText(/IP address/i)).toBeInTheDocument()
  })

  it('называет, что адрес кошелька не передаётся', async () => {
    renderApp()
    await openPortfolio()

    expect(screen.getByText(/your wallet address — it is never sent/i)).toBeInTheDocument()
  })

  it('после согласия появляется стоимость', async () => {
    renderApp()
    await openPortfolio()
    await enablePrices()

    /* Два эфира по 2000 — четыре тысячи. Величина встречается трижды:
       общая стоимость, доля в распределении и строка актива. */
    expect(screen.getAllByText(/\$4,000\.00/u).length).toBeGreaterThan(0)
  })

  it('согласие переживает перезапуск сессии', async () => {
    renderApp()
    await openPortfolio()
    await enablePrices()

    await services.session.close()
    await services.session.open()

    await waitFor(() => {
      expect(services.session.getSnapshot().arePricesEnabled).toBe(true)
    })
  })
})

describe('Портфель: стоимость и изменение', () => {
  beforeEach(async () => {
    renderApp()
    await openPortfolio()
    await enablePrices()
  })

  it('показывает суточное изменение в процентах', () => {
    /* Показывается и по портфелю целиком, и в строке актива. */
    expect(screen.getAllByText('+10.00 %').length).toBeGreaterThan(0)
  })

  it('оговаривает, что изменение посчитано по курсам, а не по составу', () => {
    /* Покупка актива увеличивает стоимость портфеля, но это не рост
       курса, и приписывать его пользователю как доход нельзя. */
    expect(screen.getByText(/with an unchanged composition/i)).toBeInTheDocument()
  })

  it('показывает вчерашнюю оценку', () => {
    /* Четыре тысячи при росте на 10 % означают вчерашние 3636,36. */
    expect(screen.getByText(/\$3,636\.36/u)).toBeInTheDocument()
  })
})

describe('Портфель: распределение', () => {
  it('рисует диаграмму с текстовым описанием', async () => {
    renderApp()
    await openPortfolio()
    await enablePrices()

    /* Диаграмма без текстового описания недоступна тому, кто слушает
       страницу, а не смотрит на неё. */
    expect(screen.getByRole('img', { name: /ETH 100/u })).toBeInTheDocument()
  })

  it('дублирует диаграмму списком с числами', async () => {
    /* Разница между 18 % и 22 % на кольце неразличима, а цвет как
       единственный признак недоступен людям с нарушением
       цветовосприятия. */
    renderApp()
    await openPortfolio()
    await enablePrices()

    const allocation = screen.getByText('Allocation').closest('[data-slot=card]') as HTMLElement

    expect(within(allocation).getByText('100.0 %')).toBeInTheDocument()
  })
})

describe('Портфель: неизвестное не подменяется нулём', () => {
  beforeEach(() => {
    /* Токен добавлен, но его курс источнику неизвестен. */
    services.priceProvider.configure({ quotes: nativeOnly() })
  })

  it('позиция без курса не входит в стоимость, но остаётся в списке', async () => {
    renderApp()
    await openPortfolio()
    await enablePrices()

    /* Нативная валюта одна, стоимость только по ней. */
    expect(screen.getAllByText(/\$4,000\.00/u).length).toBeGreaterThan(0)
  })

  it('сообщает о позициях, не вошедших в оценку', async () => {
    services.priceProvider.configure({ quotes: new Map() })

    renderApp()
    await openPortfolio()

    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /Show the value/i }))

    await waitFor(() => {
      expect(screen.getByText(/without a known price/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/does not mean they are worthless/i)).toBeInTheDocument()
  })

  it('не обвиняет источник, когда портфель просто ничего не стоил', async () => {
    /* Курс известен, но вчерашняя стоимость нулевая, и процент
       не определён. Текст «источник не сообщил изменение» приписал бы
       сервису то, чего он не делал. */
    services.providerFactory.configure({ balance: 0n as Wei })
    services.priceProvider.configure({ quotes: nativeOnly() })

    renderApp()
    await openPortfolio()

    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /Show the value/i }))

    await waitFor(() => {
      expect(screen.getByText(/was worth nothing/i)).toBeInTheDocument()
    })
    expect(screen.queryByText(/the source reported none/i)).not.toBeInTheDocument()
  })

  it('без единого курса показывает прочерк, а не нулевую стоимость', async () => {
    /* «$0.00» здесь сообщил бы владельцу, что его активы ничего
       не стоят, тогда как кошелёк не получил ни одного курса. */
    services.priceProvider.configure({ quotes: new Map() })

    renderApp()
    await openPortfolio()

    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /Show the value/i }))

    await waitFor(() => {
      expect(screen.getByText(/the value was not calculated/i)).toBeInTheDocument()
    })
    expect(screen.queryByText(/^\$0\.00$/u)).not.toBeInTheDocument()
  })
})

describe('Портфель: отказ источника', () => {
  it('не выдаёт отказ за нулевую стоимость', async () => {
    services.priceProvider.configure({ failure: 'Слишком много запросов' })

    renderApp()
    await openPortfolio()

    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /Show the value/i }))

    await waitFor(() => {
      expect(screen.getByText('Prices could not be fetched')).toBeInTheDocument()
    })
    expect(screen.getByText(/does not mean the rest are\s+worthless/i)).toBeInTheDocument()
  })
})

describe('Портфель: статистика', () => {
  it('оговаривает, что оценка не участвует в формировании транзакции', async () => {
    renderApp()
    await openPortfolio()
    await enablePrices()

    expect(screen.getByText(/counted\s+in the minimal units of the network/i)).toBeInTheDocument()
  })

  it('называет источник курсов', async () => {
    /* Пользователь вправе знать, кому уходят его запросы. */
    renderApp()
    await openPortfolio()
    await enablePrices()

    expect(screen.getByText(/Дублёр курсов/u)).toBeInTheDocument()
  })
})

describe('Портфель: вход с главного экрана', () => {
  it('ссылка ведёт на портфель', async () => {
    /* Портфель не попал в нижнюю панель: пять пунктов — предел
       для окна шириной 360 пикселей. */
    renderApp()
    await screen.findByText('Account 1')

    expect(screen.getByRole('link', { name: /portfolio/i })).toHaveAttribute(
      'href',
      '#/wallet/portfolio',
    )
  })

  it('USDC не оказывается в оценке, если его курс неизвестен', async () => {
    services.priceProvider.configure({
      quotes: new Map([
        [priceRefKey({ chainId: ETHEREUM, address: null }), ETH_QUOTE],
        [priceRefKey({ chainId: ETHEREUM, address: USDC }), USDC_QUOTE],
      ]),
    })

    renderApp()
    await openPortfolio()
    await enablePrices()

    /* USDC в кошелёк не добавлен: котировка есть, а позиции нет —
       и в списке её быть не должно. */
    expect(screen.queryByText('USDC')).not.toBeInTheDocument()
  })
})
