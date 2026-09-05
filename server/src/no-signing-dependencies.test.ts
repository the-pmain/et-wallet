import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Node-layer dependency guard.
 *
 * THE PROMISE "THE SERVICE DOES NOT SIGN TRANSACTIONS" MUST BE
 * TESTABLE, NOT ORAL. Signing a transaction without an elliptic-curve
 * implementation is impossible; recovering a key from a seed phrase
 * needs BIP-32 and BIP-39.
 *
 * After the single `package.json` merge the wallet may lawfully pull
 * ethers and bip39 — the browser code uses them. What is checked is
 * not the manifest, but that `server/src` does not import those
 * packages.
 *
 * HASHING IS ALLOWED. `@noble/hashes` is needed for EIP-55 checksums
 * on catalog addresses. A hash function does not sign and does not
 * derive keys.
 */

const FORBIDDEN_DEPENDENCIES: readonly string[] = [
  'ethers',
  'web3',
  'viem',
  '@noble/curves',
  '@noble/secp256k1',
  '@scure/bip32',
  '@scure/bip39',
  'ethereumjs-wallet',
  'ethereumjs-tx',
  '@ethereumjs/tx',
  'hdkey',
  'bip39',
  'bip32',
]

const serverSrc = fileURLToPath(new URL('.', import.meta.url))

describe('Node-layer source', () => {
  it('does not import signing or key-derivation libraries', async () => {
    const { globSync } = await import('node:fs')
    const sources = globSync('**/*.ts', { cwd: serverSrc })

    const offenders: string[] = []

    for (const file of sources) {
      if (file.endsWith('no-signing-dependencies.test.ts')) {
        continue
      }

      const content = readFileSync(join(serverSrc, file), 'utf8')

      for (const name of FORBIDDEN_DEPENDENCIES) {
        if (content.includes(`from '${name}`) || content.includes(`require('${name}`)) {
          offenders.push(`${file}: ${name}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
