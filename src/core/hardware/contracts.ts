import type { ISignableTransaction, ITypedData } from '@/core/transaction'
import type { Address, DerivationPath, HexString } from '@/core/types'

/**
 * Command exchange with the device.
 *
 * WHY THE ABSTRACTION. The connection itself is WebHID or WebUSB —
 * browser interfaces that cannot live in the core: it must stay
 * portable to a service worker. The protocol is fully specified and
 * needs no environment, so it lives here and the connection is
 * injected from outside.
 *
 * THIS IS ALSO THE ONLY WAY TO TEST THE PROTOCOL WITHOUT A DEVICE.
 * A stand-in connection replies like a real one, and command-building
 * errors show up in ordinary tests.
 */
export interface IApduTransport {
  /**
   * Sends a command and returns the whole reply, including the status
   * word in the last two bytes.
   */
  exchange(command: Uint8Array): Promise<Uint8Array>
}

export interface IHardwareAddress {
  readonly address: Address
  readonly path: DerivationPath
}

/**
 * Hardware wallet.
 *
 * THE SIGNATURE COMES BACK READY. The private key never leaves the
 * device in any form: only addresses and signatures go out. That is
 * a property of the device, not an agreement, and our code cannot
 * break it even if it tried.
 */
export interface IHardwareDevice {
  /**
   * Reads the address at a path.
   *
   * @param confirmOnDevice Show the address on the device screen and
   *        require confirmation. Needed wherever the address is
   *        accepted as one's own: an address swapped on the computer
   *        screen is otherwise indistinguishable from the real one.
   */
  getAddress(path: DerivationPath, confirmOnDevice?: boolean): Promise<IHardwareAddress>

  /**
   * Signs a transaction.
   *
   * Returns the raw signed transaction, ready to publish.
   */
  signTransaction(path: DerivationPath, transaction: ISignableTransaction): Promise<HexString>

  signMessage(path: DerivationPath, message: Uint8Array): Promise<HexString>

  signTypedData(path: DerivationPath, typedData: ITypedData): Promise<HexString>
}
