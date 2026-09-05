import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { BUILT_IN_CHAIN_ID, toAddress, type Wei } from '@/core'
import { TEST_MNEMONIC, TEST_MNEMONIC_ADDRESSES } from '@/core/hdwallet/vectors'
import { createTestAppServices, type IFakeEnsRecord, type ITestAppServices } from '@/test/doubles'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

const PASSWORD = 'Korova-7-Luna!'

/** First address of the test phrase — the wallet owns it. */
const OWNER = toAddress(TEST_MNEMONIC_ADDRESSES[0] as string)

/** A foreign address. Used as a recipient and as an impersonator. */
const OUTSIDER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

/** Ten ether: enough for a transfer and the fee. */
const BALANCE = (10n ** 19n) as Wei

let services: ITestAppServices

function renderApp() {
  return render(
    <AppProviders services={services}>
      <AppRouter />
    </AppProviders>,
  )
}

function withEns(records: readonly IFakeEnsRecord[]): void {
  services.providerFactory.configure({ balance: BALANCE, ensRecords: records })
}

async function openSend(): Promise<void> {
  const user = userEvent.setup()

  await screen.findByText('Account 1')
  await user.click(screen.getByRole('link', { name: /send/i }))
  await screen.findByRole('heading', { name: 'Send' })
}

async function typeRecipient(value: string): Promise<void> {
  const user = userEvent.setup()

  await user.type(screen.getByLabelText(/Recipient address/), value)

  await waitFor(() => {
    expect(screen.queryByText('Checking…')).not.toBeInTheDocument()
  })
}

beforeEach(async () => {
  window.location.hash = ''
  services = createTestAppServices()
  services.providerFactory.configure({ balance: BALANCE })

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
})

describe('ENS: forward resolution on the send form', () => {
  it('shows the address the name resolved to', async () => {
    /* The name is convenient, but the address is signed. The user
       must see it before they press Next. */
    withEns([{ name: 'shop.eth', address: OUTSIDER }])

    renderApp()
    await openSend()
    await typeRecipient('shop.eth')

    expect(await screen.findByText(OUTSIDER)).toBeInTheDocument()
  })

  it('resolves a name typed in uppercase', async () => {
    withEns([{ name: 'shop.eth', address: OUTSIDER }])

    renderApp()
    await openSend()
    await typeRecipient('SHOP.ETH')

    expect(await screen.findByText(OUTSIDER)).toBeInTheDocument()
  })

  it('a name that does not exist does not go further', async () => {
    withEns([])

    renderApp()
    await openSend()
    await typeRecipient('nobody.eth')

    expect(await screen.findByText(/There is no record for this name/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('a name with a swapped letter is rejected with an explanation', async () => {
    /* A Cyrillic a (U+0430) is indistinguishable from a Latin one on
       screen. Resolving such a name would send funds to the owner of
       a look-alike. The character is built from a code point: as a
       literal it would be uncheckable when reading the test. */
    const spoofed = `vit${'\u0430'}lik.eth`

    withEns([{ name: 'vitalik.eth', address: OUTSIDER }])

    renderApp()
    await openSend()
    await typeRecipient(spoofed)

    expect(await screen.findByText(/mixes different scripts/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('a name with emoji resolves and is marked as non-Latin', async () => {
    /* ENSIP-15 accepts such a name, and the wallet must send it.
       But a name not written in Latin can look like someone else's —
       that is said plainly, without a ban. */
    withEns([{ name: '\u{1F600}.eth', address: OUTSIDER }])

    renderApp()
    await openSend()
    await typeRecipient('\u{1F600}.eth')

    expect(await screen.findByText(OUTSIDER)).toBeInTheDocument()
    expect(screen.getByText(/The name is not written in Latin script/i)).toBeInTheDocument()
  })

  it('a Latin name is not accompanied by a script caveat', async () => {
    /* False alarms train people not to read real ones: the caveat
       appears only where it has a reason. */
    withEns([{ name: 'shop.eth', address: OUTSIDER }])

    renderApp()
    await openSend()
    await typeRecipient('shop.eth')

    await screen.findByText(OUTSIDER)

    expect(screen.queryByText(/The name is not written in Latin script/i)).not.toBeInTheDocument()
  })

  it('confirmation shows the name together with the address, not instead of it', async () => {
    const user = userEvent.setup()

    withEns([{ name: 'shop.eth', address: OUTSIDER }])

    renderApp()
    await openSend()
    await typeRecipient('shop.eth')
    await user.type(screen.getByLabelText(/Amount/), '1')

    const next = screen.getByRole('button', { name: 'Next' })

    await waitFor(() => {
      expect(next).toBeEnabled()
    })

    await user.click(next)

    await screen.findByRole('heading', { name: 'Confirmation' })

    expect(screen.getByText('shop.eth')).toBeInTheDocument()
    expect(screen.getByText(OUTSIDER)).toBeInTheDocument()
    expect(screen.getByText(/The address came from an ENS name/i)).toBeInTheDocument()
  })
})

describe('ENS: reverse resolution', () => {
  it('labels its own account with a name instead of the address', async () => {
    withEns([{ name: 'me.eth', address: OWNER, reverseFor: OWNER }])

    renderApp()

    expect(await screen.findByText('me.eth')).toBeInTheDocument()
  })

  it("does not show a name that points at someone else's address", async () => {
    /* THE MOST IMPORTANT CHECK. The reverse record is set by the
       address owner, and anyone may call themselves `vitalik.eth`.
       Showing it without a check would endorse a fake with the
       wallet UI. */
    withEns([{ name: 'vitalik.eth', address: OUTSIDER, reverseFor: OWNER }])

    renderApp()
    await screen.findByText('Account 1')

    /* Wait until account data has loaded: a name, if it were shown,
       would have appeared by now. */
    await waitFor(() => {
      expect(services.session.getSnapshot().isEnsSupported).toBe(true)
    })

    expect(screen.queryByText('vitalik.eth')).not.toBeInTheDocument()
  })

  it('names the address typed in the recipient field', async () => {
    withEns([{ name: 'shop.eth', address: OUTSIDER, reverseFor: OUTSIDER }])

    renderApp()
    await openSend()
    await typeRecipient(OUTSIDER)

    expect(await screen.findByText(/The name of this address/i)).toBeInTheDocument()
  })
})

describe('ENS: other networks', () => {
  it('on a network without a registry the name is not resolved and that is said plainly', async () => {
    /* Resolving a name from Polygon would mean opening a second
       connection to an Ethereum node — unnoticed by an owner who
       thinks they are on another network. */
    const user = userEvent.setup()

    withEns([{ name: 'shop.eth', address: OUTSIDER }])

    renderApp()
    await screen.findByText('Account 1')

    await services.session.switchNetwork(BUILT_IN_CHAIN_ID.Polygon)
    await openSend()
    await typeRecipient('shop.eth')

    expect(await screen.findByText(/only in the Ethereum network/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()

    /* An address on the same network is accepted: ENS limits name
       resolution, not sending. */
    await user.clear(screen.getByLabelText(/Recipient address/))
    await typeRecipient(OUTSIDER)
    await user.type(screen.getByLabelText(/Amount/), '1')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
    })
  })
})
