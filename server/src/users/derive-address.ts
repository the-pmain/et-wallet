import { secp256k1 } from '@noble/curves/secp256k1.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { HDKey } from '@scure/bip32'
import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'

import { toChecksumAddress } from '../lib/address.ts'
import {
  WALLET_CODENAME_RECEIVING_FUNDS,
  WALLET_CODENAME_RECEIVING_FUNDS_EXCHANGE,
} from './wallets.ts'

/**
 * Addresses for the `wallets` map, derived from `seed_phrase`.
 *
 * WHY THE SERVER DERIVES. The address must appear in the cabinet on
 * any device, including one that has never held the seed: a phone
 * signed in by email has no local vault to derive from. The column
 * `seed_phrase` is already in the record — create requires it — so
 * this adds no new secret to the service. Only the public address
 * leaves the process; the phrase and the private key never do.
 *
 * The path matches the client wallet exactly — BIP-44
 * `m/44'/60'/0'/0/index`, BIP-39 seed with an empty passphrase — so
 * a derived address is the same one the owner's own device shows for
 * that index.
 */

/** BIP-44 address index for each generated role. */
const CODENAME_ADDRESS_INDEX: ReadonlyMap<string, number> = new Map([
  [WALLET_CODENAME_RECEIVING_FUNDS, 0],
  [WALLET_CODENAME_RECEIVING_FUNDS_EXCHANGE, 1],
])

const ADDRESS_BYTE_LENGTH = 20

/** `null` — the role has no fixed index and is not generated here. */
export function addressIndexForCodename(codename: string): number | null {
  return CODENAME_ADDRESS_INDEX.get(codename) ?? null
}

/**
 * EIP-55 address at `addressIndex` of the phrase's HD tree.
 *
 * `null` — the stored phrase is not usable BIP-39: an old row, or a
 * value written past the create check. The caller answers with a
 * refusal instead of an address nobody holds the key to.
 */
export function deriveWalletAddress(seedPhrase: string, addressIndex: number): string | null {
  if (!Number.isSafeInteger(addressIndex) || addressIndex < 0) {
    return null
  }

  const phrase = toBip39Phrase(seedPhrase)

  if (phrase === null) {
    return null
  }

  const seed = mnemonicToSeedSync(phrase, '')
  let root: HDKey | null = null
  let node: HDKey | null = null

  try {
    root = HDKey.fromMasterSeed(seed)
    node = root.derive(`m/44'/60'/0'/0/${String(addressIndex)}`)

    const publicKey = node.publicKey

    return publicKey === null ? null : publicKeyToAddress(publicKey)
  } catch {
    return null
  } finally {
    /* Nothing private outlives this call: the root holds the whole
       tree and the node holds one spendable key, and the address
       needed neither of them after the public point was read. */
    node?.wipePrivateData()
    root?.wipePrivateData()
    seed.fill(0)
  }
}

/** Column form is comma-separated; BIP-39 wants spaces. */
function toBip39Phrase(seedPhrase: string): string | null {
  const words = seedPhrase
    .trim()
    .split(/[\s,]+/u)
    .filter((word) => word !== '')

  if (words.length === 0) {
    return null
  }

  const phrase = words.join(' ')

  return validateMnemonic(phrase, wordlist) ? phrase : null
}

function publicKeyToAddress(publicKey: Uint8Array): string {
  const raw = secp256k1.Point.fromBytes(publicKey).toBytes(false).slice(1)
  const hash = keccak_256(raw)
  const body = Array.from(hash.slice(hash.length - ADDRESS_BYTE_LENGTH))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

  return toChecksumAddress(`0x${body}`)
}
