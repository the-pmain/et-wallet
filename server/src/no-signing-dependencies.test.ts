import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Node-layer dependency guard.
 *
 * THE PROMISE "THE SERVICE DOES NOT SIGN TRANSACTIONS" MUST BE
 * TESTABLE, NOT ORAL. Signing is impossible without an elliptic-curve
 * implementation, so no module of `server/src` may import one.
 *
 * After the single `package.json` merge the wallet may lawfully pull
 * ethers and bip39 — the browser code uses them. What is checked is
 * not the manifest, but what `server/src` imports.
 *
 * BIP-39 AND BIP-32 ARE FENCED, NOT BANNED. The record carries
 * `seed_phrase`: create refuses a row without it. Two modules own
 * that column — one checks the phrase it is handed, the other derives
 * the public address of a wallet slot for a device that holds no
 * vault. Both are named below and nothing else may reach those
 * libraries; a third module doing key work is a test failure.
 *
 * HASHING IS ALLOWED EVERYWHERE. `@noble/hashes` is needed for EIP-55
 * checksums on catalog addresses. A hash function does not sign.
 */

const FORBIDDEN_DEPENDENCIES: readonly string[] = [
  'ethers',
  'web3',
  'viem',
  '@noble/secp256k1',
  'ethereumjs-wallet',
  'ethereumjs-tx',
  '@ethereumjs/tx',
  'hdkey',
]

/** Key derivation: only the modules that own `seed_phrase`. */
const DERIVATION_DEPENDENCIES: readonly string[] = [
  '@noble/curves',
  '@scure/bip32',
  '@scure/bip39',
  'bip39',
  'bip32',
]

const DERIVATION_MODULES: readonly string[] = [
  'users/seed-phrase.ts',
  'users/derive-address.ts',
  'users/derive-address.test.ts',
]

const serverSrc = fileURLToPath(new URL('.', import.meta.url))

function imports(content: string, name: string): boolean {
  return content.includes(`from '${name}`) || content.includes(`require('${name}`)
}

describe('Node-layer source', () => {
  it('does not import signing libraries anywhere', async () => {
    const { globSync } = await import('node:fs')
    const sources = globSync('**/*.ts', { cwd: serverSrc })

    const offenders: string[] = []

    for (const file of sources) {
      if (file.endsWith('no-signing-dependencies.test.ts')) {
        continue
      }

      const content = readFileSync(join(serverSrc, file), 'utf8')

      for (const name of FORBIDDEN_DEPENDENCIES) {
        if (imports(content, name)) {
          offenders.push(`${file}: ${name}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('keeps key derivation inside the modules that own the phrase', async () => {
    const { globSync } = await import('node:fs')
    const sources = globSync('**/*.ts', { cwd: serverSrc })

    const offenders: string[] = []

    for (const file of sources) {
      const path = file.replaceAll('\\', '/')

      if (path.endsWith('no-signing-dependencies.test.ts') || DERIVATION_MODULES.includes(path)) {
        continue
      }

      const content = readFileSync(join(serverSrc, file), 'utf8')

      for (const name of DERIVATION_DEPENDENCIES) {
        if (imports(content, name)) {
          offenders.push(`${path}: ${name}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
