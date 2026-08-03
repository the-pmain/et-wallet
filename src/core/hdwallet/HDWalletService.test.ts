import { HDKey } from '@scure/bip32'
import { beforeEach, describe, expect, it } from 'vitest'

import { PUBLIC_KEY_FORMAT, toAddress } from '@/core/address'
import { SecretBuffer, type ISecretBuffer } from '@/core/encryption'
import {
  ExportNotPermittedError,
  InvalidArgumentError,
  InvalidDerivationPathError,
  InvalidExtendedKeyError,
  KeyringCannotSignError,
  NotInitializedError,
} from '@/core/errors'
import { SigningService } from '@/core/signing'
import { EIP712_MAIL } from '@/core/signing/vectors'
import { TRANSACTION_TYPE } from '@/core/transaction'
import { MnemonicService } from '@/core/mnemonic'
import {
  EXPORT_KIND,
  EXPORT_RISK,
  ExportAuditLog,
  ExportGuard,
  accountExportRequest,
  hdAccountScope,
  privateKeyExportRequest,
  type ExportPermit,
} from '@/core/security'
import { toChainId, toWei, type DerivationPath, type HexString } from '@/core/types'
import { FakeClock, InMemoryStorageService } from '@/test/doubles'
import { toDerivationPath } from '@/core/hdwallet/path'

import { HDWalletService } from './HDWalletService'
import { MAX_ACCOUNTS_PER_CALL } from './types'
import { BIP32_VECTOR_1, TEST_MNEMONIC, TEST_MNEMONIC_ADDRESSES } from './vectors'

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }

  return bytes
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Выдаёт разрешение на экспорт с подтверждением максимального уровня риска.
 *
 * Тесты `HDWalletService` проверяют соответствие разрешения операции,
 * а не оценку риска — она покрыта отдельно в тестах `ExportGuard`.
 */
async function permitFor(
  kind: (typeof EXPORT_KIND)[keyof typeof EXPORT_KIND],
  accountPath: DerivationPath,
  addressIndex: number | null = null,
): Promise<ExportPermit> {
  const guard = new ExportGuard(
    new ExportAuditLog(new InMemoryStorageService()),
    new FakeClock(1_700_000_000_000),
  )

  const request =
    addressIndex === null
      ? accountExportRequest(kind, hdAccountScope(accountPath))
      : privateKeyExportRequest(hdAccountScope(accountPath), addressIndex)

  return await guard.confirm(request, EXPORT_RISK.Critical)
}

async function seedFromTestMnemonic(): Promise<ISecretBuffer> {
  const mnemonicService = new MnemonicService()
  const mnemonic = mnemonicService.fromPhrase(TEST_MNEMONIC)

  try {
    return await mnemonicService.toSeed(mnemonic)
  } finally {
    mnemonic.wipe()
  }
}

describe('слой BIP-32: официальный вектор 1', () => {
  /* Проверяется сама деривация, независимо от адресов Ethereum.
     Расширенные ключи сравниваются как строки base58 — в них закодированы
     и ключ, и код цепочки, и отпечаток родителя, поэтому совпадение строки
     означает совпадение всего узла. */
  it('даёт эталонные расширенные ключи корня', () => {
    const root = HDKey.fromMasterSeed(fromHex(BIP32_VECTOR_1.seedHex))

    expect(root.privateExtendedKey).toBe(BIP32_VECTOR_1.masterXprv)
    expect(root.publicExtendedKey).toBe(BIP32_VECTOR_1.masterXpub)
  })
})

describe('HDWalletService: адреса тестовой мнемоники', () => {
  let seed: ISecretBuffer
  let wallet: HDWalletService

  beforeEach(async () => {
    seed = await seedFromTestMnemonic()
    wallet = HDWalletService.fromSeed(seed)
  })

  it.each(TEST_MNEMONIC_ADDRESSES.map((address, index) => ({ address, index })))(
    'адрес по индексу $index совпадает с эталоном',
    ({ address, index }) => {
      expect(wallet.getAddress(index)).toBe(address)
    },
  )

  it("использует путь m/44'/60'/0'/0/n", () => {
    expect(wallet.accountPath).toBe("m/44'/60'/0'")
    expect(wallet.deriveAccount(3).path).toBe("m/44'/60'/0'/0/3")
  })

  it('возвращает адреса в контрольной сумме EIP-55', () => {
    const address = wallet.getAddress(0)

    expect(() => toAddress(address)).not.toThrow()
    expect(address).not.toBe(address.toLowerCase())
  })

  it('даёт разные адреса при соглашении Ledger Live', () => {
    const ledgerStyle = HDWalletService.fromSeed(seed, { accountIndex: 1 })

    try {
      /* Разные ветви дерева. Кошелёк, поддерживающий только одно
         соглашение, покажет при импорте пустой баланс. */
      expect(ledgerStyle.getAddress(0)).not.toBe(wallet.getAddress(0))
    } finally {
      ledgerStyle.wipe()
    }
  })
})

