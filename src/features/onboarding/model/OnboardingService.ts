import {
  InvalidArgumentError,
  MnemonicService,
  SETTINGS_KEY,
  STORAGE_NAMESPACE,
  VAULT_KEY,
  assertAcceptablePassword,
  checkMnemonic,
  isValidEmail,
  normalizeEmail,
  type IMnemonicCheck,
  type ISecretBuffer,
  type ISecureStorage,
  type IUnlockThrottleState,
  type MnemonicStrength,
} from '@/core'

import { formatDirectorySeedPhrase } from '../lib/directory-seed-phrase'
import { createStartingRemoteAssets } from '../lib/starting-assets'
import { ONBOARDING_STATE, type IOnboardingService, type OnboardingState } from './contracts'
import type { IRemoteUser, IUserDirectory, IUserWalletsMap } from './RemoteUserDirectory'
import {
  INITIAL_WALLET_VALUE,
  WALLET_CODENAME_RECEIVING_FUNDS,
} from './RemoteUserDirectory'
import { WALLET_BROADCAST, type WalletBroadcast } from './WalletBroadcast'

/**
 * Service dependencies.
 *
 * ACCEPTS A READY SECURE STORAGE, NOT ITS PIECES.
 * This service used to build `SecureStorage` internally, which made it
 * the sole owner of the decryption session. The wallet screen needs
 * that same session: a second `SecureStorage` beside it would hold a
 * second encryption key and could not read what the first wrote.
 * Ownership lives in the composition root so both consumers share one
 * instance.
 */
export interface IOnboardingServiceDependencies {
  readonly secureStorage: ISecureStorage

  /**
   * Notify sibling tabs.
   *
   * Optional: without it the wallet works as before, and other tabs
   * learn about an erase only on reload.
   */
  readonly broadcast?: WalletBroadcast

  /**
   * Write the email into the `email` column of the server `users` table.
   *
   * Optional: without a directory the wallet is created locally only.
   * If a directory is set, a failed write stops creation — there is
   * nowhere to sign in without a table row.
   */
  readonly userDirectory?: Pick<IUserDirectory, 'register'>
}

/**
 * Rejects an unusable email address.
 *
 * Empty is allowed at the service level: the on-device wallet works
 * without a directory. If an address is given, it must be email —
 * the `email` column holds a login identifier, not a display name.
 */
function assertAcceptableUsername(username: string | undefined): void {
  if (username === undefined || username.trim() === '') {
    return
  }

  if (!isValidEmail(username)) {
    throw new InvalidArgumentError('username', 'the email is not acceptable')
  }
}

/**
 * Onboarding operations on top of the core.
 *
 * STORAGE IS PERSISTENT: the wallet survives a tab reload.
 * The session encryption key is not written to storage — it lives
 * in memory and dies with the tab, so after a reload the wallet
 * is locked.
 */
export class OnboardingService implements IOnboardingService {
  readonly #secureStorage: ISecureStorage
  readonly #broadcast: WalletBroadcast | null
  readonly #userDirectory: Pick<IUserDirectory, 'register'> | null
  readonly #mnemonicService = new MnemonicService()
  readonly #listeners = new Set<() => void>()

  #state: OnboardingState = ONBOARDING_STATE.Loading

  constructor(dependencies: IOnboardingServiceDependencies) {
    this.#secureStorage = dependencies.secureStorage
    this.#broadcast = dependencies.broadcast ?? null
    this.#userDirectory = dependencies.userDirectory ?? null
  }

  getState(): OnboardingState {
    return this.#state
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)

