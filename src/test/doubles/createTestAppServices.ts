import { MemoryStorageService, SecureStorage, type IProviderFactory } from '@/core'
import { DappSessionService } from '@/features/dapp'
import { bytesToHex } from '@noble/hashes/utils.js'

import { getRandomBytes } from '@/core'
import { OnboardingService, WalletBroadcast } from '@/features/onboarding'
import { SecuritySettingsRepository } from '@/features/security'
import { WalletSession } from '@/features/wallet'

import { FakeClock } from './FakeClock'
import { FakeSessionTransport } from './FakeSessionTransport'
import { FakePriceProvider } from './FakePriceProvider'
import { FakeProviderFactory } from './FakeProviderFactory'
import { FastEncryptionService } from './FastEncryptionService'
import { NullLogger } from './NullLogger'

export interface ITestAppServices {
  readonly onboarding: OnboardingService

  /**
   * Cross-tab notification channel.
   *
   * In checks it is the real one: `BroadcastChannel` exists in
   * jsdom and in Node. Replacing it with a double would test the
   * double.
   */
  readonly broadcast: WalletBroadcast

  /**
   * Channel name, unique per service set.
   *
   * ISOLATION IS REQUIRED. `BroadcastChannel` in Node delivers
   * messages between worker threads of one process, and checks run
   * in parallel. A shared name meant a wipe message from one check
   * would lock the wallet in every other — which happened on the
   * first run: the unlock-throttle check failed, though it has
   * nothing to do with tabs.
   */
  readonly broadcastName: string
  readonly session: WalletSession
  readonly providerFactory: FakeProviderFactory
  readonly priceProvider: FakePriceProvider
  readonly clock: FakeClock
  readonly securitySettings: SecuritySettingsRepository
  readonly dappSessions: DappSessionService
  readonly dappTransport: FakeSessionTransport
  readonly logger: NullLogger

  /**
   * Unencrypted store — the one the secure store sits on.
   *
   * Exposed for security checks: the only way to confirm a secret
   * is not stored in plaintext is to look at the raw records.
   */
  readonly storage: MemoryStorageService

  /** Secure store. One for onboarding and the session, as in production. */
  readonly secureStorage: SecureStorage
}

/**
 * Repeats the application composition root on doubles.
 *
 * WHY THE PRODUCTION BUILD IS NOT PARAMETERIZED. Letting
 * `createAppServices` take fast encryption or a fake node would
 * mean that substitution is reachable in a production build.
 * Doubles stay in test code, and structural match is checked by
 * both variants assembling the same classes.
 *
 * ONE STORE FOR BOTH SERVICES — as in production: onboarding
 * writes the mnemonic, the session reads it with the same
 * decryption session.
 */
export function createTestAppServices(): ITestAppServices {
  const storage = new MemoryStorageService()
  const secureStorage = new SecureStorage(storage, new FastEncryptionService())
  const clock = new FakeClock(1_700_000_000_000)
  const logger = new NullLogger()
  const providerFactory = new FakeProviderFactory()

  /* The price source is always injected, but it is queried only
     after the user consents: the call counter lets a test prove
     it was never hit before consent. */
  const priceProvider = new FakePriceProvider()

  const session = new WalletSession({
    secureStorage,
    storage,
    clock,
    logger,
    providerFactory: providerFactory satisfies IProviderFactory,
    priceProvider,
  })

  /* Connection transport is a double: the real one needs a
     third-party key and a live relay, and the checks are about
     the wallet's decisions, not someone else's server. */
  const dappTransport = new FakeSessionTransport()

  /* Unique name: see the note on `broadcastName`. */
  const broadcastName = `etwallet-test-${bytesToHex(getRandomBytes(8))}`
  const broadcast = new WalletBroadcast(broadcastName)

  return {
    onboarding: new OnboardingService({
      broadcast,
      secureStorage,
    }),
    session,
    broadcast,
    broadcastName,
    providerFactory,
    priceProvider,
    clock,
    securitySettings: new SecuritySettingsRepository(storage),
    dappTransport,
    storage,
    secureStorage,
    dappSessions: new DappSessionService({
      transport: dappTransport,
      logger,
      getAddresses: () => session.getSnapshot().accounts.map((account) => account.address),
      getActiveChainId: () => session.getSnapshot().activeNetwork?.chainId ?? null,
      getAvailableChainIds: () => session.getSnapshot().networks.map((network) => network.chainId),
      execute: (request) => session.executeDappRequest(request),
    }),
    logger,
  }
}