describe('HDWalletService: создание аккаунтов', () => {
  let wallet: HDWalletService

  beforeEach(async () => {
    const seed = await seedFromTestMnemonic()
    wallet = HDWalletService.fromSeed(seed)
    seed.wipe()
  })

  it('выводит аккаунт с полным набором публичных данных', () => {
    const account = wallet.deriveAccount(0)

    expect(account.addressIndex).toBe(0)
    expect(account.path).toBe("m/44'/60'/0'/0/0")
    expect(account.address).toBe(TEST_MNEMONIC_ADDRESSES[0])
    expect(account.publicKey).toHaveLength(33)
  })

  it('не содержит приватного ключа в структуре аккаунта', () => {
    const account = wallet.deriveAccount(0)

    expect(JSON.stringify(account)).not.toContain('privateKey')
    expect(Object.keys(account)).toEqual(['addressIndex', 'path', 'address', 'publicKey'])
  })

  it('выводит несколько аккаунтов подряд', () => {
    const accounts = wallet.deriveAccounts(0, 5)

    expect(accounts.map((account) => account.address)).toEqual(TEST_MNEMONIC_ADDRESSES)
  })

  it('выводит аккаунты начиная с заданного индекса', () => {
    const accounts = wallet.deriveAccounts(2, 2)

    expect(accounts[0]?.addressIndex).toBe(2)
    expect(accounts[1]?.addressIndex).toBe(3)
  })

  it('детерминирован: повторная деривация даёт тот же адрес', () => {
    expect(wallet.getAddress(17)).toBe(wallet.getAddress(17))
  })

  it('ограничивает число аккаунтов за один вызов', () => {
    expect(() => wallet.deriveAccounts(0, MAX_ACCOUNTS_PER_CALL + 1)).toThrow(
      InvalidExtendedKeyError,
    )
  })

  it('отвергает нулевое количество', () => {
    expect(() => wallet.deriveAccounts(0, 0)).toThrow(InvalidExtendedKeyError)
  })

  it('отвергает индекс из диапазона закалённой деривации', () => {
    expect(() => wallet.deriveAccount(0x80000000)).toThrow(InvalidDerivationPathError)
  })
})

describe('HDWalletService: ключи', () => {
  let wallet: HDWalletService

  beforeEach(async () => {
    const seed = await seedFromTestMnemonic()
    wallet = HDWalletService.fromSeed(seed)
    seed.wipe()
  })

  it('выдаёт приватный ключ длиной 32 байта', async () => {
    const key = wallet.exportPrivateKey(
      0,
      await permitFor(EXPORT_KIND.PrivateKey, wallet.accountPath, 0),
    )

    try {
      expect(key.bytes).toHaveLength(32)
    } finally {
      key.wipe()
    }
  })

  it('выдаёт разные приватные ключи для разных индексов', async () => {
    const first = wallet.exportPrivateKey(
      0,
      await permitFor(EXPORT_KIND.PrivateKey, wallet.accountPath, 0),
    )
    const second = wallet.exportPrivateKey(
      1,
      await permitFor(EXPORT_KIND.PrivateKey, wallet.accountPath, 1),
    )

    try {
      expect(toHex(first.bytes)).not.toBe(toHex(second.bytes))
    } finally {
      first.wipe()
      second.wipe()
    }
  })

  it('приватный ключ соответствует адресу', async () => {
    const key = wallet.exportPrivateKey(
      0,
      await permitFor(EXPORT_KIND.PrivateKey, wallet.accountPath, 0),
    )

    try {
      /* Публичный ключ, восстановленный из приватного, обязан давать
         тот же адрес. Расхождение означало бы, что кошелёк показывает
         адрес, которым не может подписать. */
      const node = new HDKey({ privateKey: key.bytes, chainCode: new Uint8Array(32) })

      expect(node.publicKey).not.toBeNull()
      expect(toHex(node.publicKey as Uint8Array)).toBe(toHex(wallet.getPublicKey(0)))
    } finally {
      key.wipe()
    }
  })

  it('возвращает копию приватного ключа, а не внутренний буфер', async () => {
    const first = wallet.exportPrivateKey(
      0,
      await permitFor(EXPORT_KIND.PrivateKey, wallet.accountPath, 0),
    )
    const firstHex = toHex(first.bytes)
    first.wipe()

    const second = wallet.exportPrivateKey(
      0,
      await permitFor(EXPORT_KIND.PrivateKey, wallet.accountPath, 0),
    )

    try {
      expect(toHex(second.bytes)).toBe(firstHex)
    } finally {
      second.wipe()
    }
  })

  it('выдаёт сжатый публичный ключ по умолчанию', () => {
    expect(wallet.getPublicKey(0)).toHaveLength(33)
  })

  it('выдаёт несжатый публичный ключ по запросу', () => {
    const uncompressed = wallet.getPublicKey(0, PUBLIC_KEY_FORMAT.Uncompressed)

    expect(uncompressed).toHaveLength(65)
    expect(uncompressed[0]).toBe(0x04)
  })

  it('обе формы публичного ключа дают один адрес', () => {
    const account = wallet.deriveAccount(0)

    expect(account.address).toBe(TEST_MNEMONIC_ADDRESSES[0])
  })
})