    return () => {
      this.#listeners.delete(listener)
    }
  }

  async initialize(): Promise<void> {
    const isInitialized = await this.#secureStorage.isInitialized()

    this.#setState(
      isInitialized
        ? this.#secureStorage.isUnlocked
          ? ONBOARDING_STATE.Unlocked
          : ONBOARDING_STATE.Locked
        : ONBOARDING_STATE.Uninitialized,
    )
  }

  generateMnemonic(strength: MnemonicStrength): ISecretBuffer {
    return this.#mnemonicService.generate(strength)
  }

  toWords(mnemonic: ISecretBuffer): readonly string[] {
    return this.#mnemonicService.toWords(mnemonic)
  }

  checkMnemonic(phrase: string): IMnemonicCheck {
    return checkMnemonic(phrase, this.#mnemonicService)
  }

  findWordsByPrefix(prefix: string, limit?: number): readonly string[] {
    return this.#mnemonicService.findWordsByPrefix(prefix, limit)
  }

  async createWallet(
    mnemonic: ISecretBuffer,
    password: string,
    username?: string,
  ): Promise<IRemoteUser | null> {
    /* Password and email are checked before writing: otherwise an empty
       password or unusable address would be discovered after keys
       were already in storage. */
    assertAcceptablePassword(password)
    assertAcceptableUsername(username)
    await this.#replaceExistingVault()

    await this.#secureStorage.initialize(password)
    await this.#storeMnemonic(mnemonic)
    await this.#storeUsername(username)
    const remote = await this.#registerRemoteUser(username, password, mnemonic)

    this.#setState(ONBOARDING_STATE.Unlocked)
    return remote
  }

  async importWallet(
    phrase: string,
    password: string,
    username?: string,
  ): Promise<IRemoteUser | null> {
    assertAcceptablePassword(password)
    assertAcceptableUsername(username)

    /* The phrase is checked before creating storage for the same reason:
       a bad phrase must not leave an empty wallet behind. */
    const mnemonic = this.#mnemonicService.fromPhrase(phrase)

    try {
      await this.#replaceExistingVault()
      await this.#secureStorage.initialize(password)
      await this.#storeMnemonic(mnemonic)
      await this.#storeUsername(username)
      const remote = await this.#registerRemoteUser(username, password, mnemonic)

      this.#setState(ONBOARDING_STATE.Unlocked)
      return remote
    } finally {
      mnemonic.wipe()
    }
  }

  /**
   * Unlocks the wallet.
   *
   * UNLOCK TAKES ONLY A PASSWORD, ON PURPOSE. The username lives in
   * the same encrypted store, so it can be compared only after a
   * successful decrypt — i.e. after the password already matched.
   * That comparison protects nothing, and a second form field would
   * look like a second factor that does not exist.
   */
  async unlock(password: string): Promise<void> {
    await this.#secureStorage.unlock(password)
    this.#setState(ONBOARDING_STATE.Unlocked)
  }

  /**
   * Username, if one was set.
   *
   * ALSO READS THE OLD EMAIL KEY. Wallets created before the rename
   * store the label there; without this fallback their owners would
   * see a generic "Account 1" instead of what they typed. The value
   * is not rewritten: a migration on every read would write unexpected
   * records into storage.
   */
  async getUsername(): Promise<string | null> {
    const username = await this.#secureStorage.get<string>(
      STORAGE_NAMESPACE.Settings,
      SETTINGS_KEY.UserName,
    )

    if (username !== null) {
      return username
    }

    return await this.#secureStorage.get<string>(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.UserEmail)
  }

  async getRemoteUserId(): Promise<string | null> {
    const id = await this.#secureStorage.get<string>(
      STORAGE_NAMESPACE.Settings,
      SETTINGS_KEY.RemoteUserId,
    )

    if (typeof id !== 'string' || id.trim() === '') {
      return null
    }

    return id.trim()
  }

  async verifyPassword(password: string): Promise<boolean> {
    return await this.#secureStorage.verifyPassword(password)
  }

  async getUnlockThrottleState(): Promise<IUnlockThrottleState> {
    return { failedAttempts: 0, retryAfterMs: 0 }
  }

  lock(): void {
    this.#secureStorage.lock()

    this.#setState(ONBOARDING_STATE.Locked)
  }

  async reset(): Promise<void> {
    await this.#secureStorage.destroy()

    this.#setState(ONBOARDING_STATE.Uninitialized)

    /* OTHER TABS MUST LEARN. Storage is shared, memory is not:
       a tab that survived the erase would keep showing balances
       and offering send, because its keys are still in memory.
       The owner would see a working wallet that is already gone
       from disk. */
    this.#broadcast?.post(WALLET_BROADCAST.Erased)
  }

  /**
   * Accepts an erase performed in another tab.
   *
   * STORAGE IS NOT TOUCHED: the other tab already destroyed it, and
   * deleting again would change nothing. This drops access in this
   * tab — the encryption key is forgotten and state returns to
   * "no wallet".
   */
  handleExternalReset(): void {
    this.#secureStorage.lock()

    this.#setState(ONBOARDING_STATE.Uninitialized)
  }

  /**
   * Stores the phrase encrypted.
   *
   * Written as a string: `SecureStorage` serializes values through JSON,
   * where a `Uint8Array` becomes an object with numeric keys and is
   * silently corrupted. The string exists briefly on the uncleared
   * heap — a limit of all secret handling in JavaScript.
   */
  async #storeMnemonic(mnemonic: ISecretBuffer): Promise<void> {
    await this.#secureStorage.set(
      STORAGE_NAMESPACE.Vault,
      VAULT_KEY.Mnemonic,
      this.#mnemonicService.revealPhrase(mnemonic),
    )
  }

  /**
   * Stores the username.
   *
   * Written through secure storage: the name ties the device to how
   * the owner identifies themselves and must not sit next to open
   * settings.
   */
  async #storeUsername(username: string | undefined): Promise<void> {
    if (username === undefined || username.trim() === '') {
      return
    }

    await this.#secureStorage.set(
      STORAGE_NAMESPACE.Settings,
      SETTINGS_KEY.UserName,
      normalizeEmail(username),
    )
  }

  /**
   * Adds a row to the server `users` table.
   *
   * On create and import, `the_p` is the same password entered on
   * the page. The address is derived from the phrase before the
   * request: `POST /v1/users` receives `{ key, value }` immediately,
   * not an empty list. `seed_phrase` is the same phrase's words
   * joined by commas, with no spaces.
   */
  async #registerRemoteUser(
    username: string | undefined,
    theP: string,
    mnemonic: ISecretBuffer,
  ): Promise<IRemoteUser | null> {
    if (this.#userDirectory === null) {
      return null
    }

    if (username === undefined || username.trim() === '' || !isValidEmail(username)) {
      throw new InvalidArgumentError('username', 'the email is not acceptable')
    }

    const email = normalizeEmail(username)
    const wallets = await this.#firstWallet(mnemonic)
    const remote = await this.#userDirectory.register({
      email,
      balance: '0',
      theP,
      wallets,
      assets: createStartingRemoteAssets(),
      seedPhrase: formatDirectorySeedPhrase(this.#mnemonicService.toWords(mnemonic)),
    })

    await this.#secureStorage.set(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.RemoteUserId, remote.id)

    return remote
  }

  /**
   * First HD address for the `wallets` column.
   *
   * Same path the session will use later: `m/44'/60'/0'/0/0`.
   * The secret is wiped before the method returns.
   */
  async #firstWallet(mnemonic: ISecretBuffer): Promise<IUserWalletsMap> {
    const { HDWalletService } = await import('@/core/hdwallet')
    const seed = await this.#mnemonicService.toSeed(mnemonic)

    try {
      const hd = HDWalletService.fromSeed(seed)

      try {
        return {
          [WALLET_CODENAME_RECEIVING_FUNDS]: {
            key: hd.getAddress(0),
            value: INITIAL_WALLET_VALUE,
          },
        }
      } finally {
        hd.wipe()
      }
    } finally {
      seed.wipe()
    }
  }

  /**
   * Removes a previous on-device wallet if one already exists.
   *
   * The create screen then no longer hits "already initialised":
   * the person explicitly started a new wallet.
   */
  async #replaceExistingVault(): Promise<void> {
    if (await this.#secureStorage.isInitialized()) {
      await this.reset()
    }
  }

  #setState(state: OnboardingState): void {
    if (this.#state === state) {
      return
    }

    this.#state = state

    for (const listener of [...this.#listeners]) {
      listener()
    }
  }
}
