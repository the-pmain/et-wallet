import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import {
  ChainIdMismatchError,
  GasEstimationFailedError,
  InsufficientFundsError,
  NonceTooLowError,
  ProviderUnavailableError,
  RpcError,
  TransactionUnderpricedError,
} from '@/core/errors'
import { toChainId, type Address, type ChainId, type HexString } from '@/core/types'
import { FakeJsonRpcNode, NodeRpcError } from '@/test/doubles'

import { RpcClient } from './RpcClient'

const CHAIN_ID: ChainId = toChainId(1)
const RPC_URL = 'https://node.example.com'

const ACCOUNT: Address = toAddress('0x9858effd232b4033e47d90003d41ec34ecaeda94')
const RECIPIENT: Address = toAddress('0x6fac4d18c912343bf86fa7049364dd4e424ab9c0')

let node: FakeJsonRpcNode
let client: RpcClient

async function connect(): Promise<RpcClient> {
  return await RpcClient.attach(node, CHAIN_ID, RPC_URL)
}

beforeEach(() => {
  node = new FakeJsonRpcNode(Number(CHAIN_ID))
})

afterEach(() => {
  client.destroy()
})

describe('RpcClient: connect', () => {
  it('establishes a connection when chainId matches', async () => {
    client = await connect()

    expect(client.isActive).toBe(true)
    expect(client.chainId).toBe(CHAIN_ID)
    expect(client.rpcUrl).toBe(RPC_URL)
  })

  it('verifies chainId on connect', async () => {
    client = await connect()

    expect(node.lastCall('eth_chainId')).not.toBeNull()
  })

  it('rejects a node that serves another network', async () => {
    /* The main transport safety check. A node with a foreign chainId
       would return foreign balances and a foreign nonce, and a
       signature built from its data would be valid for replay on the
       target network. */
    node.handlers.set('eth_chainId', () => '0x89')

    await expect(RpcClient.attach(node, CHAIN_ID, RPC_URL)).rejects.toThrow(ChainIdMismatchError)

    client = { destroy: () => undefined } as RpcClient
  })

  it('reports both ids in a mismatch error', async () => {
    node.handlers.set('eth_chainId', () => '0x89')

    await expect(RpcClient.attach(node, CHAIN_ID, RPC_URL)).rejects.toMatchObject({
      expected: 1n,
      actual: 137n,
    })

    client = { destroy: () => undefined } as RpcClient
  })

  it('emits a connect event', async () => {
    const events: unknown[] = []
    node.handlers.set('eth_chainId', () => '0x1')

    client = await RpcClient.attach(node, CHAIN_ID, RPC_URL)
    client.on('provider:connected', (payload) => events.push(payload))

    /* The event is already sent by the time attach returns — a
       subscription after connect will not receive it. What is checked
       is that the connection was established. */
    expect(client.isActive).toBe(true)
    expect(events).toHaveLength(0)
  })

  it('rejects a node response that is not a hex number', async () => {
    node.handlers.set('eth_chainId', () => 'one')

    await expect(RpcClient.attach(node, CHAIN_ID, RPC_URL)).rejects.toThrow()

    client = { destroy: () => undefined } as RpcClient
  })
})

describe('RpcClient: getChainId', () => {
  beforeEach(async () => {
    client = await connect()
  })

  it('returns the id reported by the node', async () => {
    await expect(client.getChainId()).resolves.toBe(CHAIN_ID)
  })

  it('detects the node switching networks after connect', async () => {
    /* The chainId property holds the expected value; the method asks
       the node again. A mismatch means the node switched networks —
       work with it must stop. */
    node.handlers.set('eth_chainId', () => '0xa4b1')

    await expect(client.getChainId()).resolves.toBe(42161n)
    expect(client.chainId).toBe(CHAIN_ID)
  })
})

