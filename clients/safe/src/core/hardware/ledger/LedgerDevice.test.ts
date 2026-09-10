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

/** Key the stand-in device “signs” with. */
const SIGNING_KEY = new SigningKey(`0x${'07'.repeat(32)}`)
const DEVICE_ADDRESS = toAddress(computeAddress(SIGNING_KEY.publicKey))

const PATH = "m/44'/60'/0'/0/0" as DerivationPath
const RECIPIENT = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

const OK = new Uint8Array([0x90, 0x00])

/** Successful reply: data plus the status word. */
function ok(body: Uint8Array): Uint8Array {
  const response = new Uint8Array(body.length + 2)

  response.set(body, 0)
  response.set(OK, body.length)

  return response
}

/** Reply with a given status word and no data. */
function status(word: number): Uint8Array {
  return new Uint8Array([(word >> 8) & 0xff, word & 0xff])
}

/**
 * Stand-in device.
 *
 * SIGNS FOR REAL, with a real key and a real curve: otherwise the
 * signature-assembly check would check nothing. The only difference
 * from a live device is that there is no screen here, and no person
 * pressing a button.
 */
class FakeLedger implements IApduTransport {
  /** Every command received: their composition is checked. */
  readonly commands: Uint8Array[] = []

  /** Status word to reply with instead of success. */
  failWith: number | null = null

  /** Sign with another key: that is what a foreign derivation path looks like. */
  signWithForeignKey = false

  /** Accumulated signing data from every chunk. */
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

    /* Chunks are concatenated the same way the device does. */
    this.#payload = p1 === P1_FIRST ? Uint8Array.from(data) : concat(this.#payload, data)

    /* The reply arrives only on the last chunk. Here any incomplete
       one is treated as last — exactly how the device behaves when
       it receives data in fixed-size pieces. */
    if (data.length === MAX_DATA_LENGTH) {
      return Promise.resolve(ok(new Uint8Array()))
    }

    return Promise.resolve(ok(this.#signature(instruction ?? 0)))
  }

  /** What the device “saw” for signing, without the path. */
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
   * Signature of what has accumulated.
   *
   * The hash is computed by the rules of the matching command: a
   * transaction is hashed whole, a message with the EIP-191 prefix,
   * a structure arrives as ready hashes.
   */
  #signature(instruction: number): Uint8Array {
    const key = this.signWithForeignKey ? new SigningKey(`0x${'09'.repeat(32)}`) : SIGNING_KEY
    const digest = this.#digest(instruction)
    const signature = key.sign(digest)

    /* The first byte is the same `v` field the wallet does not
       trust: here it is deliberately filled with a meaningless
       value. */
    return concat(new Uint8Array([0xff]), getBytes(signature.r), getBytes(signature.s))
  }

  #digest(instruction: number): string {
    const payload = this.signedPayload

