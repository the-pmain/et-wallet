import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex, concatBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { beforeEach, describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import { SecretBuffer, type ISecretBuffer } from '@/core/encryption'
import { InvalidArgumentError, InvalidPrivateKeyError } from '@/core/errors'
import { TRANSACTION_TYPE, type ISignableTransaction, type ITypedData } from '@/core/transaction'
import { toChainId, toWei, type ChainId, type HexString, type Wei } from '@/core/types'

import { SigningService } from './SigningService'
import {
  EIP155_VECTOR,
  EIP712_MAIL,
  EIP712_MAIL_HASH,
  KEY_ONE_ADDRESS,
  KEY_ONE_HEX,
  fromHex,
} from './vectors'

const MAINNET: ChainId = toChainId(1)
const RECIPIENT = toAddress('0x3535353535353535353535353535353535353535')

let service: SigningService
let keyOne: ISecretBuffer

beforeEach(() => {
  service = new SigningService()
  keyOne = SecretBuffer.copyOf(fromHex(KEY_ONE_HEX))
})

function legacyTransaction(overrides: Partial<ISignableTransaction> = {}): ISignableTransaction {
  return {
    type: TRANSACTION_TYPE.Legacy,
    chainId: MAINNET,
    from: KEY_ONE_ADDRESS,
    to: RECIPIENT,
    value: toWei(1),
    data: '0x' as HexString,
    nonce: 0,
    gasLimit: 21_000n,
    maxFeePerGas: null,
    maxPriorityFeePerGas: null,
    gasPrice: 20_000_000_000n,
    ...overrides,
  }
}

function eip1559Transaction(overrides: Partial<ISignableTransaction> = {}): ISignableTransaction {
  return {
    type: TRANSACTION_TYPE.Eip1559,
    chainId: MAINNET,
    from: KEY_ONE_ADDRESS,
    to: RECIPIENT,
    value: toWei(1),
    data: '0x' as HexString,
    nonce: 0,
    gasLimit: 21_000n,
    maxFeePerGas: 30_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    gasPrice: null,
    ...overrides,
  }
}

describe('SigningService: официальный вектор EIP-155', () => {
  /* Пример приведён в тексте стандарта. Совпадение сериализованной
     транзакции подтверждает корректность всей цепочки: кодирования RLP,
     включения chainId в подписываемые данные и формирования `v`. */

  it('даёт эталонную подписанную транзакцию', () => {
    const key = SecretBuffer.copyOf(fromHex(EIP155_VECTOR.privateKeyHex))

    try {
      const signed = service.signTransaction(
        {
          type: TRANSACTION_TYPE.Legacy,
          chainId: EIP155_VECTOR.chainId,
          from: EIP155_VECTOR.from,
          to: EIP155_VECTOR.to,
          value: toWei(EIP155_VECTOR.value),
          data: '0x' as HexString,
          nonce: EIP155_VECTOR.nonce,
          gasLimit: EIP155_VECTOR.gasLimit,
          maxFeePerGas: null,
          maxPriorityFeePerGas: null,
          gasPrice: EIP155_VECTOR.gasPrice,
        },
        key,
      )

      expect(signed.raw).toBe(EIP155_VECTOR.signedRaw)
    } finally {
      key.wipe()
    }
  })
})

describe('SigningService: подпись транзакций', () => {
  it('подписывает legacy-транзакцию', () => {
    const signed = service.signTransaction(legacyTransaction(), keyOne)

    expect(signed.raw).toMatch(/^0xf8/)
    expect(signed.hash).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('подписывает транзакцию EIP-1559', () => {
    const signed = service.signTransaction(eip1559Transaction(), keyOne)

    /* Конверт типизированной транзакции EIP-2718: первый байт — код типа. */
    expect(signed.raw).toMatch(/^0x02/)
  })

  it('возвращает исходную структуру без изменений', () => {
    const transaction = eip1559Transaction()
    const signed = service.signTransaction(transaction, keyOne)

    /* Показанное пользователю и подписанное обязаны совпадать.
       Подмена полей внутри подписи — основной класс атак на интерфейс. */
    expect(signed.transaction).toBe(transaction)
  })

  it('даёт разные подписи для разных nonce', () => {
    const first = service.signTransaction(eip1559Transaction({ nonce: 0 }), keyOne)
    const second = service.signTransaction(eip1559Transaction({ nonce: 1 }), keyOne)

    expect(first.raw).not.toBe(second.raw)
  })

  it('подписывает развёртывание контракта', () => {
    const signed = service.signTransaction(eip1559Transaction({ to: null }), keyOne)

    expect(signed.raw).toMatch(/^0x02/)
  })

  it('не затирает переданный ключ', () => {
    service.signTransaction(legacyTransaction(), keyOne)

    expect(keyOne.isWiped).toBe(false)
  })
})

describe('SigningService: защита от повторного проигрывания', () => {
  /* Главная проверка модуля. Транзакция без chainId — формат до EIP-155,
     подпись под которым действительна во ВСЕХ EVM-сетях одновременно:
     перевод, подписанный в тестовой сети, повторяется в основной. */

  it('отвергает транзакцию с нулевым chainId', () => {
    expect(() =>
      service.signTransaction(legacyTransaction({ chainId: 0n as ChainId }), keyOne),
    ).toThrow(InvalidArgumentError)
  })

  it('отвергает транзакцию с отрицательным chainId', () => {
    expect(() =>
      service.signTransaction(legacyTransaction({ chainId: -1n as ChainId }), keyOne),
    ).toThrow(InvalidArgumentError)
  })

  it('включает chainId в подписанные данные', () => {
    /* Одна и та же транзакция в разных сетях обязана давать разные
       подписи. Совпадение означало бы отсутствие защиты. */
    const mainnet = service.signTransaction(legacyTransaction({ chainId: toChainId(1) }), keyOne)
    const polygon = service.signTransaction(legacyTransaction({ chainId: toChainId(137) }), keyOne)

    expect(mainnet.raw).not.toBe(polygon.raw)
  })
})

describe('SigningService: сверка ключа с отправителем', () => {
  it('отвергает транзакцию от чужого адреса', () => {
    /* Без этой проверки транзакция была бы корректной, но подписанной
       чужим ключом: средства ушли бы не с того аккаунта, который
       показан пользователю. */
    expect(() => service.signTransaction(legacyTransaction({ from: RECIPIENT }), keyOne)).toThrow(
      InvalidArgumentError,
    )
  })

  it('сообщает оба адреса в тексте ошибки', () => {
    expect.assertions(2)

    try {
      service.signTransaction(legacyTransaction({ from: RECIPIENT }), keyOne)
    } catch (error) {
      expect((error as Error).message).toContain(KEY_ONE_ADDRESS)
      expect((error as Error).message).toContain(RECIPIENT)
    }
  })

  it('не раскрывает приватный ключ в тексте ошибки', () => {
    expect.assertions(1)

    try {
      service.signTransaction(legacyTransaction({ from: RECIPIENT }), keyOne)
    } catch (error) {
      expect((error as Error).message).not.toContain(KEY_ONE_HEX)
    }
  })
})

describe('SigningService: проверка полей транзакции', () => {
  it('требует gasPrice для legacy', () => {
    expect(() => service.signTransaction(legacyTransaction({ gasPrice: null }), keyOne)).toThrow(
      InvalidArgumentError,
    )
  })

  it('требует поля комиссии для EIP-1559', () => {
    expect(() =>
      service.signTransaction(eip1559Transaction({ maxFeePerGas: null }), keyOne),
    ).toThrow(InvalidArgumentError)
  })

  it('отвергает приоритетную надбавку выше общего предела', () => {
    /* Узел отверг бы такую транзакцию уже после подписи, а пользователь
       успел бы подтвердить комиссию, которой не существует. */
    expect(() =>
      service.signTransaction(
        eip1559Transaction({ maxPriorityFeePerGas: 40_000_000_000n }),
        keyOne,
      ),
    ).toThrow(InvalidArgumentError)
  })

  it('отвергает отрицательный nonce', () => {
    expect(() => service.signTransaction(legacyTransaction({ nonce: -1 }), keyOne)).toThrow(
      InvalidArgumentError,
    )
  })

  it('отвергает нулевой лимит газа', () => {
    expect(() => service.signTransaction(legacyTransaction({ gasLimit: 0n }), keyOne)).toThrow(
      InvalidArgumentError,
    )
  })

  it('принимает нулевую сумму', () => {
    /* Перевод нулевой суммы осмыслен: так вызывают контракт
       и так формируется транзакция отмены. */
    expect(() =>
      service.signTransaction(legacyTransaction({ value: toWei(0) }), keyOne),
    ).not.toThrow()
  })

  it('отвергает отрицательную сумму, переданную в обход конструктора', () => {
    /* `toWei` не позволяет создать отрицательное значение, но приведение
       типом обходит проверку. Дублирующий контроль перед подписью
       оправдан: цена пропуска — транзакция с суммой, которая при
       кодировании станет огромным положительным числом. */
    expect(() => service.signTransaction(legacyTransaction({ value: -1n as Wei }), keyOne)).toThrow(
      InvalidArgumentError,
    )
  })

  it('отвергает непригодный приватный ключ', () => {
    const zero = SecretBuffer.allocate(32)

    try {
      expect(() => service.signTransaction(legacyTransaction(), zero)).toThrow(
        InvalidPrivateKeyError,
      )
    } finally {
      zero.wipe()
    }
  })
})

describe('SigningService: personal_sign', () => {
  it('подписывает строку', () => {
    const signature = service.signMessage('Hello, wallet', keyOne)

    expect(signature).toMatch(/^0x[0-9a-f]{130}$/)
  })

  it('восстанавливает адрес подписавшего', () => {
    /* Самая сильная проверка подписи: совпадение восстановленного
       адреса с ожидаемым. */
    const signature = service.signMessage('Hello, wallet', keyOne)

    expect(service.recoverMessageSigner('Hello, wallet', signature)).toBe(KEY_ONE_ADDRESS)
  })

  it.each(['', 'Hello, wallet', 'Подтверждаю вход'])(
    'применяет префикс EIP-191 к сообщению "%s"',
    (message) => {
      /* Без префикса подписываемые байты могли бы оказаться корректной
         сериализованной транзакцией, и подпись «безобидного» сообщения
         превратилась бы в подпись перевода средств.

         Ожидаемое значение вычисляется здесь независимо, прямо по тексту
         стандарта: keccak256 от `\x19Ethereum Signed Message:\n<длина>`
         и самого сообщения. Сравнение с выводом реализации проверило бы
         лишь её неизменность, но не соответствие EIP-191. */
      const payload = utf8ToBytes(message)
      const prefixed = concatBytes(
        utf8ToBytes(`Ethereum Signed Message:\n${String(payload.length)}`),
        payload,
      )

      expect(service.hashMessage(message)).toBe(`0x${bytesToHex(keccak_256(prefixed))}`)
    },
  )

  it('различает сообщения, отличающиеся пробелом', () => {
    expect(service.hashMessage('Hello, wallet')).not.toBe(service.hashMessage('Hello, wallet '))
  })

  it('различает строку и байты одинакового вида', () => {
    /* dApp может прислать `0x48656c6c6f`, имея в виду либо байты `Hello`,
       либо буквально эту строку. Домен не угадывает — тип выбирает
       вызывающий, и результаты обязаны различаться. */
    const asText = service.signMessage('0x48656c6c6f', keyOne)
    const asBytes = service.signMessage(new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]), keyOne)

    expect(asText).not.toBe(asBytes)
  })

  it('подписывает пустое сообщение', () => {
    const signature = service.signMessage('', keyOne)

    expect(service.recoverMessageSigner('', signature)).toBe(KEY_ONE_ADDRESS)
  })

  it('подписывает многобайтовые символы', () => {
    const message = 'Подтверждаю вход'
    const signature = service.signMessage(message, keyOne)

    expect(service.recoverMessageSigner(message, signature)).toBe(KEY_ONE_ADDRESS)
  })

  it('детерминирован', () => {
    /* RFC 6979 задаёт детерминированный nonce подписи: повторная подпись
       того же сообщения тем же ключом обязана совпасть. Случайный nonce
       при повторном использовании раскрывает приватный ключ. */
    expect(service.signMessage('одно и то же', keyOne)).toBe(
      service.signMessage('одно и то же', keyOne),
    )
  })

  it('не восстанавливает адрес для изменённого сообщения', () => {
    const signature = service.signMessage('исходное', keyOne)

    expect(service.recoverMessageSigner('изменённое', signature)).not.toBe(KEY_ONE_ADDRESS)
  })
})

describe('SigningService: eth_signTypedData_v4', () => {
  it('даёт хэш, совпадающий с примером из текста EIP-712', () => {
    /* Стандарт приводит итоговый хэш для этой структуры. Совпадение
       подтверждает корректность кодирования независимо от подписи. */
    expect(service.hashTypedData(EIP712_MAIL)).toBe(EIP712_MAIL_HASH)
  })

  it('подписывает структуру и восстанавливает адрес', () => {
    const signature = service.signTypedData(EIP712_MAIL, keyOne, MAINNET)

    expect(service.recoverTypedDataSigner(EIP712_MAIL, signature)).toBe(KEY_ONE_ADDRESS)
  })

  it('игнорирует служебный тип EIP712Domain в наборе типов', () => {
    /* Полезная нагрузка `eth_signTypedData_v4` содержит этот тип,
       но кодировщик выводит домен из отдельного аргумента и падает,
       обнаружив его среди прочих. */
    const withDomainType: ITypedData = {
      ...EIP712_MAIL,
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        ...EIP712_MAIL.types,
      },
    }

    expect(service.hashTypedData(withDomainType)).toBe(EIP712_MAIL_HASH)
  })

  it('не изменяет исходную полезную нагрузку', () => {
    const original = JSON.stringify(EIP712_MAIL, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : (value as unknown),
    )

    service.hashTypedData(EIP712_MAIL)

    expect(
      JSON.stringify(EIP712_MAIL, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : (value as unknown),
      ),
    ).toBe(original)
  })
})

