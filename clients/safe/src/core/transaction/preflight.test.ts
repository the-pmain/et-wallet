import { describe, expect, it } from 'vitest'

import { encodeUintWord, functionSelector } from '@/core/abi/encoding'
import { toAddress } from '@/core/address'
import { GasEstimationFailedError } from '@/core/errors'
import { EventBus } from '@/core/events'
import type {
  ICallRequest,
  IFeeData,
  ILogEntry,
  IProvider,
  ProviderEventMap,
} from '@/core/provider'
import { toWei, type ChainId, type HexString, type TxHash, type Wei } from '@/core/types'

import { PREFLIGHT_OUTCOME, decodeRevertReason, preflightCall } from './preflight'

const OWNER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const TOKEN = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
const PEER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

/** Call data of `transfer(address,uint256)`. */
const TRANSFER_DATA =
  `0x${functionSelector('transfer(address,uint256)')}${'0'.repeat(24)}${PEER.slice(2)}${encodeUintWord(1n)}` as HexString

const TRUE_WORD = `0x${encodeUintWord(1n)}` as HexString
const FALSE_WORD = `0x${encodeUintWord(0n)}` as HexString

/** Encodes `Error(string)` the way the virtual machine does. */
function encodeErrorString(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const body = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')

  return `0x${functionSelector('Error(string)')}${encodeUintWord(32n)}${encodeUintWord(BigInt(bytes.length))}${body.padEnd(Math.ceil(body.length / 64) * 64, '0')}`
}

function encodePanic(code: bigint): string {
  return `0x${functionSelector('Panic(uint256)')}${encodeUintWord(code)}`
}

/** A node that replies to `eth_call` in a prescribed way. */
class CallNode implements IProvider {
  readonly chainId = 1n as ChainId
  readonly rpcUrl = 'https://stub.example'
  readonly isActive = true

  result: HexString = '0x' as HexString

  failure: Error | null = null

  /** Last request received: its contents are checked. */
  lastRequest: ICallRequest | null = null

  readonly #events = new EventBus<ProviderEventMap>()

  call(request: ICallRequest): Promise<HexString> {
    this.lastRequest = request

    return this.failure === null ? Promise.resolve(this.result) : Promise.reject(this.failure)
  }

  getBalance(): Promise<Wei> {
    return Promise.resolve(toWei(0n))
  }

  getTransactionCount(): Promise<number> {
    return Promise.resolve(0)
  }

  getNonce(): Promise<number> {
    return Promise.resolve(0)
  }

  getBlockNumber(): Promise<bigint> {
    return Promise.resolve(1n)
  }

  getChainId(): Promise<ChainId> {
    return Promise.resolve(this.chainId)
  }

  getCode(): Promise<HexString> {
    return Promise.resolve('0x' as HexString)
  }

  estimateGas(): Promise<bigint> {
    return Promise.resolve(21_000n)
  }

  getTransactionReceipt(): Promise<null> {
    return Promise.resolve(null)
  }

  sendRawTransaction(): Promise<TxHash> {
    return Promise.reject(new Error('not supported'))
  }

  getFeeData(): Promise<IFeeData> {
    return Promise.resolve({
      baseFeePerGas: 1n,
      maxFeePerGas: 2n,
      maxPriorityFeePerGas: 1n,
      gasPrice: 2n,
    })
  }

  getLogs(): Promise<readonly ILogEntry[]> {
    return Promise.resolve([])
  }

  request<TResult>(): Promise<TResult> {
    return Promise.reject(new Error('not supported'))
  }

  destroy(): void {
    /* The stand-in has nothing to release. */
  }

  on = this.#events.on.bind(this.#events)
  once = this.#events.once.bind(this.#events)
  off = this.#events.off.bind(this.#events)
}

const nativeSend = {
  from: OWNER,
  to: PEER,
  data: '0x' as HexString,
  value: toWei(10n ** 18n),
}

const tokenSend = {
  from: OWNER,
  to: TOKEN,
  data: TRANSFER_DATA,
  value: toWei(0n),
}

describe('Preflight: success', () => {
  it('a call that passed on the node is treated as passed', async () => {
    const node = new CallNode()

    expect((await preflightCall(node, nativeSend)).outcome).toBe(PREFLIGHT_OUTCOME.Passed)
  })

  it('the node receives the same fields that will go on-chain', async () => {
    /* Checking a different transaction checks nothing. The amount
       and call data must match what will be signed. */
    const node = new CallNode()

    node.result = TRUE_WORD

    await preflightCall(node, tokenSend)

    expect(node.lastRequest).toEqual({
      to: TOKEN,
      from: OWNER,
      data: TRANSFER_DATA,
      value: 0n,
    })
  })
})