describe('HDWalletService: подпись', () => {
  let wallet: HDWalletService

  beforeEach(async () => {
    const seed = await seedFromTestMnemonic()
    wallet = HDWalletService.fromSeed(seed)
    seed.wipe()
  })

  it('подписывает сообщение ключом указанного адреса', () => {
    /* Сквозная проверка: мнемоника -> seed -> BIP-32 -> подпись ->
       восстановление адреса. Совпадение с адресом по тому же индексу
       означает, что кошелёк подписывает именно тем ключом, который
       соответствует показанному адресу. */
    const signing = new SigningService()
    const signature = wallet.signMessage(2, 'Подтверждаю вход')

    expect(signing.recoverMessageSigner('Подтверждаю вход', signature)).toBe(wallet.getAddress(2))
  })

  it('разные индексы дают разные подписи', () => {
    expect(wallet.signMessage(0, 'одно сообщение')).not.toBe(
      wallet.signMessage(1, 'одно сообщение'),
    )
  })

  it('подписывает транзакцию от собственного адреса', () => {
    const signed = wallet.signTransaction(0, {
      type: TRANSACTION_TYPE.Eip1559,
      chainId: toChainId(1),
      from: wallet.getAddress(0),
      to: wallet.getAddress(1),
      value: toWei(1),
      data: '0x' as HexString,
      nonce: 0,
      gasLimit: 21_000n,
      maxFeePerGas: 30_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      gasPrice: null,
    })

    expect(signed.raw).toMatch(/^0x02/)
    expect(signed.hash).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('отвергает транзакцию от чужого адреса', () => {
    /* Индекс адреса и поле `from` обязаны совпадать: иначе средства
       ушли бы не с того аккаунта, который показан пользователю. */
    expect(() =>
      wallet.signTransaction(0, {
        type: TRANSACTION_TYPE.Eip1559,
        chainId: toChainId(1),
        from: wallet.getAddress(5),
        to: wallet.getAddress(1),
        value: toWei(1),
        data: '0x' as HexString,
        nonce: 0,
        gasLimit: 21_000n,
        maxFeePerGas: 30_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
        gasPrice: null,
      }),
    ).toThrow(InvalidArgumentError)
  })

  it('подписывает структурированные данные при совпадении сети', () => {
    const signing = new SigningService()
    const signature = wallet.signTypedData(0, EIP712_MAIL, toChainId(1))

    expect(signing.recoverTypedDataSigner(EIP712_MAIL, signature)).toBe(wallet.getAddress(0))
  })

  it('отвергает структуру, предназначенную для другой сети', () => {
    expect(() => wallet.signTypedData(0, EIP712_MAIL, toChainId(137))).toThrow(InvalidArgumentError)
  })

  it('отказывает в подписи после затирания', () => {
    wallet.wipe()

    expect(() => wallet.signMessage(0, 'message')).toThrow(NotInitializedError)
  })
})

describe('HDWalletService: расширенные ключи', () => {
  let wallet: HDWalletService

  beforeEach(async () => {
    const seed = await seedFromTestMnemonic()
    wallet = HDWalletService.fromSeed(seed)
    seed.wipe()
  })

  it('экспортирует xpub уровня аккаунта', async () => {
    expect(wallet.exportAccountXpub(await permitFor(EXPORT_KIND.Xpub, wallet.accountPath))).toMatch(
      /^xpub/,
    )
  })

  it('экспортирует xpub уровня цепочки', async () => {
    expect(wallet.exportChangeXpub(await permitFor(EXPORT_KIND.Xpub, wallet.accountPath))).toMatch(
      /^xpub/,
    )
  })

  it('xpub аккаунта и цепочки различаются', async () => {
    const account = wallet.exportAccountXpub(await permitFor(EXPORT_KIND.Xpub, wallet.accountPath))
    const change = wallet.exportChangeXpub(await permitFor(EXPORT_KIND.Xpub, wallet.accountPath))

    expect(account).not.toBe(change)
  })

  it('экспортирует xprv уровня аккаунта', async () => {
    const xprv = wallet.exportAccountXprv(await permitFor(EXPORT_KIND.Xprv, wallet.accountPath))

    try {
      expect(new TextDecoder().decode(xprv.bytes)).toMatch(/^xprv/)
    } finally {
      xprv.wipe()
    }
  })

  it('xprv не раскрывается при сериализации состояния', async () => {
    const xprv = wallet.exportAccountXprv(await permitFor(EXPORT_KIND.Xprv, wallet.accountPath))

    try {
      expect(JSON.stringify({ key: xprv })).toBe('{"key":"[SECRET]"}')
    } finally {
      xprv.wipe()
    }
  })

  it('раскрывает xpub внутренним потребителям без разрешения', () => {
    expect(wallet.peekAccountXpub()).toMatch(/^xpub/)
  })
})

describe('HDWalletService: разрешения на экспорт', () => {
  let wallet: HDWalletService

  beforeEach(async () => {
    const seed = await seedFromTestMnemonic()
    wallet = HDWalletService.fromSeed(seed)
    seed.wipe()
  })

  it('выдаёт приватный ключ по действительному разрешению', async () => {
    const key = wallet.exportPrivateKey(
      0,
      await permitFor(EXPORT_KIND.PrivateKey, wallet.accountPath, 0),
    )

    try {
      expect(key.bytes).toHaveLength(32)
    } finally {
      key.wipe()
    }
  })

  it('отвергает разрешение, выданное на другой вид экспорта', async () => {
    const permit = await permitFor(EXPORT_KIND.Xpub, wallet.accountPath)

    expect(() => wallet.exportAccountXprv(permit)).toThrow(ExportNotPermittedError)
  })

  it('отвергает разрешение, выданное на другой адрес', async () => {
    const permit = await permitFor(EXPORT_KIND.PrivateKey, wallet.accountPath, 0)

    expect(() => wallet.exportPrivateKey(1, permit)).toThrow(ExportNotPermittedError)
  })

  it('отвергает разрешение, выданное для другого аккаунта', async () => {
    const permit = await permitFor(EXPORT_KIND.Xpub, toDerivationPath("m/44'/60'/7'"))

    expect(() => wallet.exportAccountXpub(permit)).toThrow(ExportNotPermittedError)
  })

  it('гасит разрешение после использования', async () => {
    const permit = await permitFor(EXPORT_KIND.Xpub, wallet.accountPath)
    wallet.exportAccountXpub(permit)

    expect(permit.isConsumed).toBe(true)
    expect(() => wallet.exportAccountXpub(permit)).toThrow(ExportNotPermittedError)
  })

  it('не требует разрешения на подпись', () => {
    /* Подпись выполняется внутри модуля, ключ наружу не выходит,
       поэтому разрешение на экспорт здесь не нужно и не запрашивается. */
    const signature = wallet.signMessage(0, 'привет')

    expect(signature).toMatch(/^0x[0-9a-f]{130}$/)
  })
})

describe('HDWalletService: режим наблюдения из xpub', () => {
  let wallet: HDWalletService
  let watchOnly: HDWalletService

  beforeEach(async () => {
    const seed = await seedFromTestMnemonic()
    wallet = HDWalletService.fromSeed(seed)
    seed.wipe()
    watchOnly = HDWalletService.fromAccountExtendedKey(wallet.peekAccountXpub())
  })

  it('выводит те же адреса, что и полный кошелёк', () => {
    expect(watchOnly.getAddress(0)).toBe(wallet.getAddress(0))
    expect(watchOnly.getAddress(9)).toBe(wallet.getAddress(9))
  })

  it('сообщает о невозможности выдать приватные ключи', () => {
    expect(watchOnly.canDerivePrivateKeys).toBe(false)
    expect(wallet.canDerivePrivateKeys).toBe(true)
  })

  it('отказывает в подписи', () => {
    expect(() => watchOnly.signMessage(0, 'привет')).toThrow(KeyringCannotSignError)
  })

  it('отказывает в экспорте приватного ключа', async () => {
    const permit = await permitFor(EXPORT_KIND.PrivateKey, watchOnly.accountPath, 0)

    expect(() => watchOnly.exportPrivateKey(0, permit)).toThrow(KeyringCannotSignError)
  })

  it('отказывает в экспорте xprv', async () => {
    const permit = await permitFor(EXPORT_KIND.Xprv, watchOnly.accountPath)

    expect(() => watchOnly.exportAccountXprv(permit)).toThrow(KeyringCannotSignError)
  })

  it('восстанавливается и из xprv, сохраняя возможность подписи', async () => {
    const xprv = wallet.exportAccountXprv(await permitFor(EXPORT_KIND.Xprv, wallet.accountPath))

    try {
      const restored = HDWalletService.fromAccountExtendedKey(new TextDecoder().decode(xprv.bytes))

      try {
        expect(restored.canDerivePrivateKeys).toBe(true)
        expect(restored.getAddress(0)).toBe(wallet.getAddress(0))
      } finally {
        restored.wipe()
      }
    } finally {
      xprv.wipe()
    }
  })

  it('отвергает нечитаемый расширенный ключ', () => {
    expect(() => HDWalletService.fromAccountExtendedKey('не ключ')).toThrow(InvalidExtendedKeyError)
  })

  it('не раскрывает разбираемый ключ в тексте ошибки', () => {
    expect.assertions(1)

    try {
      HDWalletService.fromAccountExtendedKey('xprvПоддельныйСекрет')
    } catch (error) {
      expect((error as Error).message).not.toContain('ПоддельныйСекрет')
    }
  })
})

describe('HDWalletService: произвольный путь', () => {
  let wallet: HDWalletService

  beforeEach(async () => {
    const seed = await seedFromTestMnemonic()
    wallet = HDWalletService.fromSeed(seed)
    seed.wipe()
  })

  it('выводит аккаунт по полному пути', () => {
    const account = wallet.deriveByPath(toDerivationPath("m/44'/60'/0'/0/2"))

    expect(account.address).toBe(TEST_MNEMONIC_ADDRESSES[2])
  })

  it('выводит адрес внутренней цепочки', () => {
    const account = wallet.deriveByPath(toDerivationPath("m/44'/60'/0'/1/0"))

    expect(account.address).not.toBe(TEST_MNEMONIC_ADDRESSES[0])
  })

  it('отвергает путь вне ветви аккаунта', () => {
    expect(() => wallet.deriveByPath(toDerivationPath("m/44'/61'/0'/0/0"))).toThrow(
      InvalidExtendedKeyError,
    )
  })
})

describe('HDWalletService: затирание', () => {
  let wallet: HDWalletService

  beforeEach(async () => {
    const seed = await seedFromTestMnemonic()
    wallet = HDWalletService.fromSeed(seed)
    seed.wipe()
  })

  it('помечает экземпляр затёртым', () => {
    wallet.wipe()

    expect(wallet.isWiped).toBe(true)
  })

  it('отказывает в деривации после затирания', () => {
    wallet.wipe()

    expect(() => wallet.getAddress(0)).toThrow(NotInitializedError)
  })

  it('отказывает в экспорте xpub после затирания', async () => {
    const permit = await permitFor(EXPORT_KIND.Xpub, wallet.accountPath)
    wallet.wipe()

    expect(() => wallet.exportAccountXpub(permit)).toThrow(NotInitializedError)
  })

  it('допускает повторное затирание', () => {
    wallet.wipe()

    expect(() => {
      wallet.wipe()
    }).not.toThrow()
  })
})

describe('HDWalletService: проверка seed', () => {
  it('отвергает слишком короткий seed', () => {
    const seed = SecretBuffer.allocate(8)

    try {
      expect(() => HDWalletService.fromSeed(seed)).toThrow(InvalidExtendedKeyError)
    } finally {
      seed.wipe()
    }
  })

  it('отвергает слишком длинный seed', () => {
    const seed = SecretBuffer.allocate(65)

    try {
      expect(() => HDWalletService.fromSeed(seed)).toThrow(InvalidExtendedKeyError)
    } finally {
      seed.wipe()
    }
  })

  it('не затирает переданный seed: владение остаётся за вызывающим', async () => {
    const seed = await seedFromTestMnemonic()

    try {
      const wallet = HDWalletService.fromSeed(seed)
      wallet.wipe()

      expect(seed.isWiped).toBe(false)
      expect(seed.bytes.some((byte) => byte !== 0)).toBe(true)
    } finally {
      seed.wipe()
    }
  })
})
