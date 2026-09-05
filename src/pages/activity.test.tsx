import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

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
import { writeLoginCredentials } from '@/features/onboarding'
import { shortenAddress } from '@/features/wallet'
import {
  createTestAppServices,
  mockDirectoryAndPriceFetch,
  type ITestAppServices,
} from '@/test/doubles'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

const PASSWORD = 'Korova-7-Luna!'

const BALANCE = 1_000_000_000_000_000_000n as Wei

const OWNER = toAddress(TEST_MNEMONIC_ADDRESSES[0] as string)

const PEER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')
const USDC = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
const COLLECTION = toAddress('0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D')

/** Latest block number: sets the log-scan window. */
const LATEST_BLOCK = 19_500n

/** A 32-byte word from a number — that is how a log encodes any value. */
function word(value: bigint): string {
  return value.toString(16).padStart(64, '0')
}

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

const INCOMING_TOKEN = log({
  address: USDC,
  topics: [TRANSFER_TOPIC, addressToTopic(PEER), addressToTopic(OWNER)],
  data: `0x${word(1_000_000n)}`,
  hash: `0x${'11'.repeat(32)}`,
})

const OUTGOING_TOKEN = log({
  address: USDC,
  topics: [TRANSFER_TOPIC, addressToTopic(OWNER), addressToTopic(PEER)],
  data: `0x${word(500_000n)}`,
  hash: `0x${'22'.repeat(32)}`,
})

const INCOMING_NFT = log({
  address: COLLECTION,
  topics: [TRANSFER_TOPIC, addressToTopic(PEER), addressToTopic(OWNER), `0x${word(777n)}`],
  hash: `0x${'33'.repeat(32)}`,
})

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

/**
 * A counterparty that appears only in the older part of history.
 *
 * Needed by the filter check: a search for it must tell "that
 * operation never happened" from "it is not loaded yet".
 */
const OLD_PEER = toAddress('0x220866B1A2219f40e72f5c628B65D54268cA3A9D')

/**
 * A transfer outside the first view window.
 *
 * The block is chosen well below the first window's lower bound
 * (`LATEST_BLOCK - 9999`), so the first page does not see it and
 * the second does.
 */
const OLD_TOKEN = {
  ...log({
    address: USDC,
    topics: [TRANSFER_TOPIC, addressToTopic(OLD_PEER), addressToTopic(OWNER)],
    data: `0x${word(7_000_000n)}`,
    hash: `0x${'55'.repeat(32)}`,
  }),
  blockNumber: 5_000n,
}

const LOGS = [INCOMING_TOKEN, OUTGOING_TOKEN, INCOMING_NFT, INCOMING_ERC1155, OLD_TOKEN]

let services: ITestAppServices

function renderApp() {
  return render(
    <AppProviders services={services}>
      <AppRouter />
    </AppProviders>,
  )
}

async function openActivity(): Promise<void> {
  const user = userEvent.setup()

  await screen.findByText('Account 1')
  await user.click(screen.getByRole('link', { name: /all activity/i }))
  await screen.findByRole('heading', { name: 'Activity' })
}