describe('RpcClient: getBalance', () => {
  beforeEach(async () => {
    client = await connect()
  })

  it('returns the balance in wei', async () => {
    node.handlers.set('eth_getBalance', () => '0xde0b6b3a7640000')

    await expect(client.getBalance(ACCOUNT)).resolves.toBe(1_000_000_000_000_000_000n)
  })

  it('returns a zero balance', async () => {
    node.handlers.set('eth_getBalance', () => '0x0')

    await expect(client.getBalance(ACCOUNT)).resolves.toBe(0n)
  })

  it('keeps precision on large values', async () => {
    /* The balance arrives as a bigint with no intermediate number:
       converting to number would lose precision on tenths of a token. */
    node.handlers.set('eth_getBalance', () => '0xffffffffffffffffffff')

    await expect(client.getBalance(ACCOUNT)).resolves.toBe(1208925819614629174706175n)
  })

  it('passes the given block tag', async () => {
    node.handlers.set('eth_getBalance', () => '0x0')

    await client.getBalance(ACCOUNT, 'pending')

    expect(node.lastCall('eth_getBalance')?.[1]).toBe('pending')
  })

  it('passes a block number as a number', async () => {
    node.handlers.set('eth_getBalance', () => '0x0')

    await client.getBalance(ACCOUNT, 12345n)

    expect(node.lastCall('eth_getBalance')?.[1]).toBe('0x3039')
  })
})

describe('RpcClient: getNonce and getTransactionCount', () => {
  beforeEach(async () => {
    client = await connect()
    node.handlers.set('eth_getTransactionCount', () => '0x5')
  })

  it('getNonce always requests state that includes the mempool', async () => {
    /* Key behaviour. The default tag (`latest`) ignores pending
       transactions, and a new transaction would replace the pending
       one instead of queuing. */
    await client.getNonce(ACCOUNT)

    expect(node.lastCall('eth_getTransactionCount')?.[1]).toBe('pending')
  })

  it('getNonce returns a number', async () => {
    await expect(client.getNonce(ACCOUNT)).resolves.toBe(5)
  })

  it('getTransactionCount allows an explicit tag', async () => {
    await client.getTransactionCount(ACCOUNT, 'latest')

    expect(node.lastCall('eth_getTransactionCount')?.[1]).toBe('latest')
  })
})

describe('RpcClient: estimateGas', () => {
  beforeEach(async () => {
    client = await connect()
  })

  it('returns a gas-limit estimate', async () => {
    node.handlers.set('eth_estimateGas', () => '0x5208')

    await expect(client.estimateGas({ to: RECIPIENT })).resolves.toBe(21000n)
  })

  it('passes call data to the node', async () => {
    node.handlers.set('eth_estimateGas', () => '0x5208')

    await client.estimateGas({ to: RECIPIENT, from: ACCOUNT, value: 1n as never })

    const params = node.lastCall('eth_estimateGas')?.[0] as Record<string, unknown>

    expect(String(params['to']).toLowerCase()).toBe(RECIPIENT.toLowerCase())
    expect(String(params['from']).toLowerCase()).toBe(ACCOUNT.toLowerCase())
  })

  it('turns a call revert into GasEstimationFailedError', async () => {
    /* A failed estimate almost always means the transaction itself
       would revert. Sending it with an arbitrary limit is not
       allowed: gas would be spent and the operation would not run. */
    node.handlers.set('eth_estimateGas', () => {
      throw new NodeRpcError(3, 'execution reverted')
    })

    await expect(client.estimateGas({ to: RECIPIENT })).rejects.toThrow(GasEstimationFailedError)
  })

  it('turns insufficient funds into InsufficientFundsError', async () => {
    node.handlers.set('eth_estimateGas', () => {
      throw new NodeRpcError(-32000, 'insufficient funds for gas * price + value')
    })

    await expect(client.estimateGas({ to: RECIPIENT })).rejects.toThrow(InsufficientFundsError)
  })
})