describe('SigningService: EIP-712 и привязка к сети', () => {
  /* Подпись EIP-712 привязана к сети только через domain.chainId.
     Структура с чужим значением, подписанная в одной сети, предъявляется
     контракту в другой: пользователю показывают «вход на сайт»,
     а подписанное оказывается разрешением Permit в основной сети. */

  it('отвергает структуру для другой сети', () => {
    expect(() => service.signTypedData(EIP712_MAIL, keyOne, toChainId(137))).toThrow(
      InvalidArgumentError,
    )
  })

  it('сообщает обе сети в тексте ошибки', () => {
    expect.assertions(2)

    try {
      service.signTypedData(EIP712_MAIL, keyOne, toChainId(137))
    } catch (error) {
      expect((error as Error).message).toContain('1')
      expect((error as Error).message).toContain('137')
    }
  })

  it('отвергает структуру без указания сети', () => {
    /* Домен без chainId допустим стандартом, но означает подпись,
       действительную во всех сетях одновременно. */
    const withoutChain: ITypedData = {
      ...EIP712_MAIL,
      domain: { name: 'Ether Mail', version: '1' },
    }

    expect(() => service.signTypedData(withoutChain, keyOne, MAINNET)).toThrow(InvalidArgumentError)
  })

  it('отвергает отсутствующий основной тип', () => {
    const broken: ITypedData = { ...EIP712_MAIL, primaryType: 'Unknown' }

    expect(() => service.signTypedData(broken, keyOne, MAINNET)).toThrow(InvalidArgumentError)
  })

  it('отвергает пустой основной тип', () => {
    const broken: ITypedData = { ...EIP712_MAIL, primaryType: '' }

    expect(() => service.signTypedData(broken, keyOne, MAINNET)).toThrow(InvalidArgumentError)
  })

  it('не доходит до криптографии при непригодной структуре', () => {
    /* Проверка сети выполняется до создания ключа: непригодная
       структура не должна попадать в криптографию вообще. */
    const zero = SecretBuffer.allocate(32)

    try {
      expect(() => service.signTypedData(EIP712_MAIL, zero, toChainId(137))).toThrow(
        InvalidArgumentError,
      )
    } finally {
      zero.wipe()
    }
  })
})
