/**
 * Official BIP-39 test vectors.
 *
 * Source: the reference set from the Trezor repository
 * (python-mnemonic), which the BIP-39 text itself cites. The
 * passphrase in every vector is the string `TREZOR`.
 *
 * Why they are here if `@scure/bip39` is already checked against
 * these same vectors: the tests protect the wrapper, not the
 * library. Input normalisation, the order of conversions, buffer
 * handling — that is our code, and a bug in it yields a wrong seed
 * with a formally correct library.
 *
 * The file has no `.test.ts` extension on purpose: it is data used
 * by several test files.
 */

export interface IBip39Vector {
  readonly entropy: string
  readonly mnemonic: string
  /** Expected seed with passphrase `TREZOR`. `null` if not checked. */
  readonly seed: string | null
}

export const TREZOR_PASSPHRASE = 'TREZOR'

export const BIP39_VECTORS: readonly IBip39Vector[] = [
  {
    entropy: '00000000000000000000000000000000',
    mnemonic:
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    seed: 'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04',
  },
  {
    entropy: '7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f',
    mnemonic: 'legal winner thank year wave sausage worth useful legal winner thank yellow',
    seed: '2e8905819b8723fe2c1d161860e5ee1830318dbf49a83bd451cfb8440c28bd6fa457fe1296106559a3c80937a1c1069be3a3a5bd381ee6260e8d9739fce1f607',
  },
  {
    entropy: '80808080808080808080808080808080',
    mnemonic: 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above',
    seed: null,
  },
  {
    entropy: 'ffffffffffffffffffffffffffffffff',
    mnemonic: 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',
    seed: null,
  },
  {
    entropy: '0000000000000000000000000000000000000000000000000000000000000000',
    mnemonic:
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art',
    seed: null,
  },
  {
    entropy: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    mnemonic:
      'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo vote',
    seed: null,
  },
]

/** Hex string to bytes. Tests only. */
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }

  return bytes
}

/** Bytes to a hex string. Tests only. */
export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
