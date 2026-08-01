import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  BUILT_IN_CHAIN_ID,
  TRANSACTION_STATUS,
  TRANSACTION_TYPE,
  TRANSFER_SINGLE_TOPIC,
  TRANSFER_TOPIC,
  addressToTopic,
  toAddress,
  type Address,
  type HexString,
  type ILogEntry,
  type ITransactionRecord,
  type TxHash,
  type Wei,
} from '@/core'
import { TransactionRepository } from '@/core/transaction/TransactionRepository'
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

describe('История: замена зависшей отправки', () => {
  /* Хэш локальной отправки, ожидающей блока. */
  const STUCK = `0x${'55'.repeat(32)}` as TxHash

  /** Кладёт в хранилище собственную отправку, ожидающую подтверждения. */
  async function saveStuckTransfer(overrides: Partial<ITransactionRecord> = {}): Promise<void> {
    await new TransactionRepository(services.secureStorage).save({
      hash: STUCK,
      chainId: BUILT_IN_CHAIN_ID.Ethereum,
      from: OWNER,
      to: PEER,
      value: 10_000_000_000_000_000n as Wei,
      nonce: 0,
      status: TRANSACTION_STATUS.Pending,
      type: TRANSACTION_TYPE.Eip1559,
      submittedAt: 1_700_000_000_000 as ITransactionRecord['submittedAt'],
      confirmedAt: null,
      blockNumber: null,
      gasUsed: null,
      effectiveGasPrice: null,
      replacedBy: null,
      confirmations: 0,
      data: '0x' as HexString,
      gasLimit: 21_000n,
      maxFeePerGas: 30_000_000_000n,
      maxPriorityFeePerGas: 2_000_000_000n,
      gasPrice: null,
      ...overrides,
    })
  }

  it('предлагает ускорение и отмену только у собственных ожидающих отправок', async () => {
    await saveStuckTransfer()

    renderApp()
    await openActivity()

    /* Пять записей: четыре чужих из журналов и одна своя.
       Кнопки появляются ровно у последней: чужую транзакцию заменить
       невозможно — замена подписывается ключом отправителя. */
    expect(await screen.findByRole('button', { name: 'Ускорить' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Ускорить' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Отменить' })).toHaveLength(1)
  })

  it('показывает номер исходной транзакции в подтверждении ускорения', async () => {
    const user = userEvent.setup()

    await saveStuckTransfer({ nonce: 3 })

    renderApp()
    await openActivity()
    await user.click(await screen.findByRole('button', { name: 'Ускорить' }))

    /* Совпадение номера — это и есть механизм замены. Пользователь
       должен видеть, что отправляет замену, а не вторую транзакцию
       вдобавок к застрявшей. */
    await screen.findByRole('heading', { name: 'Ускорение транзакции' })
    expect(screen.getByText('Номер (nonce)').nextElementSibling).toHaveTextContent('3')
  })

  it('отмена уходит на собственный адрес с нулевой суммой', async () => {
    const user = userEvent.setup()

    await saveStuckTransfer()

    renderApp()
    await openActivity()
    await user.click(await screen.findByRole('button', { name: 'Отменить' }))

    await screen.findByRole('heading', { name: 'Отмена транзакции' })
    expect(screen.getByText('Получатель').nextElementSibling).toHaveTextContent(OWNER)
    expect(screen.getByText('Сумма').nextElementSibling).toHaveTextContent('0 ETH')
  })

  it('не обещает, что отмена сработает', async () => {
    const user = userEvent.setup()

    await saveStuckTransfer()

    renderApp()
    await openActivity()
    await user.click(await screen.findByRole('button', { name: 'Отменить' }))

    /* Исходная транзакция может попасть в блок первой. Обещание
       «перевод отменён» там, где отмена лишь вероятна, заставит
       владельца перестать следить за исходом. */
    expect(await screen.findByText('Успех не гарантирован')).toBeInTheDocument()
  })

  it('называет причину, по которой ускорение невозможно', async () => {
    const user = userEvent.setup()

    /* Запись сделана версией без сохранения параметров: повторить ту же
       операцию неоткуда. Отмена при этом остаётся доступной, и сказать
       об этом обязаны. */
    await saveStuckTransfer({ data: null, gasLimit: null })

    renderApp()
    await openActivity()
    await user.click(await screen.findByRole('button', { name: 'Ускорить' }))

    expect(
      await screen.findByText(/параметры исходной транзакции не сохранены/i),
    ).toBeInTheDocument()
  })

  it('возвращает к истории, если заменить не удалось', async () => {
    const user = userEvent.setup()

    await saveStuckTransfer({ data: null, gasLimit: null })

    renderApp()
    await openActivity()
    await user.click(await screen.findByRole('button', { name: 'Ускорить' }))
    await user.click(await screen.findByRole('button', { name: 'Вернуться к истории' }))

    expect(await screen.findByRole('heading', { name: 'История' })).toBeInTheDocument()
  })
})

describe('История: отправка замены', () => {
  const STUCK = `0x${'66'.repeat(32)}` as TxHash

  beforeEach(async () => {
    await new TransactionRepository(services.secureStorage).save({
      hash: STUCK,
      chainId: BUILT_IN_CHAIN_ID.Ethereum,
      from: OWNER,
      to: PEER,
      value: 10_000_000_000_000_000n as Wei,
      nonce: 4,
      status: TRANSACTION_STATUS.Pending,
      type: TRANSACTION_TYPE.Eip1559,
      submittedAt: 1_700_000_000_000 as ITransactionRecord['submittedAt'],
      confirmedAt: null,
      blockNumber: null,
      gasUsed: null,
      effectiveGasPrice: null,
      replacedBy: null,
      confirmations: 0,
      data: '0x' as HexString,
      gasLimit: 21_000n,
      maxFeePerGas: 30_000_000_000n,
      maxPriorityFeePerGas: 2_000_000_000n,
      gasPrice: null,
    })
  })

  it('спрашивает пароль перед подписью замены', async () => {
    const user = userEvent.setup()

    renderApp()
    await openActivity()
    await user.click(await screen.findByRole('button', { name: 'Ускорить' }))
    await user.click(await screen.findByRole('button', { name: 'Отправить ускорение' }))

    /* Замена — такая же транзакция с подписью, и защита от того, кто
       получил доступ к разблокированному кошельку, здесь та же. */
    expect(await screen.findByLabelText('Пароль')).toBeInTheDocument()
    expect(screen.getByText(/Подтвердите паролем/i)).toHaveTextContent('ускорение транзакции')
  })

  it('отправляет замену с номером исходной транзакции', async () => {
    const user = userEvent.setup()

    renderApp()
    await openActivity()
    await user.click(await screen.findByRole('button', { name: 'Ускорить' }))
    await user.click(await screen.findByRole('button', { name: 'Отправить ускорение' }))
    await user.type(await screen.findByLabelText('Пароль'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Подтвердить' }))

    /* После отправки экран возвращается к истории. */
    expect(await screen.findByRole('heading', { name: 'История' })).toBeInTheDocument()

    /* Замена сохранена с номером исходной транзакции. Возьми она
       следующий свободный номер — в сети оказались бы две транзакции
       вместо одной, и вторая списала бы средства повторно. */
    const saved = await new TransactionRepository(services.secureStorage).findByAddress(
      OWNER,
      BUILT_IN_CHAIN_ID.Ethereum,
    )

    expect(saved.filter((record) => record.nonce === 4)).toHaveLength(2)
  })
})
