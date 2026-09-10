import { describe, expect, it } from 'vitest'

import type { ISecretBuffer } from './types'
import { withSecret, withSecretSync } from './with-secret'

/** Stand-in buffer that counts wipe calls. */
interface ICountingSecret extends ISecretBuffer {
  readonly wipeCalls: number
}

function createSecret(): ICountingSecret {
  const bytes = new Uint8Array([1, 2, 3])
  let wipeCalls = 0

  return {
    get bytes(): Uint8Array {
      return bytes
    },
    get isWiped(): boolean {
      return bytes.every((byte) => byte === 0)
    },
    get wipeCalls(): number {
      return wipeCalls
    },
    wipe: () => {
      wipeCalls += 1
      bytes.fill(0)
    },
  }
}

describe('withSecret', () => {
  it('returns the action result', async () => {
    const secret = createSecret()

    await expect(withSecret(secret, () => 'done')).resolves.toBe('done')
  })

  it('wipes the secret after a successful action', async () => {
    const secret = createSecret()

    await withSecret(secret, () => 'done')

    expect(secret.wipeCalls).toBe(1)
  })

  it('wipes the secret on exception', async () => {
    /* Failures mid-key-use are normal. Leaving the secret in memory
       then would mean the protection works only when everything goes well. */
    const secret = createSecret()

    await expect(
      withSecret(secret, () => {
        throw new Error('the node did not answer')
      }),
    ).rejects.toThrow('the node did not answer')

    expect(secret.wipeCalls).toBe(1)
  })

  it('wipes the secret when the promise rejects', async () => {
    const secret = createSecret()

    await expect(
      withSecret(secret, () => Promise.reject(new Error('signing failed'))),
    ).rejects.toThrow('signing failed')

    expect(secret.wipeCalls).toBe(1)
  })

  it('wipes only after the async action finishes', async () => {
    /* Wiping before completion would mean signing with a zeroed key. */
    const secret = createSecret()
    let wipedDuringUse: boolean | null = null

    await withSecret(secret, async () => {
      await Promise.resolve()
      wipedDuringUse = secret.wipeCalls > 0

      return null
    })

    expect(wipedDuringUse).toBe(false)
    expect(secret.wipeCalls).toBe(1)
  })
})

describe('withSecretSync', () => {
  it('returns the result and wipes the secret', () => {
    const secret = createSecret()

    expect(withSecretSync(secret, () => 42)).toBe(42)
    expect(secret.wipeCalls).toBe(1)
  })

  it('wipes the secret on exception', () => {
    const secret = createSecret()

    expect(() => {
      withSecretSync(secret, () => {
        throw new Error('failure')
      })
    }).toThrow('failure')

    expect(secret.wipeCalls).toBe(1)
  })
})
