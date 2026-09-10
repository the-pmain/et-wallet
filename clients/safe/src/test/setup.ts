import '@testing-library/jest-dom/vitest'

/*
  IndexedDB is missing in jsdom, and the wallet's persistent store
  is built on it. Without this stub any test that assembles the
  production service graph would fail on opening the database —
  that is, it would test the absence of IndexedDB in jsdom, not
  the wallet.

  The implementation from `fake-indexeddb` is used: it follows the
  spec, including structured cloning of values and transaction
  rollback. A stub that answers “success” to every request would
  hide the very errors the checks are written for.
*/
import 'fake-indexeddb/auto'

import { cleanup, configure } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

import { appMarketCatalog } from '@/core'
import { appFiatRates } from '@/features/wallet/model/fiat-rates-cache'
import { TestEventSource } from '@/test/doubles'

/*
  The async-wait timeout is raised from one second to five.

  The reason is not slow code: opening a wallet session derives
  keys from a seed phrase (PBKDF2, even with a reduced iteration
  count), starts services, and queries a node double. On a full
  run on a loaded machine that did not fit in a second, and the
  suite produced random failures in different files.

  A flaky test is worse than a missing one: it trains people not
  to look at red. A higher timeout only slows real failures —
  a successful wait ends as soon as the condition is met.
*/
configure({ asyncUtilTimeout: 5000 })

/*
  jsdom does not implement window.matchMedia. Without a stub any
  component that reacts to system settings (theme,
  prefers-reduced-motion) crashes. The stub reports “the query
  does not match” — that matches the light theme and no special
  user preferences.
*/
vi.stubGlobal('EventSource', TestEventSource)

vi.stubGlobal(
  'matchMedia',
  vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
)

/*
  jsdom does not implement modal `<dialog>`: `showModal` and
  `close` are missing even in version 30. Without a stub any test
  that touches a modal would fail on a missing method — that is,
  it would test jsdom completeness, not the wallet.

  The minimum needed for markup checks is stubbed: open sets the
  `open` attribute, close removes it and dispatches `close`, and
  Escape closes the dialog — exactly what the component uses.
  Real modality (top layer, focus trap, inert document) stays
  with the browser and is not faked here: a stub that pretends
  focus is trapped would hide the very errors such checks are
  written for.
*/
if (
  typeof HTMLDialogElement !== 'undefined' &&
  HTMLDialogElement.prototype.showModal === undefined
) {
  const open = function open(this: HTMLDialogElement): void {
    this.setAttribute('open', '')
  }

  const close = function close(this: HTMLDialogElement, returnValue?: string): void {
    if (!this.hasAttribute('open')) {
      return
    }

    this.removeAttribute('open')

    if (returnValue !== undefined) {
      this.returnValue = returnValue
    }

    this.dispatchEvent(new Event('close'))
  }

  HTMLDialogElement.prototype.showModal = open
  HTMLDialogElement.prototype.show = open
  HTMLDialogElement.prototype.close = close

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
      return
    }

    document.querySelectorAll('dialog[open]').forEach((dialog) => {
      ;(dialog as HTMLDialogElement).close()
    })
  })
}

/*
  Navigator languages are pinned.

  The app reads the browser locale, which is correct for the
  product — not for tests: jsdom reports `en-US`, so a suite that
  passes on a Russian machine would fail on an English one. A
  test that depends on the host locale tests the host, not the
  app.

  The property is replaced as a whole, not via
  `vi.stubGlobal('navigator')`: replacing the entire navigator
  would strip `clipboard`, which the receive screen uses.
*/
Object.defineProperty(navigator, 'languages', {
  value: ['ru-RU', 'ru'],
  configurable: true,
})

/*
  Unmounting the React tree after each test is required: otherwise
  provider state leaks between tests and makes results
  non-deterministic.
*/
afterEach(() => {
  cleanup()
  sessionStorage.clear()
  localStorage.clear()
  TestEventSource.reset()
  appMarketCatalog.reset()
  appFiatRates.reset()
  /* Brand tokens are written onto the document root. A leftover
     accent from the previous test would tint the next one. */
  document.documentElement.removeAttribute('data-accent')
  document.documentElement.style.removeProperty('--brand-hue')
  document.documentElement.style.removeProperty('--brand-chroma')
  document.documentElement.style.removeProperty('--brand-primary-l')
  document.documentElement.style.removeProperty('--brand-emphasis-l')
  document.documentElement.style.removeProperty('--brand-fg-l')
  /* Otherwise the next test would open on `/wallet/nft` after a
     navigation in the previous one: `BrowserRouter` reads
     `pathname` on mount. */
  window.history.replaceState(null, '', '/')
})

/*
  Public-market and fiat-rate requests from the home screen must
  not go to the network from unit tests: that is slow,
  non-deterministic, and adds an ETH ticker to the document so a
  balance assertion finds two nodes instead of one.

  `/coins/markets` and Frankfurter are intercepted. Other calls —
  to our server, to a node — pass through. Tests that replace
  `fetch` entirely override this stub themselves.
*/
const originalFetch = globalThis.fetch.bind(globalThis)

vi.stubGlobal('fetch', ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

  if (url.includes('/coins/markets')) {
    return Promise.resolve(
      new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  }

  if (url.includes('api.exchange.coinbase.com')) {
    return Promise.resolve(
      new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  }

  if (url.includes('frankfurter.app') || url.includes('frankfurter.dev') || url.includes('/v1/fiat-rates') || url.includes('/latest?from=USD')) {
    return Promise.resolve(
      new Response(JSON.stringify({ rates: { EUR: 0.9, GBP: 0.8 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  }

  return originalFetch(input, init)
}) as typeof fetch)