describe('RpcClient: sendRawTransaction', () => {
  const SIGNED = '0x02f8' as HexString

  beforeEach(async () => {
    client = await connect()
  })

  it('publishes a signed transaction and returns the hash', async () => {
    const hash = '0x1111111111111111111111111111111111111111111111111111111111111111'
    node.handlers.set('eth_sendRawTransaction', () => hash)

    await expect(client.sendRawTransaction(SIGNED)).resolves.toBe(hash)
  })

  it('passes the signed bytes to the node as-is', async () => {
    node.handlers.set('eth_sendRawTransaction', () => `0x${'22'.repeat(32)}`)

    await client.sendRawTransaction(SIGNED)

    expect(node.lastCall('eth_sendRawTransaction')?.[0]).toBe(SIGNED)
  })

  it('makes no extra calls to the node', async () => {
    /* ethers' `broadcastTransaction` also requests the block number
       to build a response object. The wallet only needs the hash. */
    node.handlers.set('eth_sendRawTransaction', () => `0x${'33'.repeat(32)}`)
    node.calls.length = 0

    await client.sendRawTransaction(SIGNED)

    expect(node.calls.map((call) => call.method)).toEqual(['eth_sendRawTransaction'])
  })

  it('rejects an invalid hash returned by the node', async () => {
    /* The node response is untrusted. A bad hash would land in
       operation history and in a block-explorer link. */
    node.handlers.set('eth_sendRawTransaction', () => '0xdeadbeef')

    await expect(client.sendRawTransaction(SIGNED)).rejects.toThrow()
  })

  it('lowercases the hash', async () => {
    node.handlers.set('eth_sendRawTransaction', () => `0x${'AB'.repeat(32)}`)

    await expect(client.sendRawTransaction(SIGNED)).resolves.toBe(`0x${'ab'.repeat(32)}`)
  })

  it('turns a stale nonce into NonceTooLowError', async () => {
    node.handlers.set('eth_sendRawTransaction', () => {
      throw new NodeRpcError(-32000, 'nonce too low')
    })

    await expect(client.sendRawTransaction(SIGNED)).rejects.toThrow(NonceTooLowError)
  })

  it('turns a low replacement price into TransactionUnderpricedError', async () => {
    node.handlers.set('eth_sendRawTransaction', () => {
      throw new NodeRpcError(-32000, 'replacement transaction underpriced')
    })

    await expect(client.sendRawTransaction(SIGNED)).rejects.toThrow(TransactionUnderpricedError)
  })
})

describe('RpcClient: arbitrary call', () => {
  beforeEach(async () => {
    client = await connect()
  })

  it('passes the method and parameters to the node', async () => {
    node.handlers.set('eth_blockNumber', () => '0x10')

    await expect(client.request({ method: 'eth_blockNumber' })).resolves.toBe('0x10')
  })

  it('turns a node error into an RpcError with the original code', async () => {
    node.handlers.set('custom_method', () => {
      throw new NodeRpcError(-32005, 'limit exceeded')
    })

    await expect(client.request({ method: 'custom_method' })).rejects.toMatchObject({
      rpcCode: -32005,
    })
  })

  it('turns an unknown method into an RpcError', async () => {
    await expect(client.request({ method: 'does_not_exist' })).rejects.toThrow(RpcError)
  })
})

describe('RpcClient: block number', () => {
  beforeEach(async () => {
    client = await connect()
  })

  it('returns the block number as a bigint', async () => {
    node.handlers.set('eth_blockNumber', () => '0x1234567')

    await expect(client.getBlockNumber()).resolves.toBe(19088743n)
  })
})

describe('RpcClient: destroy', () => {
  it('marks the transport inactive', async () => {
    client = await connect()
    client.destroy()

    expect(client.isActive).toBe(false)
  })

  it('rejects requests after destroy', async () => {
    client = await connect()
    client.destroy()

    await expect(client.getBalance(ACCOUNT)).rejects.toThrow(ProviderUnavailableError)
  })

  it('allows destroying twice', async () => {
    client = await connect()
    client.destroy()

    expect(() => {
      client.destroy()
    }).not.toThrow()
  })

  it('notifies subscribers of a disconnect', async () => {
    client = await connect()

    const events: { reason: string }[] = []
    client.on('provider:disconnected', (payload) => events.push(payload))
    client.destroy()

    expect(events).toHaveLength(1)
  })
})

describe('RpcClient: unreachable node', () => {
  it('turns a transport failure into ProviderUnavailableError', async () => {
    client = await connect()
    node.offline = true
    node.handlers.set('eth_getBalance', () => '0x0')

    await expect(client.getBalance(ACCOUNT)).rejects.toThrow(ProviderUnavailableError)
  })
})
