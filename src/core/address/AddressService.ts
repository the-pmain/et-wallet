import type { ISecretBuffer } from '@/core/encryption'
import type { Address } from '@/core/types'

import {
  addressFromBytes,
  addressToBytes,
  areAddressesEqual,
  isBurnAddress,
  isValidAddress,
  isZeroAddress,
  publicKeyToAddress,
  toAddress,
  toChecksumAddress,
} from './Address'
import type { IAddressService } from './contracts'
import { isValidPrivateKey, privateKeyToAddress, privateKeyToPublicKey } from './private-key'
import type { PublicKeyFormat } from './types'

/**
 * Реализация работы с адресами EVM.
 *
 * Класс делегирует чистым функциям того же модуля и НЕ содержит
 * собственной логики вычисления адреса. Дублирование здесь было бы
 * прямой угрозой: две независимые реализации со временем разойдутся,
 * и кошелёк начнёт показывать разные адреса в разных местах.
 *
 * Зачем класс, если функции уже есть. Он даёт потребителям возможность
 * зависеть от интерфейса `IAddressService`, а не от конкретных импортов,
 * и подменять реализацию в тестах. Состояния и внедряемых зависимостей
 * у него нет — там, где хватает прямого вызова функции, вызывать её
 * напрямую допустимо и дешевле по размеру бандла.
 */
export class AddressService implements IAddressService {
  parse(value: string): Address {
    return toAddress(value)
  }

  checksum(value: string): Address {
    return toChecksumAddress(value)
  }

  isValid(value: string): boolean {
    return isValidAddress(value)
  }

  equals(left: string, right: string): boolean {
    return areAddressesEqual(left, right)
  }

  toBytes(address: Address): Uint8Array {
    return addressToBytes(address)
  }

  fromBytes(bytes: Uint8Array): Address {
    return addressFromBytes(bytes)
  }

  fromPublicKey(publicKey: Uint8Array): Address {
    return publicKeyToAddress(publicKey)
  }

  fromPrivateKey(privateKey: ISecretBuffer): Address {
    return privateKeyToAddress(privateKey)
  }

  getPublicKey(privateKey: ISecretBuffer, format?: PublicKeyFormat): Uint8Array {
    return privateKeyToPublicKey(privateKey, format)
  }

  isValidPrivateKey(privateKey: Uint8Array): boolean {
    return isValidPrivateKey(privateKey)
  }

  isZero(address: string): boolean {
    return isZeroAddress(address)
  }

  isBurn(address: string): boolean {
    return isBurnAddress(address)
  }
}
