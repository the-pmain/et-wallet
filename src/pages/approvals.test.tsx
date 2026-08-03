import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  APPROVAL_FOR_ALL_TOPIC,
  APPROVAL_TOPIC,
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

const EXCHANGE = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')
const USDC = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
const PUNKS = toAddress('0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D')

const LATEST_BLOCK = 19_500n

/** Наибольшее значение uint256: так выглядит неограниченное разрешение. */
const UNLIMITED = (1n << 256n) - 1n

function word(value: bigint): string {
  return value.toString(16).padStart(64, '0')
}

/** Событие выдачи разрешения на токен. */
function approval(contract: Address, spender: Address, amount: bigint): ILogEntry {
  return {
    address: contract,
    topics: [APPROVAL_TOPIC, addressToTopic(OWNER), addressToTopic(spender)],
    data: `0x${word(amount)}` as HexString,
    blockNumber: 19_000n,
    transactionHash: `0x${'aa'.repeat(32)}` as TxHash,
    logIndex: 0,
    removed: false,
  }
}

/** Событие разрешения на всю коллекцию. */
function approvalForAll(contract: Address, operator: Address): ILogEntry {
  return {
    address: contract,
    topics: [APPROVAL_FOR_ALL_TOPIC, addressToTopic(OWNER), addressToTopic(operator)],
    data: `0x${word(1n)}` as HexString,
    blockNumber: 19_000n,
    transactionHash: `0x${'bb'.repeat(32)}` as TxHash,
    logIndex: 0,
    removed: false,
  }
}

let services: ITestAppServices

function renderApp() {
  return render(
    <AppProviders services={services}>
      <AppRouter />
    </AppProviders>,
  )
}

/** Открывает раздел разрешений через настройки. */
async function openApprovals(): Promise<void> {
  const user = userEvent.setup()

  await screen.findByText('Account 1')
  await user.click(screen.getByRole('link', { name: 'Settings' }))
  await user.click(await screen.findByRole('link', { name: /Granted approvals/i }))
  await screen.findByRole('heading', { level: 1, name: 'Approvals' })
}

beforeEach(async () => {
  window.location.hash = ''
  services = createTestAppServices()

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
})

