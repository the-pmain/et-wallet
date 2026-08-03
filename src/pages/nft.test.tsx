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
const PUNKS = toAddress('0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D')
const EDITIONS = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

const LATEST_BLOCK = 19_500n

/** 32-байтовое слово из числа. */
function word(value: bigint): string {
  return value.toString(16).padStart(64, '0')
}

/** Поступление предмета ERC-721 владельцу: четыре темы, номер в теме. */
function incoming721(contract: Address, tokenId: bigint): ILogEntry {
  return {
    address: contract,
    topics: [
      TRANSFER_TOPIC,
      addressToTopic(PEER),
      addressToTopic(OWNER),
      `0x${word(tokenId)}` as HexString,
    ],
    data: '0x' as HexString,
    blockNumber: 19_000n,
    transactionHash: `0x${'aa'.repeat(32)}` as TxHash,
    logIndex: 0,
    removed: false,
  }
}

/** Поступление ERC-1155 владельцу: номер и количество в данных. */
function incoming1155(contract: Address, tokenId: bigint, amount: bigint): ILogEntry {
  return {
    address: contract,
    topics: [
      TRANSFER_SINGLE_TOPIC,
      addressToTopic(PEER),
      addressToTopic(PEER),
      addressToTopic(OWNER),
    ],
    data: `0x${word(tokenId)}${word(amount)}` as HexString,
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

/** Открывает раздел коллекционных токенов. */
async function openNft(): Promise<void> {
  const user = userEvent.setup()

  await screen.findByText('Account 1')
  await user.click(screen.getByRole('link', { name: /nft/i }))
  await screen.findByRole('heading', { level: 1, name: 'NFT' })
}

beforeEach(async () => {
  window.location.hash = ''
  services = createTestAppServices()

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
})

describe('NFT: список принадлежащих предметов', () => {
  it('показывает предмет, оставшийся у владельца', async () => {
    services.providerFactory.configure({
      balance: BALANCE,
      latestBlock: LATEST_BLOCK,
      logs: [incoming721(PUNKS, 777n)],
      nftOwners: [{ contract: PUNKS, tokenId: 777n, owner: OWNER }],
      collections: [{ address: PUNKS, name: 'CryptoPunks' }],
    })

    renderApp()
    await openNft()

    expect(await screen.findByText('CryptoPunks')).toBeInTheDocument()
    expect(screen.getByText(/#777/u)).toBeInTheDocument()
  })

  it('не показывает предмет, отданный после получения', async () => {
    /* Журнал показывает историю, а не текущее состояние. Предмет,
       полученный вчера и отданный сегодня, остаётся в нём навсегда. */
    services.providerFactory.configure({
      balance: BALANCE,
      latestBlock: LATEST_BLOCK,
      logs: [incoming721(PUNKS, 777n)],
      nftOwners: [{ contract: PUNKS, tokenId: 777n, owner: PEER }],
    })

    renderApp()
    await openNft()

    expect(await screen.findByText('No items found')).toBeInTheDocument()
  })

  it('показывает количество экземпляров ERC-1155', async () => {
    services.providerFactory.configure({
      balance: BALANCE,
      latestBlock: LATEST_BLOCK,
      logs: [incoming1155(EDITIONS, 5n, 3n)],
      nftBalances: [{ contract: EDITIONS, tokenId: 5n, balance: 2n }],
    })

    renderApp()
    await openNft()

    /* Количество берётся из остатка на момент запроса, а не из события:
       часть тиража могла уйти дальше. */
    expect(await screen.findByText('×2')).toBeInTheDocument()
  })

  it('показывает адрес контракта рядом с названием', async () => {
    /* Название коллекции задаёт автор контракта, и назвать свою
       коллекцию именем известной может кто угодно. */
    services.providerFactory.configure({
      balance: BALANCE,
      latestBlock: LATEST_BLOCK,
      logs: [incoming721(PUNKS, 1n)],
      nftOwners: [{ contract: PUNKS, tokenId: 1n, owner: OWNER }],
      collections: [{ address: PUNKS, name: 'CryptoPunks' }],
    })

    renderApp()
    await openNft()

    const row = within(await screen.findByRole('list'))

    expect(row.getByText(new RegExp(PUNKS.slice(0, 6), 'u'))).toBeInTheDocument()
  })

  it('коллекция без названия не получает выдуманного', async () => {
    services.providerFactory.configure({
      balance: BALANCE,
      latestBlock: LATEST_BLOCK,
      logs: [incoming721(PUNKS, 1n)],
      nftOwners: [{ contract: PUNKS, tokenId: 1n, owner: OWNER }],
    })

    renderApp()
    await openNft()

    expect(await screen.findByText('Collection without a name')).toBeInTheDocument()
  })
})

describe('NFT: границы поиска', () => {
  it('называет глубину просмотра в пустом состоянии', async () => {
    /* Пустой список без объяснения читается владельцем как пропажа
       имущества. */
    services.providerFactory.configure({ balance: BALANCE, latestBlock: LATEST_BLOCK })

    renderApp()
    await openNft()

    expect(await screen.findByText(/scans the last/i)).toBeInTheDocument()
  })

  it('отказ узла не выдаётся за отсутствие коллекции', async () => {
    services.providerFactory.configure({
      balance: BALANCE,
      latestBlock: LATEST_BLOCK,
      logsError: 'the range is too wide',
    })

    renderApp()
    await openNft()

    expect(await screen.findByText(/The items could not be found/i)).toBeInTheDocument()
    expect(screen.getByText(/the range is too wide/i)).toBeInTheDocument()
  })

  it('предупреждает, что изображения не загружаются', async () => {
    services.providerFactory.configure({ balance: BALANCE, latestBlock: LATEST_BLOCK })

    renderApp()
    await openNft()

    expect(await screen.findByText(/Images are deliberately not loaded/i)).toBeInTheDocument()
  })
})

describe('NFT: передача предмета', () => {
  beforeEach(() => {
    services.providerFactory.configure({
      balance: BALANCE,
      latestBlock: LATEST_BLOCK,
      logs: [incoming721(PUNKS, 777n)],
      nftOwners: [{ contract: PUNKS, tokenId: 777n, owner: OWNER }],
      collections: [{ address: PUNKS, name: 'CryptoPunks' }],
    })
  })

  /** Открывает форму передачи найденного предмета. */
  async function openTransfer(): Promise<void> {
    const user = userEvent.setup()

    await openNft()
    await user.click(await screen.findByRole('button', { name: 'Transfer' }))
    await screen.findByRole('heading', { level: 1, name: 'Transfer an item' })
  }

  it('форма называет предмет и коллекцию', async () => {
    renderApp()
    await openTransfer()

    expect(screen.getByText(/CryptoPunks · #777/u)).toBeInTheDocument()
  })

  it('подтверждение показывает получателя и контракт коллекции', async () => {
    const user = userEvent.setup()

    renderApp()
    await openTransfer()
    await user.type(screen.getByLabelText(/Recipient address/), PEER)
    await user.click(screen.getByRole('button', { name: 'Next' }))

    /* Человек, сверяющий адреса, обязан понимать, почему их два:
       передачу выполняет контракт коллекции. */
    expect(await screen.findByText('Confirm the transfer')).toBeInTheDocument()
    expect(screen.getByText(PEER)).toBeInTheDocument()
    expect(screen.getByText(PUNKS)).toBeInTheDocument()
  })

  it('предупреждает о необратимости', async () => {
    const user = userEvent.setup()

    renderApp()
    await openTransfer()
    await user.type(screen.getByLabelText(/Recipient address/), PEER)
    await user.click(screen.getByRole('button', { name: 'Next' }))

    /* Предмет существует в одном экземпляре: отправленный не туда,
       он не возвращается и не покупается заново. */
    expect(await screen.findByText('The transfer cannot be undone')).toBeInTheDocument()
  })

  it('отправка требует пароля и сообщает об успехе', async () => {
    const user = userEvent.setup()

    renderApp()
    await openTransfer()
    await user.type(screen.getByLabelText(/Recipient address/), PEER)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(await screen.findByRole('button', { name: 'Transfer the item' }))
    await user.type(await screen.findByLabelText('Password'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText(/The transfer has been sent/i)).toBeInTheDocument()
  })

  it('не даёт передать предмет, принадлежащий другому адресу', async () => {
    /* Список мог устареть: предмет отдали с другого устройства.
       Контракт отверг бы вызов и сам, но газ при этом списался бы. */
    const user = userEvent.setup()

    renderApp()
    await openTransfer()

    services.providerFactory.configure({
      balance: BALANCE,
      latestBlock: LATEST_BLOCK,
      logs: [incoming721(PUNKS, 777n)],
      nftOwners: [{ contract: PUNKS, tokenId: 777n, owner: PEER }],
    })

    await user.type(screen.getByLabelText(/Recipient address/), PEER)
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText(/belongs to a different address/i)).toBeInTheDocument()
  })
})

describe('NFT: передача в собственную коллекцию', () => {
  beforeEach(() => {
    services.providerFactory.configure({
      balance: BALANCE,
      latestBlock: LATEST_BLOCK,
      logs: [incoming721(PUNKS, 777n)],
      nftOwners: [{ contract: PUNKS, tokenId: 777n, owner: OWNER }],
      collections: [{ address: PUNKS, name: 'CryptoPunks' }],
    })
  })

  it('отвергается до подтверждения', async () => {
    /* Предмет существует в одном экземпляре, а адрес контракта стоит
       рядом — и в обозревателе, и в самой карточке. В отличие
       от прочих замечаний это не повод задуматься, а отказ: законного
       применения у такой операции нет. */
    const user = userEvent.setup()

    renderApp()
    await openNft()
    await user.click(await screen.findByRole('button', { name: 'Transfer' }))
    await screen.findByRole('heading', { level: 1, name: 'Transfer an item' })

    await user.type(screen.getByLabelText(/Recipient address/), PUNKS)
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(
      await screen.findByText(/recipient is the collection contract itself/i),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Confirm the transfer' })).not.toBeInTheDocument()
  })

  it('обычный получатель проходит дальше', async () => {
    const user = userEvent.setup()

    renderApp()
    await openNft()
    await user.click(await screen.findByRole('button', { name: 'Transfer' }))
    await screen.findByRole('heading', { level: 1, name: 'Transfer an item' })

    await user.type(screen.getByLabelText(/Recipient address/), PEER)
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('Confirm the transfer')).toBeInTheDocument()
  })
})
