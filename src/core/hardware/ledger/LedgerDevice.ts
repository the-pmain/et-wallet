import { Signature, TypedDataEncoder, getBytes, hashMessage, recoverAddress } from 'ethers'

import { toAddress, toChecksumAddress } from '@/core/address'
import { hashTypedData, stripDomainType, toEthersDomain, toEthersTransaction } from '@/core/signing'
import type { ISignableTransaction, ITypedData } from '@/core/transaction'
import type { DerivationPath, HexString } from '@/core/types'

import type { IApduTransport, IHardwareAddress, IHardwareDevice } from '../contracts'

import {
  INS,
  MAX_DATA_LENGTH,
  P1_CONFIRM,
  P1_FIRST,
  P1_MORE,
  P2_NONE,
  buildApdu,
  readResponse,
} from './apdu'
import { HardwareDeviceError } from './errors'
import { encodeDerivationPath } from './path'

/** Длина каждой половины подписи. */
const COMPONENT_LENGTH = 32

/** Длина ответа на подпись: признак чётности и две половины. */
const SIGNATURE_RESPONSE_LENGTH = 1 + COMPONENT_LENGTH * 2

/** Длина адреса в ответе устройства: сорок знаков без префикса. */
const ADDRESS_TEXT_LENGTH = 40

/**
 * Аппаратный кошелёк Ledger.
 *
 * ЧТО ЗДЕСЬ ЕСТЬ И ЧЕГО НЕТ. Здесь протокол: составление команд,
 * разбор ответов, сборка подписи. Соединения здесь нет — оно
 * внедряется, потому что WebHID существует только в браузере, а ядро
 * обязано оставаться переносимым.
 *
 * ПРИЗНАК ЧЁТНОСТИ ВОССТАНАВЛИВАЕТСЯ ВОССТАНОВЛЕНИЕМ АДРЕСА, А НЕ
 * РАЗБОРОМ ОТВЕТА. Устройство возвращает поле `v`, смысл которого
 * зависит от типа транзакции, от версии прошивки и от величины
 * идентификатора сети: у больших сетей оно не помещается в байт и
 * приходит усечённым. Вместо толкования этого байта подпись
 * проверяется обоими возможными значениями чётности, и берётся то,
 * при котором восстановленный адрес совпадает с ожидаемым.
 *
 * Это не обход трудности, а более сильная проверка: она заодно
 * подтверждает, что устройство подписало ожидаемым ключом. Не совпади
 * ни одно значение — подпись отвергается, и в сеть не уходит ничего.
 */
export class LedgerDevice implements IHardwareDevice {
  readonly #transport: IApduTransport

  constructor(transport: IApduTransport) {
    this.#transport = transport
  }

  async getAddress(path: DerivationPath, confirmOnDevice = false): Promise<IHardwareAddress> {
    const response = readResponse(
      await this.#transport.exchange(
        buildApdu(
          INS.GetAddress,
          confirmOnDevice ? P1_CONFIRM : P1_FIRST,
          P2_NONE,
          encodeDerivationPath(path),
        ),
      ),
    )