describe('Preflight: rejection by value', () => {
  it('`transfer` that returned false is treated as a rejection', async () => {
    /* Worse than a revert: the transaction lands in a block, gas
       is charged, and the funds do not move. A wallet that stays
       silent here would report a send that never happened. */
    const node = new CallNode()

    node.result = FALSE_WORD

    const result = await preflightCall(node, tokenSend)

    expect(result.outcome).toBe(PREFLIGHT_OUTCOME.RejectedByContract)
    expect(result.reason).toMatch(/false/i)
  })

  it('`transfer` that returned true passes', async () => {
    const node = new CallNode()

    node.result = TRUE_WORD

    expect((await preflightCall(node, tokenSend)).outcome).toBe(PREFLIGHT_OUTCOME.Passed)
  })

  it('an empty `transfer` reply is not treated as a rejection', async () => {
    /* Contracts written before the standard was clarified return
       nothing. Treating them as rejected would ban working with
       them — some of the largest are among them. */
    const node = new CallNode()

    node.result = '0x' as HexString

    expect((await preflightCall(node, tokenSend)).outcome).toBe(PREFLIGHT_OUTCOME.Passed)
  })

  it('a zero reply from a call with no boolean result is not a rejection', async () => {
    /* Zero is a lawful result of many functions. Reading it as a
       rejection on every call would raise an alarm without cause. */
    const node = new CallNode()

    node.result = FALSE_WORD

    expect((await preflightCall(node, nativeSend)).outcome).toBe(PREFLIGHT_OUTCOME.Passed)
  })
})

describe('Preflight: revert', () => {
  it('a revert is recognised and not treated as unavailability', async () => {
    const node = new CallNode()

    node.failure = new GasEstimationFailedError('the call reverted')

    expect((await preflightCall(node, tokenSend)).outcome).toBe(PREFLIGHT_OUTCOME.Reverted)
  })

  it('the contract reason arrives verbatim', async () => {
    const node = new CallNode()

    node.failure = new GasEstimationFailedError('the call reverted', {
      revertData: encodeErrorString('ERC20: transfer amount exceeds balance'),
    })

    expect((await preflightCall(node, tokenSend)).reason).toBe(
      'ERC20: transfer amount exceeds balance',
    )
  })

  it('the raw revert data is kept', async () => {
    /* The four-byte selector of a custom error is how the reason
       can be found. Losing it would leave nothing to say. */
    const node = new CallNode()
    const data = '0xdeadbeef'

    node.failure = new GasEstimationFailedError('the call reverted', { revertData: data })

    expect((await preflightCall(node, tokenSend)).revertData).toBe(data)
  })

  it('an unavailable node is not treated as a revert', async () => {
    /* Silence from the node confirms nothing. Showing it as a call
       rejection would send the person looking for a fault in their
       own transaction. */
    const node = new CallNode()

    node.failure = new Error('the node did not answer')

    expect((await preflightCall(node, tokenSend)).outcome).toBe(PREFLIGHT_OUTCOME.Unavailable)
  })

  it('a contract deployment is not checked and not declared checked', async () => {
    /* A call with no recipient returns the future contract's
       bytecode, not a success flag: there is nothing to judge by. */
    const node = new CallNode()

    const result = await preflightCall(node, {
      from: OWNER,
      to: null,
      data: '0x6080' as HexString,
      value: toWei(0n),
    })

    expect(result.outcome).toBe(PREFLIGHT_OUTCOME.Unavailable)
    expect(node.lastRequest).toBeNull()
  })
})

describe('Parsing revert data', () => {
  it('a standard reason is read as a string', () => {
    expect(decodeRevertReason(encodeErrorString('not enough allowance'))).toBe(
      'not enough allowance',
    )
  })

  it('a panic code is translated into words', () => {
    /* "Panic 0x11" tells the funds' owner nothing. */
    expect(decodeRevertReason(encodePanic(0x11n))).toMatch(/overflow/i)
  })

  it('an unknown panic code is named as a number, not invented', () => {
    expect(decodeRevertReason(encodePanic(0x99n))).toMatch(/153/)
  })

  it('a custom contract error is shown by its selector', () => {
    /* It cannot be decoded without the contract's description, and
       inventing a reading is not allowed. */
    expect(decodeRevertReason('0xdeadbeef')).toMatch(/0xdeadbeef/)
  })

  it('empty data yields no reason', () => {
    expect(decodeRevertReason(null)).toBeNull()
    expect(decodeRevertReason('0x')).toBeNull()
  })

  it('truncated data yields no reason instead of throwing', () => {
    /* A corrupted node reply must not add an exception on top of
       a refusal that already happened. */
    expect(decodeRevertReason(`0x${functionSelector('Error(string)')}00`)).toBeNull()
  })

  it('control characters in the reason cancel it', () => {
    /* A string with newlines and a carriage return can paint its
       own text over the wallet's message. */
    expect(decodeRevertReason(encodeErrorString('ok\n\n\rApproved by the wallet'))).toBeNull()
  })
})