describe('Разрешения: список', () => {
  it('показывает действующее разрешение с получателем', async () => {
    services.providerFactory.configure({
      balance: BALANCE,
      latestBlock: LATEST_BLOCK,
      logs: [approval(USDC, EXCHANGE, 1_000_000n)],
      allowances: [{ contract: USDC, spender: EXCHANGE, amount: 1_000_000n }],
      tokens: [{ address: USDC, symbol: 'USDC', name: 'USD Coin', decimals: 6, balance: 0n }],
    })

    renderApp()
    await openApprovals()

    const list = within(await screen.findByRole('list'))

    expect(list.getByText('USDC')).toBeInTheDocument()
    expect(list.getByText(new RegExp(EXCHANGE.slice(0, 6), 'u'))).toBeInTheDocument()
  })

  it('отозванное разрешение не показывается', async () => {
    /* Журнал хранит выдачу навсегда. Показать её как действующую значило
       бы пугать владельца тем, чего нет, и обесценить настоящие
       находки. */
    services.providerFactory.configure({
      balance: BALANCE,
      latestBlock: LATEST_BLOCK,
      logs: [approval(USDC, EXCHANGE, 1_000_000n)],
    })

    renderApp()
    await openApprovals()

    expect(await screen.findByText('No active approvals found')).toBeInTheDocument()
  })

  it('неограниченное разрешение выделено как опасность', async () => {
    /* Разница между «разрешено 50 USDC» и «разрешено всё» — это разница
       между потерей пятидесяти долларов и потерей баланса. */
    services.providerFactory.configure({
      balance: BALANCE,
      latestBlock: LATEST_BLOCK,
      logs: [approval(USDC, EXCHANGE, UNLIMITED)],
      allowances: [{ contract: USDC, spender: EXCHANGE, amount: UNLIMITED }],
    })

    renderApp()
    await openApprovals()

    expect(await screen.findByText('Unlimited amount')).toBeInTheDocument()
  })

  it('ограниченное разрешение показывает сумму в единицах токена', async () => {
    services.providerFactory.configure({
      balance: BALANCE,
      latestBlock: LATEST_BLOCK,
      logs: [approval(USDC, EXCHANGE, 50_000_000n)],
      allowances: [{ contract: USDC, spender: EXCHANGE, amount: 50_000_000n }],
      tokens: [{ address: USDC, symbol: 'USDC', name: 'USD Coin', decimals: 6, balance: 0n }],
    })

    renderApp()
    await openApprovals()

    /* Пятьдесят миллионов единиц при шести знаках — это 50 USDC. */
    expect(await screen.findByText(/50 USDC/u)).toBeInTheDocument()
  })

  it('разрешение на коллекцию объясняется словами', async () => {
    services.providerFactory.configure({
      balance: BALANCE,
      latestBlock: LATEST_BLOCK,
      logs: [approvalForAll(PUNKS, EXCHANGE)],
      operatorApprovals: [{ contract: PUNKS, operator: EXCHANGE }],
    })

    renderApp()
    await openApprovals()

    expect(
      await screen.findByText(/The whole collection, including future items/i),
    ).toBeInTheDocument()
  })

  it('объясняет, что разрешение не истекает само', async () => {
    services.providerFactory.configure({ balance: BALANCE, latestBlock: LATEST_BLOCK })

    renderApp()
    await openApprovals()

    expect(await screen.findByText(/does not\s+expire/iu)).toBeInTheDocument()
  })

  it('отказ узла не выдаётся за отсутствие разрешений', async () => {
    services.providerFactory.configure({
      balance: BALANCE,
      latestBlock: LATEST_BLOCK,
      logsError: 'the range is too wide',
    })

    renderApp()
    await openApprovals()

    expect(await screen.findByText(/The approvals could not be checked/i)).toBeInTheDocument()
  })
})

describe('Разрешения: отзыв', () => {
  beforeEach(() => {
    services.providerFactory.configure({
      balance: BALANCE,
      latestBlock: LATEST_BLOCK,
      logs: [approval(USDC, EXCHANGE, UNLIMITED)],
      allowances: [{ contract: USDC, spender: EXCHANGE, amount: UNLIMITED }],
      tokens: [{ address: USDC, symbol: 'USDC', name: 'USD Coin', decimals: 6, balance: 0n }],
    })
  })

  it('подтверждение называет контракт и получателя разрешения', async () => {
    const user = userEvent.setup()

    renderApp()
    await openApprovals()
    await user.click(await screen.findByRole('button', { name: 'Revoke' }))

    await screen.findByRole('heading', { level: 1, name: 'Revoke the approval' })

    expect(screen.getByText(USDC)).toBeInTheDocument()
    expect(screen.getByText(EXCHANGE)).toBeInTheDocument()
  })

  it('оговаривает, что прошлые операции отзыв не отменяет', async () => {
    const user = userEvent.setup()

    renderApp()
    await openApprovals()
    await user.click(await screen.findByRole('button', { name: 'Revoke' }))

    expect(
      await screen.findByText(/Operations it has already carried out are not undone/i),
    ).toBeInTheDocument()
  })

  it('отзыв требует пароля и отправляет транзакцию контракту', async () => {
    const user = userEvent.setup()

    renderApp()
    await openApprovals()
    await user.click(await screen.findByRole('button', { name: 'Revoke' }))
    await user.click(await screen.findByRole('button', { name: 'Revoke the approval' }))
    await user.type(await screen.findByLabelText('Password'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText(/The revocation has been sent/i)).toBeInTheDocument()
  })
})
