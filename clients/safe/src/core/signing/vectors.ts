import type { ITypedData } from '@/core/transaction'
import { toChainId, type Address } from '@/core/types'

/**
 * Reference data for signature checks.
 *
 * Every value is taken from the text of the relevant standard, not
 * produced by running our own code. That is essential: a test that
 * expects what the implementation emitted only checks that it did
 * not change, not that it is correct.
 */

/**
 * Official example from the EIP-155 text.
 *
 * Given in the standard itself as an illustration of replay
 * protection. Checks the whole chain: RLP serialisation, inclusion of
 * chainId in the signed data, and formation of `v`.
 */
export const EIP155_VECTOR = {
  privateKeyHex: '4646464646464646464646464646464646464646464646464646464646464646',
  from: '0x9d8A62f656a8d1615C1294fd71e9CFb3E4855A4F' as Address,
  chainId: toChainId(1),
  nonce: 9,
  gasPrice: 20_000_000_000n,
  gasLimit: 21_000n,
  to: '0x3535353535353535353535353535353535353535' as Address,
  value: 1_000_000_000_000_000_000n,
  signedRaw:
    '0xf86c098504a817c800825208943535353535353535353535353535353535353535880de0b6b3a76400008025a028ef61340bd939bc2195fe537567866003e1a15d3c71ff63e1590620aa636276a067cbe9d8997f761aecb703304b3800ccf555c9f3dc64214b297fb1966a3b6d83',
} as const

/**
 * Structure example from the EIP-712 text.
 *
 * The standard gives a digest for it, which lets encoding be checked
 * independently of the signature implementation.
 */
export const EIP712_MAIL: ITypedData = {
  domain: {
    name: 'Ether Mail',
    version: '1',
    chainId: toChainId(1),
    verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC' as Address,
  },
  types: {
    Person: [
      { name: 'name', type: 'string' },
      { name: 'wallet', type: 'address' },
    ],
    Mail: [
      { name: 'from', type: 'Person' },
      { name: 'to', type: 'Person' },
      { name: 'contents', type: 'string' },
    ],
  },
  primaryType: 'Mail',
  message: {
    from: { name: 'Cow', wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826' },
    to: { name: 'Bob', wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' },
    contents: 'Hello, Bob!',
  },
}

/** Digest of the `Mail` example, given in the EIP-712 text. */
export const EIP712_MAIL_HASH = '0xbe609aee343fb3c4b28e1df9e632fca64fcfaede20f02e86244efddf30957bd2'

/** Private key equal to one. Its address is widely known. */
export const KEY_ONE_HEX = '0000000000000000000000000000000000000000000000000000000000000001'

export const KEY_ONE_ADDRESS = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf' as Address

/** Converts a hex string to bytes. Tests only. */
export function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }

  return bytes
}