    if (instruction === INS.SignPersonalMessage) {
      /* The first four bytes are the message length. */
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

describe('Reading an address from the device', () => {
  it('the address arrives with an EIP-55 checksum', async () => {
    /* Casing in the device reply depends on firmware version,
       and that is what a person will use to check the address by
       eye. */
    const device = new LedgerDevice(new FakeLedger())

    expect((await device.getAddress(PATH)).address).toBe(DEVICE_ADDRESS)
  })

  it('the derivation path goes to the device in its format', async () => {
    const transport = new FakeLedger()

    await new LedgerDevice(transport).getAddress(PATH)

    const command = transport.commands[0]

    expect(command?.[0]).toBe(CLA)
    expect(command?.[1]).toBe(INS.GetAddress)
    /* Five path levels: m/44'/60'/0'/0/0. */
    expect(command?.[5]).toBe(5)
  })

  it('on-screen confirmation is requested by a separate parameter', async () => {
    /* An address swapped on the computer screen is otherwise
       indistinguishable from the real one. */
    const transport = new FakeLedger()

    await new LedgerDevice(transport).getAddress(PATH, true)

    expect(transport.commands[0]?.[2]).toBe(0x01)
  })
})

describe('Signing a transaction on the device', () => {
  it('the signed transaction belongs to the device address', async () => {
    const raw = await new LedgerDevice(new FakeLedger()).signTransaction(PATH, TRANSACTION)

    expect(Transaction.from(raw).from).toBe(DEVICE_ADDRESS)
  })

  it('exactly the bytes that describe the shown transaction go into the signature', async () => {
    /* A mismatch here would mean a signature over a different
       transaction than the one shown to the person — and would
       only be noticed on chain. */
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

  it('a signature with a foreign key is rejected, not published', async () => {
    /* That is what a wrong derivation path looks like: the
       device replies with a valid signature, but not of that
       account. Sending it, the person would move funds from
       another of their addresses. */
    const transport = new FakeLedger()

    transport.signWithForeignKey = true

    await expect(new LedgerDevice(transport).signTransaction(PATH, TRANSACTION)).rejects.toThrow(
      /does not belong to the expected address/i,
    )
  })

  it('long data goes in chunks, and no byte is lost', async () => {
    /* A contract call easily exceeds the limit of one command. */
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

describe('Signing a message and a structure', () => {
  it('a message signature recovers to the device address', async () => {
    const message = Uint8Array.from(new TextEncoder().encode('Sign in to Example'))
    const signature = await new LedgerDevice(new FakeLedger()).signMessage(PATH, message)

    expect(toAddress(recoverAddress(hashMessage(message), signature))).toBe(DEVICE_ADDRESS)
  })

  it('message length is sent as a separate field', async () => {
    /* The device receives data in chunks and must know the
       length in advance. */
    const transport = new FakeLedger()
    const message = Uint8Array.from(new TextEncoder().encode('abc'))

    await new LedgerDevice(transport).signMessage(PATH, message)

    expect([...transport.signedPayload.subarray(0, 4)]).toEqual([0, 0, 0, 3])
  })

  it('an EIP-712 structure is signed with two hashes and recovers', async () => {
    const signature = await new LedgerDevice(new FakeLedger()).signTypedData(PATH, TYPED_DATA)

    expect(toAddress(recoverAddress(hashTypedData(TYPED_DATA), signature))).toBe(DEVICE_ADDRESS)
  })

  it('exactly two hashes of thirty-two bytes go to the device', async () => {
    const transport = new FakeLedger()

    await new LedgerDevice(transport).signTypedData(PATH, TYPED_DATA)

    expect(transport.signedPayload.length).toBe(64)
  })
})

describe('Device refusals', () => {
  it("a person's refusal is named a refusal, not a breakage", async () => {
    const transport = new FakeLedger()

    transport.failWith = 0x6985

    await expect(new LedgerDevice(transport).getAddress(PATH)).rejects.toThrow(/rejected/i)
  })

  it('a locked device explains what to do', async () => {
    const transport = new FakeLedger()

    transport.failWith = 0x5515

    await expect(new LedgerDevice(transport).getAddress(PATH)).rejects.toThrow(/PIN/i)
  })

  it('a closed application is distinguished from other refusals', async () => {
    const transport = new FakeLedger()

    transport.failWith = 0x6511

    await expect(new LedgerDevice(transport).getAddress(PATH)).rejects.toThrow(
      /Ethereum application is not open/i,
    )
  })

  it('an unknown code is shown as a number, not an invention', async () => {
    const transport = new FakeLedger()

    transport.failWith = 0x1234

    await expect(new LedgerDevice(transport).getAddress(PATH)).rejects.toThrow(/0x1234/)
  })
})

describe('Building and parsing commands', () => {
  it('data longer than the limit does not form a command', () => {
    /* Silently truncating them, we would send something other
       than what was shown to be signed. */
    expect(() => buildApdu(INS.SignTransaction, P1_FIRST, 0, new Uint8Array(256))).toThrow(
      /longer than the protocol allows/i,
    )
  })

  it('a successful reply is returned without the status word', () => {
    expect([...readResponse(new Uint8Array([1, 2, 0x90, 0x00]))]).toEqual([1, 2])
  })

  it('a too-short reply is rejected', () => {
    expect(() => readResponse(new Uint8Array([0x90]))).toThrow(/too short/i)
  })
})

describe('Parsing a derivation path', () => {
  it('hardened levels are marked by the high bit', () => {
    const encoded = encodeDerivationPath("m/44'/60'" as DerivationPath)

    expect(encoded[0]).toBe(2)
    expect([...encoded.subarray(1, 5)]).toEqual([0x80, 0x00, 0x00, 0x2c])
    expect([...encoded.subarray(5, 9)]).toEqual([0x80, 0x00, 0x00, 0x3c])
  })

  it('a hexadecimal level is rejected', () => {
    /* `Number('0x10')` would give the sixteenth account instead of a refusal. */
    expect(() => encodeDerivationPath('m/0x10' as DerivationPath)).toThrow(/malformed level/i)
  })

  it('a path without a leading "m" is rejected', () => {
    expect(() => encodeDerivationPath("44'/60'/0'/0/0" as DerivationPath)).toThrow(/start with/i)
  })

  it('a too-deep path is rejected', () => {
    expect(() => encodeDerivationPath('m/0/0/0/0/0/0/0/0/0/0/0' as DerivationPath)).toThrow(
      /unsupported depth/i,
    )
  })
})
