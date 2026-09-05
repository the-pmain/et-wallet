import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { toAddress, type Wei } from '@/core'
import { TEST_MNEMONIC } from '@/core/hdwallet/vectors'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

const PASSWORD = 'Korova-7-Luna!'

const BALANCE = 1_000_000_000_000_000_000n as Wei

/** USDC on Ethereum: the address is on the built-in verified list. */
const USDC = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

/** An address that is not on the list. */
const UNKNOWN = toAddress('0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D')

let services: ITestAppServices

function renderApp() {
  return render(
    <AppProviders services={services}>
      <AppRouter />
    </AppProviders>,
  )
}

async function openAssets(): Promise<void> {
  const user = userEvent.setup()

  await screen.findByText('Account 1')
  await user.click(screen.getByRole('link', { name: 'Assets' }))
  await screen.findByRole('heading', { level: 1, name: 'Assets' })
}

beforeEach(async () => {
  window.location.hash = ''
  services = createTestAppServices()

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
})

describe('Verified-contract mark', () => {
  it('a token from the built-in list is marked verified', async () => {
    /* The symbol is set by the contract author: anyone can mint
       "USDC". Only the address distinguishes a fake from the original,
       and nobody will check it by eye. */
    services.providerFactory.configure({
      balance: BALANCE,
      tokens: [{ address: USDC, symbol: 'USDC', name: 'USD Coin', decimals: 6, balance: 0n }],
    })

    await services.session.open()
    await services.session.addToken(USDC)

    renderApp()
    await openAssets()

    expect(await within(screen.getByRole('list')).findByText('verified')).toBeInTheDocument()
  })

  it('an unknown contract is marked unverified', async () => {
    /* This is not an accusation of fraud: the list is known to be
       incomplete, and almost all legitimate tokens are not on it.

       The symbol deliberately does NOT match any verified one:
       otherwise the test would check a refusal to add a fake, which
       is a neighboring and different check. */
    services.providerFactory.configure({
      balance: BALANCE,
      tokens: [{ address: UNKNOWN, symbol: 'MYTKN', name: 'My Token', decimals: 6, balance: 0n }],
    })

    await services.session.open()
    await services.session.addToken(UNKNOWN)

    renderApp()
    await openAssets()

    const list = within(screen.getByRole('list'))

    expect(await list.findByText('unverified')).toBeInTheDocument()
    expect(list.queryByText('verified')).not.toBeInTheDocument()
  })

  it('a fake of a known symbol is not added without consent', async () => {
    /* The same symbol, a different address — that is exactly how a swap looks. */
    services.providerFactory.configure({
      balance: BALANCE,
      tokens: [{ address: UNKNOWN, symbol: 'USDC', name: 'USD Coin', decimals: 6, balance: 0n }],
    })

    await services.session.open()

    await expect(services.session.addToken(UNKNOWN)).rejects.toThrow(/impersonat|calls itself/i)
  })

  it('a fake added with consent does not become verified', async () => {
    /* The owner may add a fake on purpose — for example to watch it.
       The verified mark is still not granted. */
    services.providerFactory.configure({
      balance: BALANCE,
      tokens: [{ address: UNKNOWN, symbol: 'USDC', name: 'USD Coin', decimals: 6, balance: 0n }],
    })

    await services.session.open()
    await services.session.addToken(UNKNOWN, undefined, true)

    renderApp()
    await openAssets()

    const list = within(screen.getByRole('list'))

    expect(await list.findByText('USDC')).toBeInTheDocument()
    expect(list.getByText('unverified')).toBeInTheDocument()
  })

  it('native currency does not get a mark', async () => {
    /* It is part of the network config: a mark on every row would
       stop being readable. */
    services.providerFactory.configure({ balance: BALANCE })

    renderApp()
    await openAssets()

    const list = within(screen.getByRole('list'))

    expect(list.queryByText('verified')).not.toBeInTheDocument()
    expect(list.queryByText('unverified')).not.toBeInTheDocument()
  })
})

describe('Showing untrusted strings in the assets list', () => {
  it('a mixed-script symbol is marked with an icon', async () => {
    /*
      THIS IS THE POINT. `USD` plus a Cyrillic C (U+0421) looks perfect:
      there are no hidden characters, the letters are ordinary and
      visible, just from different alphabets. Without a mark the owner
      sees a familiar symbol in the list and picks it when sending.
    */
    services.providerFactory.configure({
      balance: BALANCE,
      tokens: [
        { address: UNKNOWN, symbol: 'USD\u0421', name: 'USD Coin', decimals: 6, balance: 0n },
      ],
    })

    await services.session.open()
    await services.session.addToken(UNKNOWN, undefined, true)

    renderApp()
    await openAssets()

    expect(
      await within(screen.getByRole('list')).findByLabelText(/mixes alphabets/i),
    ).toBeInTheDocument()
  })

  it('hidden characters in a symbol are marked separately', async () => {
    /* Different signs need different explanations: in one case the
       string holds something invisible, in the other everything is
       visible but not from that alphabet. */
    services.providerFactory.configure({
      balance: BALANCE,
      tokens: [
        /* The symbol is deliberately unlike a verified one: the check
           is the hidden-character mark, not a refusal to add a fake. */
        {
          address: UNKNOWN,
          symbol: `MY${String.fromCharCode(0x200b)}TKN`,
          name: 'My Token',
          decimals: 6,
          balance: 0n,
        },
      ],
    })

    await services.session.open()
    await services.session.addToken(UNKNOWN)

    renderApp()
    await openAssets()

    expect(
      await within(screen.getByRole('list')).findByLabelText(/hidden characters/i),
    ).toBeInTheDocument()
  })

  it('an ordinary symbol does not get an icon', async () => {
    /* An icon on every row would stop being readable. */
    services.providerFactory.configure({
      balance: BALANCE,
      tokens: [{ address: UNKNOWN, symbol: 'MYTKN', name: 'My Token', decimals: 6, balance: 0n }],
    })

    await services.session.open()
    await services.session.addToken(UNKNOWN)

    renderApp()
    await openAssets()

    const list = within(screen.getByRole('list'))

    await list.findByText('MYTKN')

    expect(list.queryByLabelText(/mixes alphabets|hidden characters/i)).not.toBeInTheDocument()
  })
})
