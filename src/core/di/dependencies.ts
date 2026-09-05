import type { IEncryptionService } from '@/core/encryption'
import type { IKeyringFactory } from '@/core/keyring'
import type { IWalletCoreConfig, IWalletManager } from '@/core/manager'
import type { INetworkConfig } from '@/core/network'
import type { IProviderFactory } from '@/core/provider'
import type { IClock, ILogger } from '@/core/platform'
import type { IStorageService } from '@/core/storage'

/**
 * External dependencies of the core.
 *
 * WHY CONSTRUCTOR DI AND A MANUAL COMPOSITION ROOT.
 *
 * Constructor injection with a hand-written composition root is used.
 * A container (InversifyJS, tsyringe, and the like) was rejected for
 * three reasons:
 *
 * 1. A technical conflict. Decorator containers need
 *    `emitDecoratorMetadata` — unavoidable codegen. The tsconfig has
 *    `erasableSyntaxOnly: true`, which forbids those constructs.
 *
 * 2. Security. A container pulls `reflect-metadata` into the bundle
 *    that runs next to the keys. Every library in that perimeter
 *    needs its own justification.
 *
 * 3. Lost checks. A container resolves dependencies at runtime: a
 *    missing registration fails at launch. A manual composition root
 *    is checked by the compiler — a missed dependency becomes a
 *    build error.
 *
 * WHAT IS DELIBERATELY ABSENT: a randomness source.
 *
 * `crypto.getRandomValues` is hard-wired into the implementation.
 * The ability to swap the RNG in a wallet is the ability to make
 * every key predictable. Test convenience is not worth that price.
 */
export interface IWalletCoreDependencies {
  /** Persistent storage. Swappable: IndexedDB, chrome.storage, memory. */
  readonly storage: IStorageService

  readonly encryption: IEncryptionService

  readonly providerFactory: IProviderFactory

  /**
   * Keyring factory.
   *
   * Extension point for hardware wallets: Ledger and Trezor support
   * is added by a factory implementation, without changing `IWallet`.
   */
  readonly keyringFactory: IKeyringFactory

  /**
   * Time and timers.
   *
   * Injected so auto-lock is testable: a test that really waits
   * fifteen minutes is useless.
   */
  readonly clock: IClock

  /** Logging with mandatory redaction of secrets. */
  readonly logger: ILogger

  readonly config: IWalletCoreConfig

  /**
   * Built-in networks.
   *
   * Passed in, not hard-wired into the core: the supported set is a
   * product decision and may differ between the web app and the
   * extension.
   */
  readonly builtInNetworks: readonly INetworkConfig[]
}

/**
 * Composition root of the core.
 *
 * The only function that knows how to wire implementations together.
 * The rest of the app receives a ready `IWalletManager` and knows
 * none of the concrete implementations.
 *
 * The implementation is a later step. Only the contract is fixed
 * here.
 */
export type WalletCoreFactory = (dependencies: IWalletCoreDependencies) => IWalletManager
