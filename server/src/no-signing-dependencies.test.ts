import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Охранник зависимостей.
 *
 * ОБЕЩАНИЕ «СЕРВИС НЕ ПОДПИСЫВАЕТ ТРАНЗАКЦИИ» ДОЛЖНО БЫТЬ ПРОВЕРЯЕМЫМ,
 * А НЕ УСТНЫМ. Подписать транзакцию без реализации эллиптической кривой
 * невозможно; восстановить ключ из seed-фразы — без реализации BIP-32
 * и BIP-39. Пока таких библиотек нет в зависимостях, подписи не будет
 * даже при злом умысле — её просто нечем сделать.
 *
 * Тест падает при добавлении любой из них. Это не помешает тому, кто
 * действительно решит превратить сервис в подписывающий, — но он
 * не сможет сделать это незаметно, между делом, в чужом изменении.
 *
 * ХЭШИРОВАНИЕ РАЗРЕШЕНО. `@noble/hashes` нужен для проверки контрольной
 * суммы EIP-55 в адресах каталога. Хэш-функция не подписывает и ключей
 * не выводит.
 */

/** Библиотеки, наличие которых означает способность подписывать. */
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

const packageJsonPath = fileURLToPath(new URL('../package.json', import.meta.url))

interface IPackageManifest {
  readonly dependencies?: Record<string, string>
  readonly devDependencies?: Record<string, string>
}

const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as IPackageManifest

describe('Зависимости сервиса', () => {
  it('не содержат библиотек подписи и вывода ключей', () => {
    const declared = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ]

    const found = declared.filter((name) => FORBIDDEN_DEPENDENCIES.includes(name))

    expect(
      found,
      'Справочный сервис не подписывает транзакции и не выводит ключи. ' +
        'Появление такой библиотеки означает, что он это умеет.',
    ).toEqual([])
  })

  it('исходный код не упоминает библиотеки подписи', async () => {
    /* Зависимость можно затянуть и через транзитивный импорт. Проверка
       по исходникам ловит и такой случай. */
    const { globSync } = await import('node:fs')
    const sources = globSync('src/**/*.ts', {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
    })

    const offenders: string[] = []

    for (const file of sources) {
      if (file.endsWith('no-signing-dependencies.test.ts')) {
        continue
      }

      const content = readFileSync(
        fileURLToPath(new URL(`../${file.replaceAll('\\', '/')}`, import.meta.url)),
        'utf8',
      )

      for (const name of FORBIDDEN_DEPENDENCIES) {
        if (content.includes(`from '${name}`) || content.includes(`require('${name}`)) {
          offenders.push(`${file}: ${name}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
