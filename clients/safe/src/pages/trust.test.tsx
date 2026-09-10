import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { TEST_MNEMONIC } from '@/core/hdwallet/vectors'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'
import { openPath } from '@/test/open-path'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

const PASSWORD = 'Korova-7-Luna!'

let services: ITestAppServices

function renderApp() {
  return render(
    <AppProviders services={services}>
      <AppRouter />
    </AppProviders>,
  )
}

beforeEach(() => {
  window.location.hash = ''
  services = createTestAppServices()
})

describe('What you have to trust', () => {
  it('is available from the first screen, before wallet creation', async () => {
    /* The facts are needed before the decision: someone who already
       created a wallet and sent funds there cannot undo that. */
    const user = userEvent.setup()

    renderApp()

    await user.click(await screen.findByRole('link', { name: /what you are trusting/i }))

    expect(
      await screen.findByRole('heading', { name: 'What you are trusting' }),
    ).toBeInTheDocument()
  })

  it('names the core fact: the code is downloaded from the server on every open', async () => {
    /* This is what sets a web wallet apart from an extension or a
       desktop app, and staying silent would promise safety it does
       not have. */
    openPath('/trust')

    renderApp()

    expect(await screen.findByText(/downloaded from a server every time/i)).toBeInTheDocument()
  })

  it('says plainly that encryption does not help here', async () => {
    /* The temptation to soothe with a mention of encryption is strong,
       but the replaced code is the wallet: it will encrypt exactly as
       it is told. */
    openPath('/trust')

    renderApp()

    expect(
      await screen.findByText(/no encryption inside the wallet prevents that/i),
    ).toBeInTheDocument()
  })

  it('separates what the wallet protects from what it cannot', async () => {
    openPath('/trust')

    renderApp()

    expect(await screen.findByText('What the wallet does protect')).toBeInTheDocument()
    expect(screen.getByText('What it cannot protect')).toBeInTheDocument()
  })

  it('gives actionable advice, not a call not to use the wallet', async () => {
    /* The owner of the funds decides: the wallet must inform, not
       choose for them. */
    openPath('/trust')

    renderApp()

    expect(await screen.findByText(/from your own bookmark/i)).toBeInTheDocument()
    expect(screen.getByText(/hardware wallet/i)).toBeInTheDocument()
  })

  it('notes that this is a property of every web wallet', async () => {
    /* Otherwise the page reads as a confession of its own unreliability,
       not as an explanation of how the form works. */
    openPath('/trust')

    renderApp()

    expect(await screen.findByText(/every wallet that runs as a web page/i)).toBeInTheDocument()
  })

  it('is available from settings of an unlocked wallet', async () => {
    const user = userEvent.setup()

    await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)

    renderApp()
    await screen.findByText('Account 1')

    await user.click(screen.getByRole('link', { name: 'Settings' }))
    await user.click(await screen.findByRole('link', { name: /what you are trusting/i }))

    expect(
      await screen.findByRole('heading', { name: 'What you are trusting' }),
    ).toBeInTheDocument()
  })
})
