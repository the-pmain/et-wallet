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
import { openPath } from '@/test/open-path'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

const PASSWORD = 'Korova-7-Luna!'

const BALANCE = 1_000_000_000_000_000_000n as Wei

/** Wallet owner: first address of the test seed phrase. */
const OWNER = toAddress(TEST_MNEMONIC_ADDRESSES[0] as string)

const PEER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')
const PUNKS = toAddress('0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D')
const EDITIONS = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

const LATEST_BLOCK = 19_500n

/** A 32-byte word from a number. */
function word(value: bigint): string {
  return value.toString(16).padStart(64, '0')
}

/** ERC-721 inflow to the owner: four topics, the id in a topic. */
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

/** ERC-1155 inflow to the owner: id and quantity in the data. */
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

async function openNft(): Promise<void> {
  await screen.findByText('Account 1')
  openPath('/wallet/nft')
  await screen.findByRole('heading', { level: 1, name: 'NFT' })
}

beforeEach(async () => {
  window.location.hash = ''
  services = createTestAppServices()

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
})

describe('NFT: list of owned items', () => {
  it('shows an item that is still owned', async () => {
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

  it('does not show an item given away after it was received', async () => {
    /* The log shows history, not current state. An item received
       yesterday and given away today stays in it forever. */
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

  it('shows the ERC-1155 instance count', async () => {
    services.providerFactory.configure({
      balance: BALANCE,
      latestBlock: LATEST_BLOCK,
      logs: [incoming1155(EDITIONS, 5n, 3n)],
      nftBalances: [{ contract: EDITIONS, tokenId: 5n, balance: 2n }],
    })

    renderApp()
    await openNft()

    /* The count comes from the balance at query time, not from the
       event: part of the supply may have moved on. */
    expect(await screen.findByText('×2')).toBeInTheDocument()
  })

  it('shows the contract address next to the name', async () => {
    /* The collection name is set by the contract author, and anyone
       can name their collection after a famous one. */
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

  it('a collection without a name does not get an invented one', async () => {
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

describe('NFT: search bounds', () => {
  it('names the scan depth in the empty state', async () => {
    /* An empty list with no explanation reads as missing property. */
    services.providerFactory.configure({ balance: BALANCE, latestBlock: LATEST_BLOCK })

    renderApp()
    await openNft()

    expect(await screen.findByText(/scans the last/i)).toBeInTheDocument()
  })

  it('a node failure is not shown as an empty collection', async () => {
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

  it('warns that images are not loaded', async () => {
    services.providerFactory.configure({ balance: BALANCE, latestBlock: LATEST_BLOCK })

    renderApp()
    await openNft()

    expect(await screen.findByText(/Images are deliberately not loaded/i)).toBeInTheDocument()
  })
})

describe('NFT: item transfer', () => {
  beforeEach(() => {
    services.providerFactory.configure({
      balance: BALANCE,
      latestBlock: LATEST_BLOCK,
      logs: [incoming721(PUNKS, 777n)],
      nftOwners: [{ contract: PUNKS, tokenId: 777n, owner: OWNER }],
      collections: [{ address: PUNKS, name: 'CryptoPunks' }],
    })
  })

  async function openTransfer(): Promise<void> {
    const user = userEvent.setup()

    await openNft()
    await user.click(await screen.findByRole('button', { name: 'Transfer' }))
    await screen.findByRole('heading', { level: 1, name: 'Transfer an item' })
  }

  it('the form names the item and the collection', async () => {
    renderApp()
    await openTransfer()

    expect(screen.getByText(/CryptoPunks · #777/u)).toBeInTheDocument()
  })

  it('confirmation shows the recipient and the collection contract', async () => {
    const user = userEvent.setup()

    renderApp()
    await openTransfer()
    await user.type(screen.getByLabelText(/Recipient address/), PEER)
    await user.click(screen.getByRole('button', { name: 'Next' }))

    /* Someone comparing addresses must understand why there are two:
       the collection contract performs the transfer. */
    expect(await screen.findByText('Confirm the transfer')).toBeInTheDocument()
    expect(screen.getByText(PEER)).toBeInTheDocument()
    expect(screen.getByText(PUNKS)).toBeInTheDocument()
  })

  it('warns that the transfer is irreversible', async () => {
    const user = userEvent.setup()

    renderApp()
    await openTransfer()
    await user.type(screen.getByLabelText(/Recipient address/), PEER)
    await user.click(screen.getByRole('button', { name: 'Next' }))

    /* The item exists in one copy: sent to the wrong place, it does
       not come back and cannot be bought again. */
    expect(await screen.findByText('The transfer cannot be undone')).toBeInTheDocument()
  })

  it('sending asks for the password and reports success', async () => {
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

  it('does not let an item owned by another address be transferred', async () => {
    /* The list may be stale: the item was given away from another
       device. The contract would reject the call itself, but gas
       would still be spent. */
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

describe('NFT: transfer into its own collection', () => {
  beforeEach(() => {
    services.providerFactory.configure({
      balance: BALANCE,
      latestBlock: LATEST_BLOCK,
      logs: [incoming721(PUNKS, 777n)],
      nftOwners: [{ contract: PUNKS, tokenId: 777n, owner: OWNER }],
      collections: [{ address: PUNKS, name: 'CryptoPunks' }],
    })
  })

  it('is rejected before confirmation', async () => {
    /* The item exists in one copy, and the contract address sits
       next to it — in the explorer and on the card itself. Unlike
       other remarks this is not a prompt to think, it is a refusal:
       the operation has no legitimate use. */
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

  it('an ordinary recipient goes further', async () => {
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