    return { address: parseAddressResponse(response), path }
  }

  async signTransaction(
    path: DerivationPath,
    transaction: ISignableTransaction,
  ): Promise<HexString> {
    const unsigned = toEthersTransaction(transaction)
    const payload = getBytes(unsigned.unsignedSerialized)

    const signature = await this.#sign(
      INS.SignTransaction,
      concat(encodeDerivationPath(path), payload),
      unsigned.unsignedHash,
      transaction.from,
    )

    unsigned.signature = signature

    return unsigned.serialized as HexString
  }

  async signMessage(path: DerivationPath, message: Uint8Array): Promise<HexString> {
    /* Копия, а не исходный буфер. Пришедший массив может быть окном
       в чужую память либо принадлежать другому контексту исполнения,
       и тогда проверки типов в криптографической библиотеке его
       не признают. Хэшируются ровно те же байты. */
    const bytes = Uint8Array.from(message)

    /* Длина сообщения передаётся отдельным четырёхбайтовым полем перед
       самим сообщением: устройство обязано знать её заранее, потому что
       получает данные частями. */
    const length = new Uint8Array(4)
    const view = new DataView(length.buffer)

    view.setUint32(0, bytes.length, false)

    const digest = hashMessage(bytes)
    const signature = await this.#sign(
      INS.SignPersonalMessage,
      concat(encodeDerivationPath(path), length, bytes),
      digest,
      /* Отправитель здесь неизвестен, и адрес выясняется у самого
         устройства: подпись сообщения не привязана к транзакции. */
      null,
    )

    return signature.serialized as HexString
  }

  async signTypedData(path: DerivationPath, typedData: ITypedData): Promise<HexString> {
    const digest = hashTypedData(typedData)

    /* Устройству отправляются два готовых хэша, а не структура целиком:
       разбор структуры на экране поддержан не всеми версиями прошивки,
       и попытка отправить её туда, где он не поддержан, кончается
       отказом вместо подписи. Цена — на экране устройства человек
       видит хэши, а не поля; разобранную структуру ему показывает
       кошелёк. */
    const { domainSeparator, messageHash } = hashTypedDataParts(typedData)

    const signature = await this.#sign(
      INS.SignTypedDataHashed,
      concat(encodeDerivationPath(path), domainSeparator, messageHash),
      digest,
      null,
    )

    return signature.serialized as HexString
  }

  /**
   * Отправляет данные частями и собирает подпись.
   *
   * ЧАСТИ НЕ ПЕРЕКРЫВАЮТСЯ И НЕ ТЕРЯЮТСЯ: устройство складывает их
   * подряд и подписывает то, что получилось. Ошибка в разбиении
   * означала бы подпись под другими байтами, чем показанные.
   */
  async #sign(
    instruction: number,
    payload: Uint8Array,
    digest: string,
    expectedSigner: string | null,
  ): Promise<Signature> {
    let response: Uint8Array<ArrayBufferLike> = new Uint8Array()

    for (let offset = 0; offset < payload.length; offset += MAX_DATA_LENGTH) {
      const chunk = payload.subarray(offset, offset + MAX_DATA_LENGTH)

      response = readResponse(
        await this.#transport.exchange(
          buildApdu(instruction, offset === 0 ? P1_FIRST : P1_MORE, P2_NONE, chunk),
        ),
      )
    }

    return buildSignature(response, digest, expectedSigner)
  }
}

/**
 * Собирает подпись из ответа устройства.
 *
 * @throws HardwareDeviceError если ни одно значение чётности не даёт
 *         ожидаемого адреса: подпись не принадлежит запрошенному ключу
 *         либо испорчена.
 */
export function buildSignature(
  response: Uint8Array,
  digest: string,
  expectedSigner: string | null,
): Signature {
  if (response.length < SIGNATURE_RESPONSE_LENGTH) {
    throw new HardwareDeviceError('the device returned an incomplete signature')
  }

  const r = `0x${toHex(response.subarray(1, 1 + COMPONENT_LENGTH))}`
  const s = `0x${toHex(response.subarray(1 + COMPONENT_LENGTH, SIGNATURE_RESPONSE_LENGTH))}`

  for (const yParity of [0, 1] as const) {
    const signature = Signature.from({ r, s, yParity })
    const recovered = recoverAddress(digest, signature)

    if (
      expectedSigner === null ||
      toChecksumAddress(recovered) === toChecksumAddress(expectedSigner)
    ) {
      return signature
    }
  }

  throw new HardwareDeviceError(
    'the signature returned by the device does not belong to the expected address',
  )
}

/** Разбирает ответ команды чтения адреса. */
function parseAddressResponse(response: Uint8Array) {
  const publicKeyLength = response[0] ?? 0
  const addressLengthOffset = 1 + publicKeyLength
  const addressLength = response[addressLengthOffset] ?? 0

  if (addressLength !== ADDRESS_TEXT_LENGTH) {
    throw new HardwareDeviceError('the device returned an address of unexpected length')
  }

  const start = addressLengthOffset + 1
  const text = new TextDecoder().decode(response.subarray(start, start + addressLength))

  if (!/^[0-9a-fA-F]{40}$/u.test(text)) {
    throw new HardwareDeviceError('the device returned a malformed address')
  }

  /* Контрольная сумма пересчитывается, а не берётся с устройства:
     регистр в его ответе зависит от версии прошивки, а сверять адреса
     глазами человек будет именно по нему. */
  return toAddress(`0x${text}`)
}

/** Соединяет части в один буфер. */
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

/**
 * Две половины хэша EIP-712.
 *
 * Общий хэш строится как keccak(0x1901 ‖ разделитель домена ‖ хэш
 * сообщения), и достать части из готового результата нельзя — их надо
 * посчитать теми же правилами, что и сам хэш. Обе считает ethers,
 * своей реализации хэширования здесь нет.
 */
export function hashTypedDataParts(typedData: ITypedData): {
  readonly domainSeparator: Uint8Array
  readonly messageHash: Uint8Array
} {
  const types = stripDomainType(typedData.types) as Record<string, { name: string; type: string }[]>

  return {
    domainSeparator: getBytes(TypedDataEncoder.hashDomain(toEthersDomain(typedData.domain))),
    messageHash: getBytes(
      TypedDataEncoder.from(types).hash(typedData.message as Record<string, unknown>),
    ),
  }
}
