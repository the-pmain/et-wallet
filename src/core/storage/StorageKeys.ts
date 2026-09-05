import { InvalidArgumentError } from '@/core/errors'

import type { StorageKey } from './types'

/**
 * Creates a storage key.
 *
 * The only allowed way to obtain a `StorageKey`. The constructor's
 * existence matters more than its simplicity: it makes the key list
 * centralizable. String literals scattered through the code inevitably
 * lead to collisions and to "lost" records that nobody reads.
 *
 * @throws InvalidArgumentError if the key is empty.
 */
export function toStorageKey(value: string): StorageKey {
  if (value.length === 0) {
    throw new InvalidArgumentError('storageKey', 'the key cannot be empty')
  }

  return value as StorageKey
}

/**
 * Application settings keys.
 *
 * The `Settings` namespace stores scalar values that do not belong
 * to any collection. All such keys are declared here.
 */
export const SETTINGS_KEY = {
  /** Active network id, as a decimal string. */
  ActiveChainId: toStorageKey('network.activeChainId'),

  /**
   * Consent to call a third-party price source.
   *
   * A missing key means "never asked" and is equivalent to refusal:
   * prices are not requested until the user allows it explicitly.
   * A price request names a contract address to the service, i.e.
   * discloses the portfolio, and that decision belongs to the owner
   * of the funds, not to a default in the code.
   */
  PricesEnabled: toStorageKey('prices.enabled'),

  /**
   * Consent to call a third-party simulation source.
   *
   * SEPARATE FROM PRICE CONSENT, AND THAT IS NOT FORMALITY. Prices
   * receive the portfolio — what the owner already holds. Simulation
   * receives INTENT: address, recipient, amount, and call data,
   * before signing, including transactions the owner later declined.
   * Consent to the first is not consent to the second.
   */
  SimulationSourceEnabled: toStorageKey('simulation.sourceEnabled'),

  /**
   * Tenderly credentials entered by the owner.
   *
   * THEY LIVE IN THE ENCRYPTED NAMESPACE, because an access key is
   * a secret: whoever has it spends someone else's quota and reads
   * the project's simulation history.
   *
   * EACH OWNER'S KEY IS THEIR OWN, NOT SHARED ACROSS THE BUILD. A
   * key baked into the build belongs to anyone who opened the wallet:
   * it sits in the program text. Then the account would be shared,
   * and the operator would see the combined stream of every user's
   * intents under one account.
   */
  TenderlyAccount: toStorageKey('simulation.tenderly.account'),
  TenderlyProject: toStorageKey('simulation.tenderly.project'),
  TenderlyAccessKey: toStorageKey('simulation.tenderly.accessKey'),

  /**
   * User name — the wallet's label in the UI.
   *
   * THIS IS A LABEL, NOT AN ACCOUNT: there is no server that would
   * check a name–password pair. Stored in the protected namespace
   * because it ties the device to how the owner calls themselves,
   * and it must not sit next to open settings.
   */
  UserName: toStorageKey('user.name'),

  /**
   * Former key that held an email address.
   *
   * KEPT FOR WALLETS CREATED BEFORE EMAIL WAS REPLACED BY A NAME.
   * The value is read once — to use it as a name — and is never
   * written again. Removing the key from the code would silently
   * drop the label on those older wallets.
   */
  UserEmail: toStorageKey('user.email'),

  /**
   * Row id in the `public.users` table.
   *
   * Needed so that after leaving the cabinet the record can be
   * opened via `GET /v1/users/:id` instead of being created again.
   * Lives in the protected namespace: without the storage password
   * it cannot be read, and `localStorage` is wiped on logout.
   */
  RemoteUserId: toStorageKey('user.remoteId'),

  /**
   * Occupied-address discovery has already run.
   *
   * WHY REMEMBER. Discovery tells the node operator about twenty
   * addresses at once and links them together — something a wallet
   * usually tries not to do. Once is justified: without it a restored
   * wallet silently loses accounts. On every launch — no longer.
   */
  AccountsDiscovered: toStorageKey('accounts.discovered'),

  /** Chosen UI language. Not a secret. */
  Language: toStorageKey('ui.language'),

  /** Idle time before auto-lock, in milliseconds. */
  AutoLockTimeoutMs: toStorageKey('security.autoLockTimeoutMs'),

  /**
   * Password-attempt throttle state.
   *
   * LIVES IN UNENCRYPTED SETTINGS OUT OF NECESSITY. The throttle
   * must work before unlock, i.e. when the decryption key is not
   * yet derived and encrypted storage is unavailable.
   *
   * The consequence is named outright: whoever has disk access can
   * zero the counter. The throttle is not built against them —
   * resistance of key derivation protects against guessing on a
   * stolen storage copy.
   */
  UnlockThrottle: toStorageKey('security.unlockThrottle'),

  /**
   * Require a password before signing a transaction.
   *
   * A missing record means "on": protection that is off by default
   * is not protection.
   */
  ConfirmBeforeSigning: toStorageKey('security.confirmBeforeSigning'),
} as const

/**
 * Encrypted key-vault keys.
 *
 * Declared here, not in the module that writes them, because there
 * is more than one reader: onboarding writes the mnemonic, and the
 * wallet-session layer reads it when deriving the HD tree. A string
 * literal duplicated in two places drifts on the first rename, and
 * the wallet stops finding its own phrase.
 */
export const VAULT_KEY = {
  /** BIP-39 mnemonic as a string. */
  Mnemonic: toStorageKey('wallet.mnemonic'),
} as const
