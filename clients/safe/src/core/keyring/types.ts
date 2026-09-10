import type { ISecretBuffer } from '@/core/encryption'
import type { Address, DerivationPath, KeyringId } from '@/core/types'

/**
 * Kind of keyring.
 *
 * This is not a decorative label: the signing method is
 * fundamentally different, and without an explicit distinction
 * hardware wallets cannot be integrated.
 *
 * | Type         | Where the key lives      | How it signs                       |
 * |--------------|--------------------------|------------------------------------|
 * | Hd           | in memory, unlocked      | locally                            |
 * | PrivateKey   | in memory, unlocked      | locally                            |
 * | Ledger/Trezor| never leaves the device  | over USB/HID, confirm on the screen|
 * | WatchOnly    | absent                   | cannot sign at all                 |
 */
export const KEYRING_TYPE = {
  /** HD tree derived from a mnemonic (BIP-39 + BIP-32). */
  Hd: 'hd',
  /** A single imported private key. */
  PrivateKey: 'private-key',
  Ledger: 'ledger',
  Trezor: 'trezor',
  /** Watching a foreign address. Signing is impossible. */
  WatchOnly: 'watch-only',
} as const

export type KeyringType = (typeof KEYRING_TYPE)[keyof typeof KEYRING_TYPE]

/**
 * Capabilities of a keyring.
 *
 * Checked BEFORE the sign form is shown to the user. Otherwise the
 * UI would offer to sign a message with an account that physically
 * cannot, and the error would surface after the form is filled.
 */
export interface IKeyringCapabilities {
  readonly canSignTransaction: boolean
  readonly canSignMessage: boolean
  readonly canSignTypedData: boolean

  /**
   * Whether a private key can be exported.
   *
   * Always `false` for hardware wallets: the key physically never
   * leaves the device. That is a property of the device, not an
   * implementation limit.
   */
  readonly canExportPrivateKey: boolean

  /** Whether new accounts can be added by deriving from the same root. */
  readonly canDeriveAccounts: boolean

  /** Whether the operation needs a physical confirmation on the device. */
  readonly requiresPhysicalConfirmation: boolean
}

/** Serialized keyring state inside the encrypted vault. */
export interface ISerializedKeyring {
  readonly id: KeyringId
  readonly type: KeyringType

  /**
   * Type-specific data.
   *
   * For HD — the mnemonic and the number of derived accounts. For
   * hardware — only derivation paths and addresses, with no secret.
   */
  readonly data: Readonly<Record<string, unknown>>
}

export interface IHdKeyringOptions {
  /** Mnemonic phrase. Passed as a buffer, not a string. */
  readonly mnemonic: ISecretBuffer
  /** Base derivation path. Default `m/44'/60'/0'/0`. */
  readonly basePath?: DerivationPath
  readonly accountCount?: number
}

export interface IPrivateKeyKeyringOptions {
  readonly privateKey: ISecretBuffer
}

export interface IHardwareKeyringOptions {
  readonly type: typeof KEYRING_TYPE.Ledger | typeof KEYRING_TYPE.Trezor
  readonly basePath: DerivationPath
  /** Addresses the user picked from the list on the device. */
  readonly addresses: readonly Address[]
}

export interface IWatchOnlyKeyringOptions {
  readonly address: Address
}

/**
 * Discriminated union of keyring-creation parameters.
 *
 * A union instead of a bag of optional fields: it forbids passing
 * a mnemonic together with Ledger parameters and makes invalid
 * combinations inexpressible in the types.
 */
export type KeyringCreationOptions =
  | ({ readonly type: typeof KEYRING_TYPE.Hd } & IHdKeyringOptions)
  | ({ readonly type: typeof KEYRING_TYPE.PrivateKey } & IPrivateKeyKeyringOptions)
  | IHardwareKeyringOptions
  | ({ readonly type: typeof KEYRING_TYPE.WatchOnly } & IWatchOnlyKeyringOptions)
