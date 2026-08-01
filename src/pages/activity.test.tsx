import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  TRANSFER_SINGLE_TOPIC,
  TRANSFER_TOPIC,
  addressToTopic,
  toAddress,
  type Address,
  type HexString,
  type ILogEntry,
  type TxHash,
  type Wei,
} from '@/core'
import { TEST_MNEMONIC, TEST_MNEMONIC_ADDRESSES } from '@/core/hdwallet/vectors'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

const PASSWORD = 'Korova-7-Luna!'

const BALANCE = 1_000_000_000_000_000_000n as Wei

/** Владелец кошелька: первый адрес тестовой seed-фразы. */
const OWNER = toAddress(TEST_MNEMONIC_ADDRESSES[0] as string)

const PEER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')
const USDC = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
const COLLECTION = toAddress('0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D')

/** Номер последнего блока: определяет окно выборки журналов. */
const LATEST_BLOCK = 19_500n

/** 32-байтовое слово из числа — так журнал кодирует любое значение. */
function word(value: bigint): string {
  return value.toString(16).padStart(64, '0')
}

/** Журнальная запись с заданными темами и данными. */
function log(params: {
  address: Address
  topics: readonly string[]
  data?: string
  hash: string
  logIndex?: number
}): ILogEntry {
  return {
    address: params.address,
    topics: params.topics as readonly HexString[],
    data: (params.data ?? '0x') as HexString,
    blockNumber: 19_000n,
    transactionHash: params.hash as TxHash,
    logIndex: params.logIndex ?? 0,
    removed: false,
  }
}

/** Входящий перевод ERC-20: три темы, сумма в данных. */
const INCOMING_TOKEN = log({
  address: USDC,
  topics: [TRANSFER_TOPIC, addressToTopic(PEER), addressToTopic(OWNER)],
  data: `0x${word(1_000_000n)}`,
  hash: `0x${'11'.repeat(32)}`,
})

/** Исходящий перевод ERC-20 тому же контрагенту. */
const OUTGOING_TOKEN = log({
  address: USDC,
  topics: [TRANSFER_TOPIC, addressToTopic(OWNER), addressToTopic(PEER)],
  data: `0x${word(500_000n)}`,
  hash: `0x${'22'.repeat(32)}`,
})

/** Входящий перевод ERC-721: четыре темы, идентификатор предмета в теме. */
const INCOMING_NFT = log({
  address: COLLECTION,
  topics: [TRANSFER_TOPIC, addressToTopic(PEER), addressToTopic(OWNER), `0x${word(777n)}`],
  hash: `0x${'33'.repeat(32)}`,
})

/** Входящий перевод ERC-1155: идентификатор и количество в данных. */
const INCOMING_ERC1155 = log({
  address: COLLECTION,
  topics: [
    TRANSFER_SINGLE_TOPIC,
    addressToTopic(PEER),
    addressToTopic(PEER),
    addressToTopic(OWNER),
  ],
  data: `0x${word(5n)}${word(3n)}`,
  hash: `0x${'44'.repeat(32)}`,
})

const LOGS = [INCOMING_TOKEN, OUTGOING_TOKEN, INCOMING_NFT, INCOMING_ERC1155]

let services: ITestAppServices

function renderApp() {
  return render(
    <AppProviders services={services}>
      <AppRouter />
    </AppProviders>,
  )
}

/** Открывает историю из панели навигации. */
async function openActivity(): Promise<void> {
  const user = userEvent.setup()

  await screen.findByText('Аккаунт 1')
  await user.click(screen.getByRole('link', { name: /вся история/i }))
  await screen.findByRole('heading', { name: 'История' })
}

/** Список записей истории. Заголовки и предупреждения в него не входят. */
function transferList(): HTMLElement {
  return screen.getByRole('list')
}

/** Число показанных записей. */
function visibleCount(): number {
  return within(transferList()).getAllByRole('listitem').length
}

beforeEach(async () => {
  window.location.hash = ''
  services = createTestAppServices()
  services.providerFactory.configure({
    balance: BALANCE,
    logs: LOGS,
    latestBlock: LATEST_BLOCK,
  })

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
})

describe('История: содержимое', () => {
  it('показывает переводы токенов и коллекционных токенов', async () => {
    renderApp()
    await openActivity()

    /* Четыре журнальные записи дают четыре перевода: два ERC-20,
       один ERC-721 и один ERC-1155. */
    expect(visibleCount()).toBe(4)
  })

  it('различает категории в строке записи', async () => {
    renderApp()
    await openActivity()

    const list = within(transferList())

    expect(list.getAllByText('Токен')).toHaveLength(2)
    expect(list.getByText('NFT')).toBeInTheDocument()
    expect(list.getByText('NFT (ERC-1155)')).toBeInTheDocument()
  })

  it('помечает суммы, для которых число знаков контракта неизвестно', async () => {
    renderApp()
    await openActivity()

    /* Журнал не содержит `decimals`. Подстановка привычных восемнадцати
       знаков исказила бы сумму на порядки, поэтому показаны необработанные
       единицы с пометкой. */
    expect(within(transferList()).getAllByText('единицы контракта').length).toBeGreaterThan(0)
  })

  it('предупреждает, что переводы нативной валюты этому источнику недоступны', async () => {
    renderApp()
    await openActivity()

    /* Разбор журналов их не видит физически: такие переводы не порождают
       событий. Умолчать значило бы утверждать, что их не было. */
    expect(screen.getByText(/такие переводы событий не порождают/i)).toBeInTheDocument()
  })

  it('называет глубину просмотра в блоках', async () => {
    renderApp()
    await openActivity()

    expect(screen.getByText(/Просмотрены последние/i)).toBeInTheDocument()
  })
})

