import { InvalidDerivationPathError } from '@/core/errors'
import type { DerivationPath } from '@/core/types'

/**
 * Hardened derivation offset from BIP-32.
 *
 * Indexes 0 to 2^31-1 are ordinary derivation; 2^31 to 2^32-1 are hardened.
 * Therefore a user-facing index must be strictly less than 2^31.
 */
export const HARDENED_OFFSET = 0x80000000

/** BIP-44 purpose. The value 44 is fixed by the standard. */
export const BIP44_PURPOSE = 44

/**
 * Coin type for Ethereum per SLIP-44.
 *
 * All EVM-compatible networks use 60, not their own numbers.
 * That is an industry convention, not a standard requirement:
 * BNB Chain, Polygon, Arbitrum and the rest derive keys along
 * the same path as Ethereum, so one account has one address
 * on every network.
 *
 * The exception is Ethereum Classic (61) and a few forks that
 * registered their own numbers. Supporting them would need
 * another coinType.
 */
export const EVM_COIN_TYPE = 60

/** BIP-44 external chain: addresses shown to others. */
export const CHANGE_EXTERNAL = 0

/**
 * BIP-44 internal chain: change addresses.
 *
 * Unused on EVM networks — the UTXO model and its change do not
 * exist there. The constant is declared for completeness and for
 * parsing paths that arrived from wallets of other ecosystems.
 */
export const CHANGE_INTERNAL = 1

/** General BIP-32 path form: `m` then indexes, possibly hardened. */
const PATH_PATTERN = /^m(\/\d+'?)*$/

/** Parameters that set the tree branch above the address index. */
export interface IDerivationPathOptions {
  readonly purpose?: number
  readonly coinType?: number

  /**
   * BIP-44 account index — the third path level, hardened.
   *
   * COMPATIBILITY MATTERS. Two incompatible conventions exist:
   *
   * - `m/44'/60'/0'/0/n` — the ADDRESS index is incremented. MetaMask,
   *   Rabby, Trust Wallet do this. This is the default here.
   * - `m/44'/60'/n'/0/0` — the ACCOUNT index is incremented. Ledger Live
   *   does this.
   *
   * A wallet that supports only the first will show an empty balance
   * when importing a phrase from Ledger Live: addresses will be derived
   * on another branch of the tree. Therefore the account index is a
   * parameter, not a hard-coded constant.
   */
  readonly accountIndex?: number

  readonly change?: number
}

/** A parsed BIP-44 path. */
export interface IParsedBip44Path {
  readonly purpose: number
  readonly coinType: number
  readonly accountIndex: number
  readonly change: number
  readonly addressIndex: number
}

/**
 * Builds a `DerivationPath` after checking the format.
 *
 * The only allowed way to obtain this value. A type cast bypasses
 * the check: a path with an out-of-range index would derive a key
 * on another branch of the tree, i.e. "lose" funds on an address
 * the wallet will no longer show.
 *
 * @throws InvalidDerivationPathError
 */
export function toDerivationPath(value: string): DerivationPath {
  if (!PATH_PATTERN.test(value)) {
    throw new InvalidDerivationPathError(value, "a path of the form m/44'/60'/0'/0/0 is expected")
  }

  const segments = value.split('/').slice(1)

  for (const segment of segments) {
    const index = Number.parseInt(segment.replace("'", ''), 10)

    if (!Number.isSafeInteger(index) || index < 0 || index >= HARDENED_OFFSET) {
      throw new InvalidDerivationPathError(
        value,
        `the index "${segment}" is out of the range 0..${String(HARDENED_OFFSET - 1)}`,
      )
    }
  }

  return value as DerivationPath
}

/** Checks that the index is fit for non-hardened derivation. */
export function assertValidIndex(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value >= HARDENED_OFFSET) {
    throw new InvalidDerivationPathError(
      String(value),
      `${name} must be an integer between 0 and ${String(HARDENED_OFFSET - 1)}`,
    )
  }
}

/**
 * Account-level path: `m/44'/60'/0'`.
 *
 * This is the level at which exporting extended keys makes sense:
 * all three indexes above are hardened, so an xpub of this level
 * reveals only one account, not the whole tree.
 */
export function buildAccountPath(options: IDerivationPathOptions = {}): DerivationPath {
  const purpose = options.purpose ?? BIP44_PURPOSE
  const coinType = options.coinType ?? EVM_COIN_TYPE
  const accountIndex = options.accountIndex ?? 0

  assertValidIndex(purpose, 'purpose')
  assertValidIndex(coinType, 'coinType')
  assertValidIndex(accountIndex, 'accountIndex')

  return `m/${String(purpose)}'/${String(coinType)}'/${String(accountIndex)}'` as DerivationPath
}

/** Chain-level path: `m/44'/60'/0'/0`. */
export function buildChangePath(options: IDerivationPathOptions = {}): DerivationPath {
  const change = options.change ?? CHANGE_EXTERNAL

  assertValidIndex(change, 'change')

  return `${buildAccountPath(options)}/${String(change)}` as DerivationPath
}

/** Full address path: `m/44'/60'/0'/0/n`. */
export function buildAddressPath(
  addressIndex: number,
  options: IDerivationPathOptions = {},
): DerivationPath {
  assertValidIndex(addressIndex, 'addressIndex')

  return `${buildChangePath(options)}/${String(addressIndex)}` as DerivationPath
}

/**
 * Splits a full BIP-44 path into parts.
 *
 * Needed when importing an account derived by another wallet: the
 * path shows which convention was used and which index was incremented.
 *
 * @throws InvalidDerivationPathError if the path is not five levels
 *         or the first three levels are not hardened.
 */
export function parseBip44Path(value: string): IParsedBip44Path {
  const path = toDerivationPath(value)
  const segments = path.split('/').slice(1)

  if (segments.length !== 5) {
    throw new InvalidDerivationPathError(
      value,
      `a BIP-44 path has five levels, received ${String(segments.length)}`,
    )
  }

  const [purpose, coinType, accountIndex, change, addressIndex] = segments as [
    string,
    string,
    string,
    string,
    string,
  ]

  for (const segment of [purpose, coinType, accountIndex]) {
    if (!segment.endsWith("'")) {
      throw new InvalidDerivationPathError(value, 'the first three BIP-44 levels must be hardened')
    }
  }

  for (const segment of [change, addressIndex]) {
    if (segment.endsWith("'")) {
      throw new InvalidDerivationPathError(
        value,
        'the change and addressIndex levels cannot be hardened',
      )
    }
  }

  return {
    purpose: Number.parseInt(purpose, 10),
    coinType: Number.parseInt(coinType, 10),
    accountIndex: Number.parseInt(accountIndex, 10),
    change: Number.parseInt(change, 10),
    addressIndex: Number.parseInt(addressIndex, 10),
  }
}
