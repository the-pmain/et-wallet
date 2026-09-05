import { SETTINGS_KEY, STORAGE_NAMESPACE, type IStorageService } from '@/core'

/**
 * Allowed auto-lock timeouts.
 *
 * The list is closed, not a free number: an input field would let
 * someone set a day and turn the protection into its appearance.
 * Values are chosen so the longest one still means something.
 */
export const AUTO_LOCK_OPTIONS: readonly number[] = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
  60 * 60_000,
]

export const DEFAULT_AUTO_LOCK_MS = 15 * 60_000

/** Security settings persisted across sessions. */
export interface ISecuritySettings {
  readonly autoLockTimeoutMs: number

  readonly confirmBeforeSigning: boolean
}

export const DEFAULT_SECURITY_SETTINGS: ISecuritySettings = {
  autoLockTimeoutMs: DEFAULT_AUTO_LOCK_MS,
  confirmBeforeSigning: true,
}

/**
 * Read and write security settings.
 *
 * STORED IN UNENCRYPTED STORAGE ON PURPOSE. The auto-lock timeout
 * is needed before unlock — otherwise the wallet would not know
 * when to lock until the user typed the password. These values
 * are not a secret: knowing that lock happens in fifteen minutes
 * gives an attacker without the password nothing.
 *
 * A GARBLED VALUE IS REPLACED WITH THE DEFAULT, NOT ACCEPTED.
 * A corrupted record — a negative timeout, for example — would
 * otherwise disable auto-lock for good.
 */
export class SecuritySettingsRepository {
  readonly #storage: IStorageService

  constructor(storage: IStorageService) {
    this.#storage = storage
  }

  async read(): Promise<ISecuritySettings> {
    const [timeout, confirm] = await Promise.all([
      this.#storage.get<number>(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.AutoLockTimeoutMs),
      this.#storage.get<boolean>(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.ConfirmBeforeSigning),
    ])

    return {
      autoLockTimeoutMs: isAllowedTimeout(timeout) ? timeout : DEFAULT_AUTO_LOCK_MS,
      /* A missing record means "on": a protection that is off by
         default is not a protection. */
      confirmBeforeSigning: confirm !== false,
    }
  }

  async setAutoLockTimeout(timeoutMs: number): Promise<void> {
    if (!isAllowedTimeout(timeoutMs)) {
      throw new Error('The auto-lock timeout is not allowed.')
    }

    await this.#storage.set(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.AutoLockTimeoutMs, timeoutMs)
  }

  async setConfirmBeforeSigning(enabled: boolean): Promise<void> {
    await this.#storage.set(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.ConfirmBeforeSigning, enabled)
  }
}

function isAllowedTimeout(value: number | null): value is number {
  return value !== null && AUTO_LOCK_OPTIONS.includes(value)
}
