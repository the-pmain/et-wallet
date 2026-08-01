import type { ISecretBuffer } from '@/core/encryption'
import type { Address } from '@/core/types'

import type { PublicKeyFormat } from './types'

/**
 * Работа с адресами EVM.
 *
 * Единственная точка вычисления и проверки адресов в приложении.
 * Вторая независимая реализация недопустима: две функции вычисления
 * адреса неизбежно разойдутся, и кошелёк начнёт показывать разные
 * адреса в разных местах интерфейса.
 *
 * Сервис не хранит состояния и не имеет внедряемых зависимостей.
 * Он существует как контракт, чтобы потребители зависели от абстракции
 * и могли подменить реализацию в тестах, а не как носитель состояния.
 *
 * Задействованные примитивы:
 * - secp256k1 — вывод публичного ключа и разворачивание сжатой формы;
 * - Keccak-256 — вычисление адреса и контрольной суммы;
 * - EIP-55 — кодирование контрольной суммы в регистре букв.
 */
export interface IAddressService {
  /**
   * Разбирает строку как адрес, проверяя формат и контрольную сумму.
   *
   * @throws InvalidAddressError, AddressChecksumMismatchError
   */
  parse(value: string): Address

  /** Приводит адрес к контрольной сумме EIP-55 без её проверки. */
  checksum(value: string): Address

  /** Проверка без исключения. Для валидации по мере ввода. */
  isValid(value: string): boolean

  /** Сравнение без учёта регистра. */
  equals(left: string, right: string): boolean

  /** Двоичное представление адреса, 20 байт. */
  toBytes(address: Address): Uint8Array

  /**
   * Адрес из 20 байт.
   *
   * @throws InvalidAddressError при неверной длине.
   */
  fromBytes(bytes: Uint8Array): Address

  /**
   * Адрес из публичного ключа.
   *
   * Принимается сжатая (33 байта), несжатая (65 байт) либо сырая
   * (64 байта) форма SEC1.
   *
   * @throws InvalidPublicKeyError
   */
  fromPublicKey(publicKey: Uint8Array): Address

  /**
   * Адрес из приватного ключа.
   *
   * @throws InvalidPrivateKeyError, SecretBufferWipedError
   */
  fromPrivateKey(privateKey: ISecretBuffer): Address

  /**
   * Публичный ключ из приватного.
   *
   * @throws InvalidPrivateKeyError, SecretBufferWipedError
   */
  getPublicKey(privateKey: ISecretBuffer, format?: PublicKeyFormat): Uint8Array

  /**
   * Пригоден ли приватный ключ.
   *
   * Проверяется не только длина, но и диапазон 1..n-1: значение вне его
   * не задаёт точку на кривой.
   */
  isValidPrivateKey(privateKey: Uint8Array): boolean

  /** Нулевой ли адрес. */
  isZero(address: string): boolean

  /**
   * Заведомо ли невосстановимы средства, отправленные по адресу.
   *
   * Отправку не запрещает: сжигание бывает намеренным. Задача метода —
   * дать интерфейсу основание предупредить.
   */
  isBurn(address: string): boolean
}
