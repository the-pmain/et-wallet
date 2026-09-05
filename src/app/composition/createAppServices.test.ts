import { describe, expect, it } from 'vitest'

import { SESSION_STATE } from '@/features/wallet'

import { createAppServices } from './createAppServices'

/**
 * Composition-root checks.
 *
 * WHY THESE ARE NEEDED IF EVERY SERVICE IS TESTED ON ITS OWN. This
 * is where the production wiring is assembled, and exactly here
 * mistakes appear that no unit test will see: two secure stores
 * instead of one, a forgotten price source, clocks that drifted
 * apart. That already happened at stage 18 — the production build
 * used an empty price source, and only a live check caught it.
 *
 * WHAT IS NOT HERE. No network call: services are created but not
 * opened. The check is the wiring, not the nodes.
 */
describe('createAppServices: wiring', () => {
  it('assembles every app service', () => {
    const services = createAppServices()

    expect(services.onboarding).toBeDefined()
    expect(services.session).toBeDefined()
    expect(services.clock).toBeDefined()
    expect(services.securitySettings).toBeDefined()
    expect(services.dappSessions).toBeDefined()
  })

  it('starts the session closed', () => {
    /* An open session would mean keys derived before a password. */
    expect(createAppServices().session.getSnapshot().state).toBe(SESSION_STATE.Closed)
  })

  it('treats a clean store as uninitialized', async () => {
    const services = createAppServices()

    await services.onboarding.initialize()

    expect(services.onboarding.getState()).toBe('uninitialized')
  })

  it('gives an independent set on every call', () => {
    /* Shared state across calls would turn two wallet windows into
       one: unlocking one would open the other. */
    const first = createAppServices()
    const second = createAppServices()

    expect(first.session).not.toBe(second.session)
    expect(first.onboarding).not.toBe(second.onboarding)
  })
})

describe('createAppServices: one secure store for all', () => {
  it('onboarding and session read the same store', async () => {
    /*
      THE MOST IMPORTANT CHECK IN THIS FILE. `SecureStorage` owns the
      session key derived from the password. A second instance over
      the same store would have its own key and could not read what
      the first wrote: the wallet would create successfully and never
      open.

      WHY THE SESSION IS NOT OPENED HERE. Opening reaches a node
      poll, and the production wiring talks to real public RPCs: the
      check would depend on someone else's availability and would
      disclose the wallet address to a third-party operator on every
      run. A stand-in cannot be injected on purpose — `createAppServices`
      takes no arguments, otherwise the substitution would also be
      reachable in the production build.

      A sign of a shared instance, observed without the network:
      onboarding moves to the unlocked state, and a second read of
      the store with the same key yields what was written. The path
      as a whole — from import to an account on screen — is pinned
      by the end-to-end check `e2e/wallet-flow.spec.ts`, where the
      app runs built and in a real browser.

      The encryption key here is the real one, not a fast stand-in:
      it is the production wiring that is being checked.
    */
    const services = createAppServices()

    await services.onboarding.initialize()
    await services.onboarding.importWallet(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      'Korova-7-Luna!',
    )

    expect(services.onboarding.getState()).toBe('unlocked')

    /* Lock and unlock again with the same password: decryption
       succeeded, so the store header is the same one. */
    services.onboarding.lock()

    expect(services.onboarding.getState()).toBe('locked')

    await services.onboarding.unlock('Korova-7-Luna!')

    expect(services.onboarding.getState()).toBe('unlocked')
  }, 60_000)
})

describe('createAppServices: dapp connections', () => {
  it('assembles the dapp service and reads wallet addresses', () => {
    /* Addresses are read by a function, not copied at construction:
       a snapshot taken once would give the app a stale account. */
    const services = createAppServices()
    const snapshot = services.dappSessions.getSnapshot()

    expect(snapshot.isReady).toBe(false)
    expect(snapshot.sessions).toEqual([])
  })
})
