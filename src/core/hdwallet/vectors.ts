/**
 * Reference test data for the HD wallet.
 *
 * The check strategy is layered, not "phrase to address in one go".
 * There are three layers, each checked against its own recognised
 * data set:
 *
 * 1. BIP-32 derivation — official vectors from the BIP-32 text
 *    (extended keys are compared as base58 strings).
 * 2. EIP-55 checksum — examples from the EIP text itself.
 * 3. The composition "mnemonic -> address" — well-known addresses
 *    of the test phrase `abandon ... about`.
 *
 * The point of the split: a mismatch shows immediately which layer
 * is broken. A single end-to-end test would show only that
 * something broke.
 */

/** Official vector 1 from the BIP-32 text. */
export const BIP32_VECTOR_1 = {
  seedHex: '000102030405060708090a0b0c0d0e0f',
  masterXprv:
    'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi',
  masterXpub:
    'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8',
} as const

/**
 * Checksum examples from the EIP-55 text.
 *
 * These four addresses are the ones the standard itself gives as
 * references.
 */
export const EIP55_ADDRESSES: readonly string[] = [
  '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
  '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
  '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
  '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
]

/**
 * Test mnemonic phrase.
 *
 * Corresponds to zero entropy and is used as a reference across
 * the industry. MUST NOT BE USED FOR REAL FUNDS: the private keys
 * of this phrase are known to everyone, and any incoming funds to
 * its addresses are swept by bots within seconds.
 */
export const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

/**
 * Addresses of the test phrase on path `m/44'/60'/0'/0/n` with an
 * empty passphrase.
 *
 * They match what MetaMask, Rabby, and Trust Wallet show when this
 * mnemonic is imported.
 */
export const TEST_MNEMONIC_ADDRESSES: readonly string[] = [
  '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
  '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0',
  '0xb6716976A3ebe8D39aCEB04372f22Ff8e6802D7A',
  '0xF3f50213C1d2e255e4B2bAD430F8A38EEF8D718E',
  '0x51cA8ff9f1C0a99f88E86B8112eA3237F55374cA',
]
