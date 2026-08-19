import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Охранник зависимостей Node-слоя.
 *
 * ОБЕЩАНИЕ «СЕРВИС НЕ ПОДПИСЫВАЕТ ТРАНЗАКЦИИ» ДОЛЖНО БЫТЬ ПРОВЕРЯЕМЫМ,
 * А НЕ УСТНЫМ. Подписать транзакцию без реализации эллиптической кривой
 * невозможно; восстановить ключ из seed-фразы — без реализации BIP-32
 * и BIP-39.
 *
 * После сведения в один `package.json` кошелёк законно тянет ethers и
 * bip39 — ими пользуется браузерный код. Проверяется не манифест, а то,
 * что `server/src` эти пакеты не импортирует.
 *
 * ХЭШИРОВАНИЕ РАЗРЕШЕНО. `@noble/hashes` нужен для проверки контрольной
 * суммы EIP-55 в адресах каталога. Хэш-функция не подписывает и ключей
 * не выводит.
 */

/** Библиотеки, наличие которых в Node-слое означает способность подписывать. */
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

describe('Исходный код Node-слоя', () => {
  it('не импортирует библиотеки подписи и вывода ключей', async () => {
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