describe('История: фильтрация', () => {
  it('отбирает переводы токенов', async () => {
    const user = userEvent.setup()

    renderApp()
    await openActivity()
    await user.click(screen.getByRole('button', { name: 'Токены' }))

    expect(visibleCount()).toBe(2)
  })

  it('под категорию NFT попадают и ERC-721, и ERC-1155', async () => {
    const user = userEvent.setup()

    renderApp()
    await openActivity()
    await user.click(screen.getByRole('button', { name: 'NFT' }))

    const list = within(transferList())

    expect(list.getByText('NFT')).toBeInTheDocument()
    expect(list.getByText('NFT (ERC-1155)')).toBeInTheDocument()
    expect(visibleCount()).toBe(2)
  })

  it('отбирает по направлению перевода', async () => {
    const user = userEvent.setup()

    renderApp()
    await openActivity()
    await user.click(screen.getByRole('button', { name: 'Исходящие' }))

    expect(visibleCount()).toBe(1)
  })

  it('сообщает, сколько записей показано из скольких', async () => {
    const user = userEvent.setup()

    renderApp()
    await openActivity()
    await user.click(screen.getByRole('button', { name: 'Исходящие' }))

    expect(screen.getByText('Показано 1 из 4')).toBeInTheDocument()
  })

  it('пустой результат отбора не выдаётся за пустую историю', async () => {
    const user = userEvent.setup()

    renderApp()
    await openActivity()
    await user.click(screen.getByRole('button', { name: 'ETH' }))

    /* «Операций не было» и «под условия ничего не подошло» — разные
       утверждения, и первое, показанное вместо второго, читается
       владельцем средств как пропажа. */
    expect(screen.getByText('Под условия ничего не подошло')).toBeInTheDocument()
    expect(screen.queryByText('Операций пока нет')).not.toBeInTheDocument()
  })

  it('объясняет, что источник не видит нативных переводов, при отборе по ним', async () => {
    const user = userEvent.setup()

    renderApp()
    await openActivity()
    await user.click(screen.getByRole('button', { name: 'ETH' }))

    /* Пустой список под этим отбором не говорит ничего о том, были такие
       операции или нет: источник их не видит в принципе. */
    expect(screen.getByText(/недоступны\s+в принципе/i)).toBeInTheDocument()
  })

  it('возвращает полный список после снятия условий', async () => {
    const user = userEvent.setup()

    renderApp()
    await openActivity()
    await user.click(screen.getByRole('button', { name: 'Токены' }))

    expect(visibleCount()).toBe(2)

    /* Кнопка «Все» есть и у направления, но её доступное имя —
       «Все направления»: два одинаковых имени неразличимы для того,
       кто слушает страницу, а не смотрит на неё. */
    await user.click(screen.getByRole('button', { name: 'Все' }))

    expect(visibleCount()).toBe(4)
  })
})

describe('История: поиск', () => {
  it('находит записи по адресу контракта', async () => {
    const user = userEvent.setup()

    renderApp()
    await openActivity()
    await user.type(screen.getByLabelText('Поиск по истории'), COLLECTION)

    expect(visibleCount()).toBe(2)
  })

  it('находит запись по хэшу транзакции', async () => {
    const user = userEvent.setup()

    renderApp()
    await openActivity()
    await user.type(screen.getByLabelText('Поиск по истории'), INCOMING_NFT.transactionHash)

    expect(visibleCount()).toBe(1)
  })

  it('находит по последним символам адреса', async () => {
    const user = userEvent.setup()

    renderApp()
    await openActivity()

    /* Именно они видны в усечённой записи адреса в списке: поиск
       по началу строки такой запрос не нашёл бы. */
    await user.type(screen.getByLabelText('Поиск по истории'), USDC.slice(-6))

    expect(visibleCount()).toBe(2)
  })

  it('не учитывает регистр адреса', async () => {
    const user = userEvent.setup()

    renderApp()
    await openActivity()
    await user.type(screen.getByLabelText('Поиск по истории'), USDC.toLowerCase())

    expect(visibleCount()).toBe(2)
  })

  it('очищает запрос кнопкой', async () => {
    const user = userEvent.setup()

    renderApp()
    await openActivity()
    await user.type(screen.getByLabelText('Поиск по истории'), COLLECTION)

    expect(visibleCount()).toBe(2)

    await user.click(screen.getByRole('button', { name: 'Очистить поиск' }))

    expect(visibleCount()).toBe(4)
  })

  it('запрос не попадает в адресную строку', async () => {
    const user = userEvent.setup()

    renderApp()
    await openActivity()
    await user.type(screen.getByLabelText('Поиск по истории'), PEER)

    /* Запрос содержит адрес контрагента. Адресная строка сохраняется
       в истории браузера и доступна расширениям. */
    expect(window.location.href).not.toContain(PEER.slice(2, 10))
  })
})

describe('История: отказ источника', () => {
  it('не выдаёт отказ узла за пустую историю', async () => {
    services.providerFactory.configure({ balance: BALANCE, unavailable: true })

    renderApp()
    await openActivity()

    expect(await screen.findByText(/Историю получить не удалось/i)).toBeInTheDocument()
  })
})
