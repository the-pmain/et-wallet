import { beforeEach, describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import { SecureStorage } from '@/core/encryption'
import { MemoryStorageService } from '@/core/storage'
import { toChainId, type Address, type Timestamp, type TxHash, type Wei } from '@/core/types'
import { FastEncryptionService } from '@/test/doubles'

import { TransactionRepository } from './TransactionRepository'
import { TRANSACTION_STATUS, TRANSACTION_TYPE, type ITransactionRecord } from './types'

const PASSWORD = 'Korova-7-Luna!'

const OWNER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const OTHER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

const ETHEREUM = toChainId(1n)
const POLYGON = toChainId(137n)

/** Сумма за пределами `Number.MAX_SAFE_INTEGER`. */
const LARGE_VALUE = 123_456_789_123_456_789_123n as Wei

let storage: SecureStorage
let repository: TransactionRepository

function record(overrides: Partial<ITransactionRecord> = {}): ITransactionRecord {
  return {
    hash: '0x1111111111111111111111111111111111111111111111111111111111111111' as TxHash,
    chainId: ETHEREUM,
    from: OWNER,
    to: OTHER,
    value: LARGE_VALUE,
    nonce: 7,
    status: TRANSACTION_STATUS.Pending,
    type: TRANSACTION_TYPE.Eip1559,
    submittedAt: 1_700_000_000_000 as Timestamp,
    confirmedAt: null,
    blockNumber: null,
    gasUsed: null,
    effectiveGasPrice: null,
    replacedBy: null,
    confirmations: 0,
    data: null,
    gasLimit: null,
    maxFeePerGas: null,
    maxPriorityFeePerGas: null,
    gasPrice: null,
    ...overrides,
  }
}

beforeEach(async () => {
  storage = new SecureStorage(new MemoryStorageService(), new FastEncryptionService())
  await storage.initialize(PASSWORD)

  repository = new TransactionRepository(storage)
})

describe('TransactionRepository: сохранение', () => {
  it('возвращает запись без потери точности крупных чисел', async () => {
    await repository.save(record())

    const found = await repository.findByHash(record().hash)

    /* Перевод через `number` округлил бы значение: 2^53 меньше типичной
       суммы в wei. Проверяется именно точное совпадение. */
    expect(found?.value).toBe(LARGE_VALUE)
  })

  it('сохраняет все денежные поля как bigint', async () => {
    await repository.save(
      record({
        blockNumber: 18_000_000n,
        gasUsed: 21_000n,
        effectiveGasPrice: 12_345_678_901n,
        confirmedAt: 1_700_000_100_000 as Timestamp,
        status: TRANSACTION_STATUS.Confirmed,
      }),
    )

    const found = await repository.findByHash(record().hash)

    expect(found?.blockNumber).toBe(18_000_000n)
    expect(found?.gasUsed).toBe(21_000n)
    expect(found?.effectiveGasPrice).toBe(12_345_678_901n)
    expect(found?.confirmedAt).toBe(1_700_000_100_000)
  })

  it('восстанавливает chainId как bigint', async () => {
    await repository.save(record({ chainId: POLYGON }))

    expect((await repository.findByHash(record().hash))?.chainId).toBe(POLYGON)
  })

  it('перезаписывает запись с тем же хэшем, а не создаёт вторую', async () => {
    await repository.save(record())
    await repository.save(record({ status: TRANSACTION_STATUS.Confirmed }))

    const all = await repository.findByAddress(OWNER, ETHEREUM)

    expect(all).toHaveLength(1)
    expect(all[0]?.status).toBe(TRANSACTION_STATUS.Confirmed)
  })

  it('сохраняет развёртывание контракта с пустым получателем', async () => {
    await repository.save(record({ to: null }))

    expect((await repository.findByHash(record().hash))?.to).toBeNull()
  })
})

describe('TransactionRepository: поиск', () => {
  it('возвращает null для неизвестного хэша', async () => {
    expect(await repository.findByHash('0xabc' as TxHash)).toBeNull()
  })

  it('отбирает записи по адресу и сети', async () => {
    await repository.save(record())
    await repository.save(
      record({
        hash: '0x2222222222222222222222222222222222222222222222222222222222222222' as TxHash,
        chainId: POLYGON,
      }),
    )

    expect(await repository.findByAddress(OWNER, ETHEREUM)).toHaveLength(1)
    expect(await repository.findByAddress(OWNER, POLYGON)).toHaveLength(1)
  })

  it('не путает адреса, записанные в разном регистре', async () => {
    await repository.save(record())

    const lowercase = OWNER.toLowerCase() as Address

    /* Один адрес приходит и в контрольной сумме EIP-55, и в нижнем регистре
       из ответов RPC. Прямое сравнение строк потеряло бы историю. */
    expect(await repository.findByAddress(lowercase, ETHEREUM)).toHaveLength(1)
  })

  it('сортирует от новых к старым', async () => {
    await repository.save(record({ submittedAt: 1_000 as Timestamp }))
    await repository.save(
      record({
        hash: '0x3333333333333333333333333333333333333333333333333333333333333333' as TxHash,
        submittedAt: 2_000 as Timestamp,
      }),
    )

    const all = await repository.findByAddress(OWNER, ETHEREUM)

    expect(all[0]?.submittedAt).toBe(2_000)
  })

  it('находит только ожидающие подтверждения', async () => {
    await repository.save(record())
    await repository.save(
      record({
        hash: '0x4444444444444444444444444444444444444444444444444444444444444444' as TxHash,
        status: TRANSACTION_STATUS.Confirmed,
      }),
    )

    const pending = await repository.findPending(ETHEREUM)

    expect(pending).toHaveLength(1)
    expect(pending[0]?.status).toBe(TRANSACTION_STATUS.Pending)
  })
})

describe('TransactionRepository: изменение', () => {
  it('обновляет состояние записи', async () => {
    await repository.save(record())
    await repository.updateStatus(record().hash, TRANSACTION_STATUS.Reverted)

    expect((await repository.findByHash(record().hash))?.status).toBe(TRANSACTION_STATUS.Reverted)
  })

  it('молча пропускает обновление неизвестной записи', async () => {
    await expect(
      repository.updateStatus('0xdead' as TxHash, TRANSACTION_STATUS.Confirmed),
    ).resolves.toBeUndefined()
  })

  it('удаляет историю адреса', async () => {
    await repository.save(record())
    await repository.deleteByAddress(OWNER)

    expect(await repository.findByAddress(OWNER, ETHEREUM)).toHaveLength(0)
  })
})

describe('TransactionRepository: шифрование', () => {
  it('не оставляет адрес в открытом виде', async () => {
    const plain = new MemoryStorageService()
    const secure = new SecureStorage(plain, new FastEncryptionService())

    await secure.initialize(PASSWORD)
    await new TransactionRepository(secure).save(record())

    const keys = await plain.keys('transactions')
    const stored = await plain.get('transactions', keys[0]!)

    /* Список операций связывает адреса пользователя и раскрывает
       контрагентов. Заблокированный кошелёк не должен этого сообщать. */
    expect(JSON.stringify(stored)).not.toContain(OWNER)
    expect(JSON.stringify(stored)).not.toContain(OTHER)
  })
})
