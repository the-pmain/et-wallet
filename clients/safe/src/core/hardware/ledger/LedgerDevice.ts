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

const COMPONENT_LENGTH = 32

/** Signature response length: parity flag plus two halves. */
const SIGNATURE_RESPONSE_LENGTH = 1 + COMPONENT_LENGTH * 2

/** Address length in the device response: forty characters, no prefix. */
const ADDRESS_TEXT_LENGTH = 40

/**
 * Ledger hardware wallet.
 *
 * WHAT IS HERE AND WHAT IS NOT. This is the protocol: building
 * commands, parsing replies, assembling the signature. There is no
 * connection here — it is injected, because WebHID exists only in
 * the browser and the core must stay portable.
 *
 * PARITY IS RECOVERED BY ADDRESS RECOVERY, NOT BY PARSING THE REPLY.
 * The device returns a `v` field whose meaning depends on the
 * transaction type, firmware version, and network id size: for large
 * networks it does not fit in a byte and arrives truncated. Instead
 * of interpreting that byte, the signature is tried with both
 * possible parity values, and the one whose recovered address matches
 * the expected signer is kept.
 *
 * This is not a workaround but a stronger check: it also confirms
 * that the device signed with the expected key. If neither value
 * matches, the signature is rejected and nothing goes to the network.
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
    /* A copy, not the original buffer. The incoming array may be a
       view into foreign memory or belong to another execution
       context, and then the cryptographic library's type checks
       will reject it. The hashed bytes are the same. */
    const bytes = Uint8Array.from(message)

    /* Message length is sent as a separate four-byte field before
       the message itself: the device must know it in advance because
       it receives the data in chunks. */
    const length = new Uint8Array(4)
    const view = new DataView(length.buffer)

    view.setUint32(0, bytes.length, false)

    const digest = hashMessage(bytes)
    const signature = await this.#sign(
      INS.SignPersonalMessage,
      concat(encodeDerivationPath(path), length, bytes),
      digest,
      /* The sender is unknown here; the address is asked of the
         device itself: a message signature is not bound to a
         transaction. */
      null,
    )

    return signature.serialized as HexString
  }

  async signTypedData(path: DerivationPath, typedData: ITypedData): Promise<HexString> {
    const digest = hashTypedData(typedData)

    /* The device is sent two ready hashes, not the whole structure:
       on-device structure parsing is not supported by every firmware,
       and sending it where it is not supported ends in a refusal
       instead of a signature. The cost is that the person sees hashes
       on the device screen, not fields; the wallet shows the decoded
       structure. */
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
   * Sends data in chunks and assembles the signature.
   *
   * CHUNKS DO NOT OVERLAP AND ARE NOT LOST: the device concatenates
   * them and signs what it got. A split error would mean a signature
   * over different bytes than those shown.
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
 * Assembles a signature from the device reply.
 *
 * @throws HardwareDeviceError if neither parity value yields the
 *         expected address: the signature does not belong to the
 *         requested key, or it is corrupted.
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

  /* Checksum is recomputed, not taken from the device: the casing
     in its reply depends on firmware version, and that is what a
     person will use to check the address by eye. */
  return toAddress(`0x${text}`)
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

/**
 * The two halves of an EIP-712 hash.
 *
 * The overall hash is keccak(0x1901 ‖ domain separator ‖ message
 * hash), and the parts cannot be recovered from the finished result —
 * they must be computed by the same rules as the hash itself. ethers
 * computes both; there is no hashing implementation here.
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
