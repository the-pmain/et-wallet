import {
  Signature,
  SigningKey,
  Transaction,
  hashMessage,
  recoverAddress,
  verifyTypedData,
} from 'ethers'
import { bytesToHex } from '@noble/hashes/utils.js'

import { assertValidPrivateKey, publicKeyToAddress, toAddress } from '@/core/address'
import type { ISecretBuffer } from '@/core/encryption'
import { InvalidArgumentError } from '@/core/errors'
import {
  TRANSACTION_TYPE,
  type ISignableTransaction,
  type ISignedTransaction,
  type ITypedData,
} from '@/core/transaction'
import { toTxHash, type Address, type ChainId, type HexString } from '@/core/types'

import type { ISigningService, SignableMessage } from './contracts'
import {
  assertTypedDataMatchesChain,
  hashTypedData,
  stripDomainType,
  toEthersDomain,
} from './typed-data'

/** Числовые коды типов транзакций из EIP-2718. */
const ETHERS_TRANSACTION_TYPE: Readonly<Record<string, number>> = {
  [TRANSACTION_TYPE.Legacy]: 0,
  [TRANSACTION_TYPE.Eip2930]: 1,
  [TRANSACTION_TYPE.Eip1559]: 2,
}

/**
 * Подпись транзакций и сообщений.
 *
 * СЕРИАЛИЗАЦИЯ ВЫПОЛНЯЕТСЯ ethers, а не собственным кодом. RLP,
 * конверты типизированных транзакций EIP-2718, кодирование структур
 * EIP-712 — всё это подробные спецификации, ошибка в которых даёт
 * подпись под данными, отличными от показанных пользователю.
 * Собственная реализация здесь была бы худшим решением из возможных.
 *
 * ЭЛЛИПТИЧЕСКАЯ КРИВАЯ — `SigningKey` из ethers, использующий
 * `@noble/curves`. Это та же библиотека, что применяется в модуле
 * адресов: две независимые реализации secp256k1 в одном приложении
 * недопустимы.
 */
export class SigningService implements ISigningService {
  signTransaction(
    transaction: ISignableTransaction,
    privateKey: ISecretBuffer,
  ): ISignedTransaction {
    SigningService.#assertSignableTransaction(transaction)

    const signingKey = SigningService.#createSigningKey(privateKey)

    /* Адрес выводится из ключа и сверяется с полем `from`. Без этой
       проверки транзакция будет корректной, но подписанной чужим
       ключом — средства уйдут не с того аккаунта, который показан
       пользователю, и отменить это невозможно. */
    SigningService.#assertKeyMatchesSender(signingKey, transaction.from)

    const unsigned = toEthersTransaction(transaction)
    const signature = signingKey.sign(unsigned.unsignedHash)

    unsigned.signature = signature

    return {
      raw: unsigned.serialized as HexString,
      hash: toTxHash(unsigned.hash),
      transaction,
    }
  }

  signMessage(message: SignableMessage, privateKey: ISecretBuffer): HexString {
    const signingKey = SigningService.#createSigningKey(privateKey)

    return signingKey.sign(hashMessage(message)).serialized as HexString
  }

  signTypedData(data: ITypedData, privateKey: ISecretBuffer, expectedChainId: ChainId): HexString {
    /* Сверка сети выполняется ДО создания ключа: непригодная структура
       не должна доходить до криптографии вообще. */
    assertTypedDataMatchesChain(data, expectedChainId)

    const signingKey = SigningService.#createSigningKey(privateKey)

    return signingKey.sign(hashTypedData(data)).serialized as HexString
  }

  hashMessage(message: SignableMessage): HexString {
    return hashMessage(message) as HexString
  }

  hashTypedData(data: ITypedData): HexString {
    return hashTypedData(data)
  }

  recoverMessageSigner(message: SignableMessage, signature: HexString): Address {
    return toAddress(recoverAddress(hashMessage(message), Signature.from(signature)))
  }

  recoverTypedDataSigner(data: ITypedData, signature: HexString): Address {
    return toAddress(
      verifyTypedData(
        toEthersDomain(data.domain),
        stripDomainType(data.types) as Record<string, { name: string; type: string }[]>,
        data.message as Record<string, unknown>,
        signature,
      ),
    )
  }

  /**
   * Проверяет транзакцию до подписи.
   *
   * Отказ здесь всегда предпочтительнее подписи: подписанная транзакция
   * необратима, а отказ пользователь исправит.
   */
  static #assertSignableTransaction(transaction: ISignableTransaction): void {
    /* САМАЯ ВАЖНАЯ ПРОВЕРКА МОДУЛЯ. Транзакция без chainId — это
       формат до EIP-155, подпись под которым действительна во всех
       EVM-сетях одновременно. Перевод, подписанный в тестовой сети,
       повторяется злоумышленником в основной с теми же параметрами. */
    if (transaction.chainId <= 0n) {
      throw new InvalidArgumentError(
        'transaction.chainId',
        'a transaction without a chain identifier is valid in every network at once',
      )
    }

