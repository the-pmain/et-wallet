import {
  SigningKey,
  Transaction,
  computeAddress,
  getBytes,
  hashMessage,
  keccak256,
  recoverAddress,
} from 'ethers'
import { describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import { hashTypedData } from '@/core/signing'
import { TRANSACTION_TYPE, type ISignableTransaction, type ITypedData } from '@/core/transaction'
import { toChainId, toWei, type DerivationPath, type HexString } from '@/core/types'

import type { IApduTransport } from '../contracts'

import { CLA, INS, MAX_DATA_LENGTH, P1_FIRST, P1_MORE, buildApdu, readResponse } from './apdu'
import { LedgerDevice } from './LedgerDevice'
import { encodeDerivationPath } from './path'

/** Ключ, которым «подписывает» подставное устройство. */
const SIGNING_KEY = new SigningKey(`0x${'07'.repeat(32)}`)
const DEVICE_ADDRESS = toAddress(computeAddress(SIGNING_KEY.publicKey))

const PATH = "m/44'/60'/0'/0/0" as DerivationPath
const RECIPIENT = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

const OK = new Uint8Array([0x90, 0x00])

/** Успешный ответ: данные плюс слово состояния. */
function ok(body: Uint8Array): Uint8Array {
  const response = new Uint8Array(body.length + 2)

  response.set(body, 0)
  response.set(OK, body.length)

  return response
}

/** Ответ с заданным словом состояния и без данных. */
function status(word: number): Uint8Array {
  return new Uint8Array([(word >> 8) & 0xff, word & 0xff])
}

/**
 * Подставное устройство.
 *
 * ПОДПИСЫВАЕТ ПО-НАСТОЯЩЕМУ, настоящим ключом и настоящей кривой:
 * иначе проверка сборки подписи ничего не проверяла бы. Разница
 * с живым устройством только в том, что здесь нет ни экрана,
 * ни человека, который нажимает кнопку.
 */
class FakeLedger implements IApduTransport {
  /** Все полученные команды: проверяется их состав. */
  readonly commands: Uint8Array[] = []

  /** Слово состояния, которым отвечать вместо успеха. */
  failWith: number | null = null

  /** Подписывать другим ключом: так выглядит чужой путь деривации. */
  signWithForeignKey = false

  /** Накопленные данные подписи из всех частей. */
  #payload: Uint8Array<ArrayBufferLike> = new Uint8Array()

  exchange(command: Uint8Array): Promise<Uint8Array> {
    this.commands.push(command)

    if (this.failWith !== null) {
      return Promise.resolve(status(this.failWith))
    }

    const instruction = command[1]
    const p1 = command[2]
    const data = command.subarray(5)

    if (instruction === INS.GetAddress) {
      return Promise.resolve(ok(this.#addressResponse()))
    }

    /* Части складываются так же, как это делает устройство. */
    this.#payload = p1 === P1_FIRST ? Uint8Array.from(data) : concat(this.#payload, data)

    /* Ответ приходит только на последнюю часть. Здесь последней
       считается любая неполная — ровно так ведёт себя устройство,
       получающее данные фиксированными кусками. */
    if (data.length === MAX_DATA_LENGTH) {
      return Promise.resolve(ok(new Uint8Array()))
    }

    return Promise.resolve(ok(this.#signature(instruction ?? 0)))
  }

  /** Что именно устройство «увидело» на подпись, без пути. */
  get signedPayload(): Uint8Array {
    const pathLength = encodeDerivationPath(PATH).length

    return Uint8Array.from(this.#payload.subarray(pathLength))
  }

  #addressResponse(): Uint8Array {
    const publicKey = getBytes(SIGNING_KEY.publicKey)
    const text = new TextEncoder().encode(DEVICE_ADDRESS.slice(2).toLowerCase())

    return concat(
      new Uint8Array([publicKey.length]),
      publicKey,
      new Uint8Array([text.length]),
      text,
    )
  }

  /**
   * Подпись того, что накопилось.
   *
   * Хэш считается по правилам соответствующей команды: транзакция
   * хэшируется целиком, сообщение — с префиксом EIP-191, структура
   * приходит уже готовыми хэшами.
   */
  #signature(instruction: number): Uint8Array {
    const key = this.signWithForeignKey ? new SigningKey(`0x${'09'.repeat(32)}`) : SIGNING_KEY
    const digest = this.#digest(instruction)
    const signature = key.sign(digest)

    /* Первый байт — то самое поле `v`, которому кошелёк не доверяет:
       здесь оно намеренно заполнено бессмысленным значением. */
    return concat(new Uint8Array([0xff]), getBytes(signature.r), getBytes(signature.s))
  }

  #digest(instruction: number): string {
    const payload = this.signedPayload

    if (instruction === INS.SignPersonalMessage) {
      /* Первые четыре байта — длина сообщения. */
      return hashMessage(Uint8Array.from(payload.subarray(4)))
    }

    if (instruction === INS.SignTypedDataHashed) {
      const parts = concat(new Uint8Array([0x19, 0x01]), payload)

      return keccak(parts)
    }

    return Transaction.from(`0x${toHex(payload)}`).unsignedHash
  }
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const result = new Uint8Array(total)
  let offset = 0

  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }

  return result
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function keccak(bytes: Uint8Array): string {
  return keccak256(bytes)
}

const TRANSACTION: ISignableTransaction = {
  type: TRANSACTION_TYPE.Eip1559,
  chainId: toChainId(1n),
  from: DEVICE_ADDRESS,
  to: RECIPIENT,
  value: toWei(10n ** 18n),
  data: '0x' as HexString,
  nonce: 3,
  gasLimit: 21_000n,
  maxFeePerGas: 30_000_000_000n,
  maxPriorityFeePerGas: 1_000_000_000n,
  gasPrice: null,
}

const TYPED_DATA: ITypedData = {
  domain: { name: 'Test', version: '1', chainId: toChainId(1n), verifyingContract: RECIPIENT },
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    Message: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
  },
  primaryType: 'Message',
  message: { to: RECIPIENT, amount: 1n },
}

describe('Чтение адреса с устройства', () => {
  it('адрес приходит с контрольной суммой EIP-55', async () => {
    /* Регистр в ответе устройства зависит от версии прошивки,
       а сверять адрес глазами человек будет именно по нему. */
    const device = new LedgerDevice(new FakeLedger())

    expect((await device.getAddress(PATH)).address).toBe(DEVICE_ADDRESS)
  })

  it('путь деривации уходит устройству в его формате', async () => {
    const transport = new FakeLedger()

    await new LedgerDevice(transport).getAddress(PATH)

    const command = transport.commands[0]

    expect(command?.[0]).toBe(CLA)
    expect(command?.[1]).toBe(INS.GetAddress)
    /* Пять уровней пути: m/44'/60'/0'/0/0. */
    expect(command?.[5]).toBe(5)
  })

  it('подтверждение на экране запрашивается отдельным параметром', async () => {
    /* Подменённый на экране компьютера адрес иначе не отличить
       от настоящего. */
    const transport = new FakeLedger()

    await new LedgerDevice(transport).getAddress(PATH, true)

    expect(transport.commands[0]?.[2]).toBe(0x01)
  })
})

describe('Подпись транзакции устройством', () => {
  it('подписанная транзакция принадлежит адресу устройства', async () => {
    const raw = await new LedgerDevice(new FakeLedger()).signTransaction(PATH, TRANSACTION)

    expect(Transaction.from(raw).from).toBe(DEVICE_ADDRESS)
  })

  it('в подпись уходят ровно те байты, что описывают показанную транзакцию', async () => {
    /* Расхождение здесь означало бы подпись под другой транзакцией,
       чем показана человеку, — и обнаружилось бы уже в цепи. */
    const transport = new FakeLedger()

    await new LedgerDevice(transport).signTransaction(PATH, TRANSACTION)

    expect(`0x${toHex(transport.signedPayload)}`).toBe(
      Transaction.from({
        type: 2,
        chainId: 1,
        to: RECIPIENT,
        nonce: 3,
        gasLimit: 21_000n,
        value: 10n ** 18n,
        data: '0x',
        maxFeePerGas: 30_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
      }).unsignedSerialized,
    )
  })

  it('подпись чужим ключом отвергается, а не публикуется', async () => {
    /* Так выглядит неверный путь деривации: устройство отвечает
       исправной подписью, но не того аккаунта. Отправив её, человек
       перевёл бы средства с другого своего адреса. */
    const transport = new FakeLedger()

    transport.signWithForeignKey = true

    await expect(new LedgerDevice(transport).signTransaction(PATH, TRANSACTION)).rejects.toThrow(
      /does not belong to the expected address/i,
    )
  })

  it('длинные данные уходят частями, и ни один байт не теряется', async () => {
    /* Вызов контракта легко превышает предел одной команды. */
    const transport = new FakeLedger()
    const longCall = `0x${'ab'.repeat(600)}` as HexString

    await new LedgerDevice(transport).signTransaction(PATH, {
      ...TRANSACTION,
      data: longCall,
      gasLimit: 200_000n,
    })

    const signing = transport.commands.filter((command) => command[1] === INS.SignTransaction)

    expect(signing.length).toBeGreaterThan(1)
    expect(signing[0]?.[2]).toBe(P1_FIRST)
    expect(signing[1]?.[2]).toBe(P1_MORE)
    expect(`0x${toHex(transport.signedPayload)}`).toContain('ab'.repeat(600))
  })
})

describe('Подпись сообщения и структуры', () => {
  it('подпись сообщения восстанавливается в адрес устройства', async () => {
    const message = Uint8Array.from(new TextEncoder().encode('Sign in to Example'))
    const signature = await new LedgerDevice(new FakeLedger()).signMessage(PATH, message)

    expect(toAddress(recoverAddress(hashMessage(message), signature))).toBe(DEVICE_ADDRESS)
  })

  it('длина сообщения передаётся отдельным полем', async () => {
    /* Устройство получает данные частями и обязано знать длину
       заранее. */
    const transport = new FakeLedger()
    const message = Uint8Array.from(new TextEncoder().encode('abc'))

    await new LedgerDevice(transport).signMessage(PATH, message)

    expect([...transport.signedPayload.subarray(0, 4)]).toEqual([0, 0, 0, 3])
  })

  it('структура EIP-712 подписывается двумя хэшами и восстанавливается', async () => {
    const signature = await new LedgerDevice(new FakeLedger()).signTypedData(PATH, TYPED_DATA)

    expect(toAddress(recoverAddress(hashTypedData(TYPED_DATA), signature))).toBe(DEVICE_ADDRESS)
  })

  it('устройству уходят ровно два хэша по тридцать два байта', async () => {
    const transport = new FakeLedger()

    await new LedgerDevice(transport).signTypedData(PATH, TYPED_DATA)

    expect(transport.signedPayload.length).toBe(64)
  })
})

describe('Отказы устройства', () => {
  it('отказ человека назван отказом, а не поломкой', async () => {
    const transport = new FakeLedger()

    transport.failWith = 0x6985

    await expect(new LedgerDevice(transport).getAddress(PATH)).rejects.toThrow(/rejected/i)
  })

  it('заблокированное устройство объясняет, что делать', async () => {
    const transport = new FakeLedger()

    transport.failWith = 0x5515

    await expect(new LedgerDevice(transport).getAddress(PATH)).rejects.toThrow(/PIN/i)
  })

  it('закрытое приложение отличается от прочих отказов', async () => {
    const transport = new FakeLedger()

    transport.failWith = 0x6511

    await expect(new LedgerDevice(transport).getAddress(PATH)).rejects.toThrow(
      /Ethereum application is not open/i,
    )
  })

  it('неизвестный код показывается числом, а не выдумкой', async () => {
    const transport = new FakeLedger()

    transport.failWith = 0x1234

    await expect(new LedgerDevice(transport).getAddress(PATH)).rejects.toThrow(/0x1234/)
  })
})

describe('Составление и разбор команд', () => {
  it('данные длиннее предела команду не составляют', () => {
    /* Обрезав их молча, мы отправили бы на подпись не то, что
       показано. */
    expect(() => buildApdu(INS.SignTransaction, P1_FIRST, 0, new Uint8Array(256))).toThrow(
      /longer than the protocol allows/i,
    )
  })

  it('успешный ответ отдаётся без слова состояния', () => {
    expect([...readResponse(new Uint8Array([1, 2, 0x90, 0x00]))]).toEqual([1, 2])
  })

  it('слишком короткий ответ отвергается', () => {
    expect(() => readResponse(new Uint8Array([0x90]))).toThrow(/too short/i)
  })
})

describe('Разбор пути деривации', () => {
  it('закалённые уровни отличаются старшим битом', () => {
    const encoded = encodeDerivationPath("m/44'/60'" as DerivationPath)

    expect(encoded[0]).toBe(2)
    expect([...encoded.subarray(1, 5)]).toEqual([0x80, 0x00, 0x00, 0x2c])
    expect([...encoded.subarray(5, 9)]).toEqual([0x80, 0x00, 0x00, 0x3c])
  })

  it('шестнадцатеричная запись уровня отвергается', () => {
    /* `Number('0x10')` дал бы шестнадцатый аккаунт вместо отказа. */
    expect(() => encodeDerivationPath('m/0x10' as DerivationPath)).toThrow(/malformed level/i)
  })

  it('путь без начального «m» отвергается', () => {
    expect(() => encodeDerivationPath("44'/60'/0'/0/0" as DerivationPath)).toThrow(/start with/i)
  })

  it('слишком глубокий путь отвергается', () => {
    expect(() => encodeDerivationPath('m/0/0/0/0/0/0/0/0/0/0/0' as DerivationPath)).toThrow(
      /unsupported depth/i,
    )
  })
})
