import {
  JsonRpcApiProvider,
  Network,
  makeError,
  type JsonRpcError,
  type JsonRpcPayload,
  type JsonRpcResult,
} from 'ethers'

/** Node reply: either a result or a JSON-RPC error. */
export type NodeHandler = (params: readonly unknown[]) => unknown

/** Error the node will return in the `error` field of the reply. */
export class NodeRpcError extends Error {
  readonly rpcCode: number

  constructor(rpcCode: number, message: string) {
    super(message)
    this.rpcCode = rpcCode
  }
}

/**
 * JSON-RPC node for tests.
 *
 * Extends `JsonRpcApiProvider` and implements the one abstract
 * method `_send` — the documented ethers extension point. That
 * lets `RpcClient` be checked as a whole, including reply parsing
 * and error mapping, without a network and without replacing the
 * library's internals.
 *
 * Stubbing at the HTTP level would be even more honest, but would
 * require standing up a server: for an adapter check that is extra
 * complexity with no gain in fidelity.
 */
export class FakeJsonRpcNode extends JsonRpcApiProvider {
  /** Method handlers. A method without a handler becomes an error. */
  readonly handlers = new Map<string, NodeHandler>()

  /** Call log: method name and params. For checking block tags. */
  readonly calls: { method: string; params: readonly unknown[] }[] = []

  offline = false

  constructor(chainId: number) {
    super(Network.from(chainId), { staticNetwork: Network.from(chainId), batchMaxCount: 1 })

    this.handlers.set('eth_chainId', () => `0x${chainId.toString(16)}`)
  }

  on_(method: string, handler: NodeHandler): this {
    this.handlers.set(method, handler)

    return this
  }

  lastCall(method: string): readonly unknown[] | null {
    for (let index = this.calls.length - 1; index >= 0; index -= 1) {
      const call = this.calls[index]

      if (call?.method === method) {
        return call.params
      }
    }

    return null
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async _send(
    payload: JsonRpcPayload | JsonRpcPayload[],
  ): Promise<(JsonRpcResult | JsonRpcError)[]> {
    if (this.offline) {
      /* The error is built with ethers helpers: a real transport
         throws NETWORK_ERROR, and substituting a plain Error would
         check the wrong error-mapping path. */
      throw makeError('the node is unavailable', 'NETWORK_ERROR', { event: 'offline' })
    }

    const requests = Array.isArray(payload) ? payload : [payload]

    return requests.map((request) => {
      const params = (request.params ?? []) as readonly unknown[]
      this.calls.push({ method: request.method, params })

      const handler = this.handlers.get(request.method)

      if (handler === undefined) {
        return {
          id: request.id,
          error: { code: -32601, message: `method "${request.method}" is not supported` },
        }
      }

      try {
        return { id: request.id, result: handler(params) }
      } catch (error) {
        if (error instanceof NodeRpcError) {
          return { id: request.id, error: { code: error.rpcCode, message: error.message } }
        }

        return {
          id: request.id,
          error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
        }
      }
    })
  }
}