    if (!Number.isSafeInteger(transaction.nonce) || transaction.nonce < 0) {
      throw new InvalidArgumentError('transaction.nonce', 'a non-negative integer is expected')
    }

    if (transaction.gasLimit <= 0n) {
      throw new InvalidArgumentError('transaction.gasLimit', 'the gas limit must be positive')
    }

    if (transaction.value < 0n) {
      throw new InvalidArgumentError('transaction.value', 'the amount cannot be negative')
    }

    SigningService.#assertFeeFieldsMatchType(transaction)
  }

  /**
   * Проверяет соответствие полей комиссии типу транзакции.
   *
   * Смешение полей означает, что вызывающий код не определился с типом.
   * Молча выбрать за него нельзя: узел отвергнет транзакцию с неверным
   * набором полей уже после подписи, а пользователь увидит непонятный
   * отказ вместо внятного сообщения.
   */
  static #assertFeeFieldsMatchType(transaction: ISignableTransaction): void {
    if (transaction.type === TRANSACTION_TYPE.Eip1559) {
      if (transaction.maxFeePerGas === null || transaction.maxPriorityFeePerGas === null) {
        throw new InvalidArgumentError(
          'transaction.maxFeePerGas',
          'an EIP-1559 transaction requires maxFeePerGas and maxPriorityFeePerGas',
        )
      }

      if (transaction.maxPriorityFeePerGas > transaction.maxFeePerGas) {
        /* Приоритетная надбавка не может превышать общий предел:
           узел отвергнет такую транзакцию, а пользователь уже
           подтвердил бы комиссию, которой не существует. */
        throw new InvalidArgumentError(
          'transaction.maxPriorityFeePerGas',
          'the priority fee cannot exceed maxFeePerGas',
        )
      }

      return
    }

    if (transaction.gasPrice === null) {
      throw new InvalidArgumentError(
        'transaction.gasPrice',
        `a transaction of type "${transaction.type}" requires gasPrice`,
      )
    }
  }

  /**
   * Сверяет адрес ключа с отправителем транзакции.
   *
   * @throws InvalidArgumentError при расхождении. Сообщение не содержит
   *         ни ключа, ни его производных, кроме публичного адреса.
   */
  static #assertKeyMatchesSender(signingKey: SigningKey, from: Address): void {
    const derived = publicKeyToAddress(SigningService.#hexToBytes(signingKey.publicKey))

    if (derived !== from) {
      throw new InvalidArgumentError(
        'transaction.from',
        `the key belongs to ${derived}, while the transaction is sent from ${from}`,
      )
    }
  }

  /**
   * Создаёт ключ подписи из буфера.
   *
   * Диапазон проверяется до передачи в ethers: значение вне 1..n-1
   * не задаёт точку на кривой, и понятная ошибка лучше внутренней
   * ошибки библиотеки.
   */
  static #createSigningKey(privateKey: ISecretBuffer): SigningKey {
    const bytes = privateKey.bytes

    assertValidPrivateKey(bytes)

    return new SigningKey(`0x${bytesToHex(bytes)}`)
  }

  static #hexToBytes(value: string): Uint8Array {
    const body = value.startsWith('0x') ? value.slice(2) : value
    const bytes = new Uint8Array(body.length / 2)

    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Number.parseInt(body.slice(index * 2, index * 2 + 2), 16)
    }

    return bytes
  }
}

/**
 * Собирает транзакцию ethers из доменной структуры.
 *
 * ВЫНЕСЕНА ИЗ КЛАССА, потому что тем же преобразованием пользуется
 * подпись на аппаратном устройстве: ей нужны те же самые байты,
 * которые уходят в подпись здесь. Два преобразования означали бы два
 * представления об одной транзакции, и разойтись они могли бы молча.
 */
export function toEthersTransaction(transaction: ISignableTransaction): Transaction {
  const type = ETHERS_TRANSACTION_TYPE[transaction.type]

  if (type === undefined) {
    throw new InvalidArgumentError('transaction.type', `unknown type "${transaction.type}"`)
  }

  return Transaction.from({
    type,
    chainId: transaction.chainId,
    to: transaction.to,
    nonce: transaction.nonce,
    gasLimit: transaction.gasLimit,
    value: transaction.value,
    data: transaction.data,
    ...(transaction.gasPrice === null ? {} : { gasPrice: transaction.gasPrice }),
    ...(transaction.maxFeePerGas === null ? {} : { maxFeePerGas: transaction.maxFeePerGas }),
    ...(transaction.maxPriorityFeePerGas === null
      ? {}
      : { maxPriorityFeePerGas: transaction.maxPriorityFeePerGas }),
  })
}
