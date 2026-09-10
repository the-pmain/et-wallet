import { describe, expect, it } from 'vitest'

import type { ISecretBuffer } from './types'
import { withSecret, withSecretSync } from './with-secret'

/** Буфер-дублёр, считающий вызовы затирания. */
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
  it('возвращает результат действия', async () => {
    const secret = createSecret()

    await expect(withSecret(secret, () => 'готово')).resolves.toBe('готово')
  })

  it('затирает секрет после успешного действия', async () => {
    const secret = createSecret()

    await withSecret(secret, () => 'готово')

    expect(secret.wipeCalls).toBe(1)
  })

  it('затирает секрет при исключении', async () => {
    /* Ошибка посреди работы с ключом — обычное дело. Оставить секрет
       в памяти именно в этот момент означало бы, что защита работает
       только когда всё идёт хорошо. */
    const secret = createSecret()

    await expect(
      withSecret(secret, () => {
        throw new Error('the node did not answer')
      }),
    ).rejects.toThrow('the node did not answer')

    expect(secret.wipeCalls).toBe(1)
  })

  it('затирает секрет при отказе обещания', async () => {
    const secret = createSecret()

    await expect(
      withSecret(secret, () => Promise.reject(new Error('signing failed'))),
    ).rejects.toThrow('signing failed')

    expect(secret.wipeCalls).toBe(1)
  })

  it('затирает только после завершения асинхронного действия', async () => {
    /* Затирание до завершения означало бы подпись обнулённым ключом. */
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
  it('возвращает результат и затирает секрет', () => {
    const secret = createSecret()

    expect(withSecretSync(secret, () => 42)).toBe(42)
    expect(secret.wipeCalls).toBe(1)
  })

  it('затирает секрет при исключении', () => {
    const secret = createSecret()

    expect(() => {
      withSecretSync(secret, () => {
        throw new Error('сбой')
      })
    }).toThrow('сбой')

    expect(secret.wipeCalls).toBe(1)
  })
})
