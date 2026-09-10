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
 * EVM address work.
 *
 * The class delegates to pure functions of the same module and
 * contains NO address-computation logic of its own. Duplication
 * here would be a direct threat: two independent implementations
 * will diverge over time, and the wallet will start showing
 * different addresses in different places.
 *
 * Why a class if the functions already exist. It lets consumers
 * depend on the `IAddressService` interface, not on concrete
 * imports, and swap the implementation in tests. It has no state
 * and no injected dependencies — where a direct function call is
 * enough, calling it directly is allowed and cheaper for the
 * bundle.
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