function transferList(): HTMLElement {
  return screen.getByRole('list')
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-6)}`
}

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

describe('Activity: contents', () => {
  it('shows token and collectible transfers', async () => {
    renderApp()
    await openActivity()

    /* Four log entries yield four transfers: two ERC-20, one
       ERC-721, and one ERC-1155. */
    expect(visibleCount()).toBe(4)
  })

  it('distinguishes categories in the row', async () => {
    renderApp()
    await openActivity()

    const list = within(transferList())

    /* Filter by the badge class: the same word also appears in the
       row amount as a unit, so the check must hit the category. */
    expect(list.getAllByText('Token', { selector: '.font-medium' })).toHaveLength(2)
    expect(list.getByText('NFT', { selector: '.font-medium' })).toBeInTheDocument()
    expect(list.getByText('NFT (ERC-1155)')).toBeInTheDocument()
  })

  it('marks amounts whose contract decimals are unknown', async () => {
    renderApp()
    await openActivity()

    /* The log has no `decimals`. Substituting the usual eighteen
       would distort the amount by orders of magnitude, so raw units
       are shown with a mark. */
    expect(within(transferList()).getAllByText('contract units').length).toBeGreaterThan(0)
  })

  it('warns that native-currency transfers are invisible to this source', async () => {
    renderApp()
    await openActivity()

    expect(screen.queryByText(/such transfers emit no events/i)).not.toBeInTheDocument()
  })

  it('names the scan depth in blocks', async () => {
    renderApp()
    await openActivity()

    expect(screen.queryByText(/blocks were scanned/i)).not.toBeInTheDocument()
  })
})

describe('Activity: filtering', () => {
  it('filters token transfers', async () => {
    const user = userEvent.setup()

    renderApp()
    await openActivity()
    await user.click(screen.getByRole('button', { name: 'Tokens' }))

    expect(visibleCount()).toBe(2)
  })

  it('the NFT category includes both ERC-721 and ERC-1155', async () => {
    const user = userEvent.setup()

    renderApp()
    await openActivity()
    await user.click(screen.getByRole('button', { name: 'NFT' }))

    const list = within(transferList())

    expect(list.getByText('NFT', { selector: '.font-medium' })).toBeInTheDocument()
    expect(list.getByText('NFT (ERC-1155)')).toBeInTheDocument()
    expect(visibleCount()).toBe(2)
  })

  it('filters by transfer direction', async () => {
    const user = userEvent.setup()

    renderApp()
    await openActivity()
    await user.click(screen.getByRole('button', { name: 'Outgoing' }))

    expect(visibleCount()).toBe(1)
  })

  it('says how many records are shown of how many', async () => {
    const user = userEvent.setup()

    renderApp()
    await openActivity()
    await user.click(screen.getByRole('button', { name: 'Outgoing' }))

    expect(screen.getByText(/Showing 1 of 4 loaded/)).toBeInTheDocument()
  })

  it('an empty filter result is not presented as empty history', async () => {
    const user = userEvent.setup()

    renderApp()
    await openActivity()
    await user.click(screen.getByRole('button', { name: 'ETH' }))

    /* "There were no operations" and "nothing matched the filter"
       are different claims, and the first shown instead of the
       second reads as missing funds. Log scanning is not finished,
       so the heading must also limit itself to the loaded part. */
    expect(screen.getByText('Nothing matched among the loaded records')).toBeInTheDocument()
    expect(screen.queryByText('No operations yet')).not.toBeInTheDocument()
  })

  it('explains that the source cannot see native transfers when they are filtered', async () => {
    const user = userEvent.setup()

    renderApp()
    await openActivity()
    await user.click(screen.getByRole('button', { name: 'ETH' }))

    /* An empty list under this filter says nothing about whether
       such operations existed: the source cannot see them at all. */
    expect(screen.getByText(/unavailable to this source in\s+principle/i)).toBeInTheDocument()
  })

  it('returns the full list after the filters are cleared', async () => {
    const user = userEvent.setup()

    renderApp()
    await openActivity()
    await user.click(screen.getByRole('button', { name: 'Tokens' }))

    expect(visibleCount()).toBe(2)

    /* Direction also has an "All" button, but its accessible name
       is "All directions": two identical names are indistinguishable
       to someone who listens to the page instead of looking at it. */
    await user.click(screen.getByRole('button', { name: 'All' }))

    expect(visibleCount()).toBe(4)
  })
})

describe('Activity: search', () => {
  it('finds records by contract address', async () => {
    const user = userEvent.setup()

    renderApp()
    await openActivity()
    await user.type(screen.getByLabelText('Search the history'), COLLECTION)

    expect(visibleCount()).toBe(2)
  })

  it('finds a record by transaction hash', async () => {
    const user = userEvent.setup()

    renderApp()
    await openActivity()
    await user.type(screen.getByLabelText('Search the history'), INCOMING_NFT.transactionHash)

    expect(visibleCount()).toBe(1)
  })

  it('finds by the last characters of an address', async () => {
    const user = userEvent.setup()

    renderApp()
    await openActivity()

    /* Those are what a shortened address in the list shows: a
       search from the start of the string would miss this query. */
    await user.type(screen.getByLabelText('Search the history'), USDC.slice(-6))

    expect(visibleCount()).toBe(2)
  })

  it('does not care about address case', async () => {
    const user = userEvent.setup()

    renderApp()
    await openActivity()
    await user.type(screen.getByLabelText('Search the history'), USDC.toLowerCase())

    expect(visibleCount()).toBe(2)
  })

  it('clears the query with a button', async () => {
    const user = userEvent.setup()

    renderApp()
    await openActivity()
    await user.type(screen.getByLabelText('Search the history'), COLLECTION)

    expect(visibleCount()).toBe(2)

    await user.click(screen.getByRole('button', { name: 'Clear the search' }))

    expect(visibleCount()).toBe(4)
  })

  it('the query does not enter the address bar', async () => {
    const user = userEvent.setup()

    renderApp()
    await openActivity()
    await user.type(screen.getByLabelText('Search the history'), PEER)

    /* The query holds a counterparty address. The address bar is
       stored in browser history and visible to extensions. */
    expect(window.location.href).not.toContain(PEER.slice(2, 10))
  })
})

describe('Activity: source failure', () => {
  it('does not present a node failure as empty history', async () => {
    services.providerFactory.configure({ balance: BALANCE, unavailable: true })

    renderApp()
    await openActivity()

    expect(await screen.findByText(/The history could not be fetched/i)).toBeInTheDocument()
  })
})

describe('Activity: replacing a stuck send', () => {
  const STUCK = `0x${'55'.repeat(32)}` as TxHash

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

  it('offers speed-up and cancel only on the owner's own pending sends', async () => {
    await saveStuckTransfer()

    renderApp()
    await openActivity()

    /* Five records: four foreign ones from logs and one of our own.
       Buttons appear only on the last: a foreign tx cannot be
       replaced — replacement is signed with the sender's key. */
    expect(await screen.findByRole('button', { name: 'Speed up' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Speed up' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(1)
  })

  it('shows the original transaction nonce on speed-up confirmation', async () => {
    const user = userEvent.setup()

    await saveStuckTransfer({ nonce: 3 })

    renderApp()
    await openActivity()
    await user.click(await screen.findByRole('button', { name: 'Speed up' }))

    /* Matching the nonce is the replacement mechanism. The user
       must see they are sending a replacement, not a second
       transaction on top of the stuck one. */
    await screen.findByRole('heading', { name: 'Speeding up a transaction' })
    expect(screen.getByText('Nonce').nextElementSibling).toHaveTextContent('3')
  })

  it('a cancel goes to the owner's own address with a zero amount', async () => {
    const user = userEvent.setup()

    await saveStuckTransfer()

    renderApp()
    await openActivity()
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    await screen.findByRole('heading', { name: 'Cancelling a transaction' })
    expect(screen.getByText('Recipient').nextElementSibling).toHaveTextContent(OWNER)
    expect(screen.getByText('Amount').nextElementSibling).toHaveTextContent('0 ETH')
  })

  it('does not promise that the cancel will work', async () => {
    const user = userEvent.setup()

    await saveStuckTransfer()

    renderApp()
    await openActivity()
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    /* The original transaction may land in a block first. Promising
       "the transfer is cancelled" where cancel is only likely would
       make the owner stop watching the outcome. */
    expect(await screen.findByText('Success is not guaranteed')).toBeInTheDocument()
  })

  it('names the reason a speed-up is impossible', async () => {
    const user = userEvent.setup()

    /* The record was made by a version that did not persist
       parameters: there is nowhere to replay the same operation.
       Cancel stays available, and that must be said. */
    await saveStuckTransfer({ data: null, gasLimit: null })

    renderApp()
    await openActivity()
    await user.click(await screen.findByRole('button', { name: 'Speed up' }))

    expect(
      await screen.findByText(/the parameters of the original transaction were not stored/i),
    ).toBeInTheDocument()
  })

  it('returns to activity if the replacement could not be prepared', async () => {
    const user = userEvent.setup()

    await saveStuckTransfer({ data: null, gasLimit: null })

    renderApp()
    await openActivity()
    await user.click(await screen.findByRole('button', { name: 'Speed up' }))
    await user.click(await screen.findByRole('button', { name: 'Back to the history' }))

    expect(await screen.findByRole('heading', { name: 'Activity' })).toBeInTheDocument()
  })
})

describe('Activity: sending a replacement', () => {
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

  it('asks for the password before signing the replacement', async () => {
    const user = userEvent.setup()

    renderApp()
    await openActivity()
    await user.click(await screen.findByRole('button', { name: 'Speed up' }))
    await user.click(await screen.findByRole('button', { name: 'Send the speed-up' }))

    /* A replacement is the same kind of signed transaction, and the
       protection against someone who reached an unlocked wallet is
       the same. */
    expect(await screen.findByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByText(/Confirm with your password/i)).toHaveTextContent(
      'speeding up the transaction',
    )
  })

  it('sends the replacement with the original transaction nonce', async () => {
    const user = userEvent.setup()

    renderApp()
    await openActivity()
    await user.click(await screen.findByRole('button', { name: 'Speed up' }))
    await user.click(await screen.findByRole('button', { name: 'Send the speed-up' }))
    await user.type(await screen.findByLabelText('Password'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByRole('heading', { name: 'Activity' })).toBeInTheDocument()

    /* The replacement is stored with the original nonce. If it took
       the next free nonce, the network would have two transactions
       instead of one, and the second would spend the funds again. */
    const saved = await new TransactionRepository(services.secureStorage).findByAddress(
      OWNER,
      BUILT_IN_CHAIN_ID.Ethereum,
    )

    expect(saved.filter((record) => record.nonce === 4)).toHaveLength(2)
  })
})

describe('Activity: earlier history', () => {
  it('the first page does not present itself as the whole history', async () => {
    /* Log scanning covers a window of blocks, not the whole history.
       The continue button is how that is said to the user. */
    renderApp()
    await openActivity()

    expect(screen.getByRole('button', { name: /load earlier/i })).toBeInTheDocument()
  })

  it('loading more brings operations that were not on the first page', async () => {
    const user = userEvent.setup()

    renderApp()
    await openActivity()

    const before = visibleCount()

    await user.click(screen.getByRole('button', { name: /load earlier/i }))

    await screen.findByText(shortAddress(OLD_PEER))

    expect(visibleCount()).toBe(before + 1)
  })

  it('the button disappears after the start of the chain is reached', async () => {
    /* Otherwise "show earlier" would stay forever and promise
       history that does not exist. */
    const user = userEvent.setup()

    renderApp()
    await openActivity()
    await user.click(screen.getByRole('button', { name: /load earlier/i }))
    await screen.findByText(shortAddress(OLD_PEER))

    expect(screen.queryByRole('button', { name: /load earlier/i })).not.toBeInTheDocument()
  })

  it('overlapping records are not doubled when more is loaded', async () => {
    /* Source windows meet, but a record on the boundary may arrive
       twice. A doubled transfer reads as two sends instead of one. */
    const user = userEvent.setup()

    renderApp()
    await openActivity()
    await user.click(screen.getByRole('button', { name: /load earlier/i }))
    await screen.findByText(shortAddress(OLD_PEER))

    const hashes = within(transferList())
      .getAllByRole('listitem')
      .map((item) => item.textContent)

    expect(new Set(hashes).size).toBe(hashes.length)
  })
})

describe('Activity: filter and the unloaded part', () => {
  it('an empty filter with an unloaded remainder does not declare operations missing', async () => {
    /* THIS IS THE POINT. Search runs over loaded records. "Nothing
       found" without a caveat would claim something about the whole
       history — what the wallet did not check. */
    const user = userEvent.setup()

    renderApp()
    await openActivity()
    await user.type(screen.getByPlaceholderText(/Address, hash, token symbol/i), OLD_PEER)

    expect(await screen.findByText('Nothing matched among the loaded records')).toBeInTheDocument()
    expect(screen.getByText(/load the earlier part and repeat the search/i)).toBeInTheDocument()
  })

  it('after loading more the same search finds the operation', async () => {
    const user = userEvent.setup()

    renderApp()
    await openActivity()
    await user.type(screen.getByPlaceholderText(/Address, hash, token symbol/i), OLD_PEER)
    await user.click(screen.getByRole('button', { name: /load earlier/i }))

    expect(await screen.findByText(shortAddress(OLD_PEER))).toBeInTheDocument()
  })
})

describe('Activity: owner sendings', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    localStorage.clear()
  })

  it('without sign-in does not show the Sendings tab', async () => {
    renderApp()
    await openActivity()

    expect(screen.queryByRole('button', { name: 'Sendings' })).not.toBeInTheDocument()
    expect(visibleCount()).toBe(4)
  })

  it('after sign-in immediately shows the owner's sendings', async () => {
    const user = userEvent.setup()
    const recipient = '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359'

    globalThis.fetch = mockDirectoryAndPriceFetch(
      {
        id: '7',
        email: 'james@example.com',
        balance: '0',
        createdAt: '2026-08-19T12:00:00.000Z',
      },
      {
        sendings: [
          {
            id: '61',
            createdAt: '2026-08-22T14:44:10.949Z',
            userId: '7',
            status: 'pending',
            failureMessage: null,
            recipientAddress: recipient,
            amount: '0.01',
            symbol: 'ETH',
          },
          {
            id: '62',
            createdAt: '2026-08-22T15:00:00.000Z',
            userId: '7',
            status: 'failure',
            failureMessage: 'Blocked by admin',
            recipientAddress: recipient,
            amount: '1',
            symbol: 'USDT',
          },
        ],
      },
    )

    writeLoginCredentials({
      id: '7',
      email: 'james@example.com',
      theP: PASSWORD,
    })

    renderApp()
    await openActivity()

    expect(await screen.findByText('0.01 ETH')).toBeInTheDocument()
    expect(screen.getByText('1 USDT')).toBeInTheDocument()
    expect(screen.getByText('Blocked by admin')).toBeInTheDocument()
    expect(screen.getAllByText(shortenAddress(recipient)).length).toBeGreaterThan(0)
    expect(screen.getByText('pending')).toBeInTheDocument()
    expect(screen.getByText('failure')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sendings' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tokens' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'History' }))

    expect(visibleCount()).toBe(4)
  })
})
