import {
  JsonRpcApiProvider,
  Network,
  makeError,
  type JsonRpcError,
  type JsonRpcPayload,
  type JsonRpcResult,
} from 'ethers'

/** Ответ узла: либо результат, либо ошибка JSON-RPC. */
export type NodeHandler = (params: readonly unknown[]) => unknown

/** Ошибка, которую узел вернёт в поле `error` ответа. */
export class NodeRpcError extends Error {
  readonly rpcCode: number

  constructor(rpcCode: number, message: string) {
    super(message)
    this.rpcCode = rpcCode
  }
}

/**
 * Узел JSON-RPC для тестов.
 *
 * Наследует `JsonRpcApiProvider` и реализует единственный абстрактный
 * метод `_send` — документированную точку расширения ethers. Это позволяет
 * проверять `RpcClient` целиком, включая разбор ответов и отображение
 * ошибок, без сети и без подмены внутренностей библиотеки.
 *
 * Подмена на уровне HTTP была бы ещё честнее, но потребовала бы поднимать
 * сервер: для проверки адаптера это лишняя сложность без выигрыша
 * в достоверности.
 */
export class FakeJsonRpcNode extends JsonRpcApiProvider {
  /** Обработчики методов. Метод без обработчика приводит к ошибке. */
  readonly handlers = new Map<string, NodeHandler>()

  /** Журнал вызовов: имя метода и параметры. Для проверки тегов блока. */
  readonly calls: { method: string; params: readonly unknown[] }[] = []

  /** Имитировать полную недоступность узла. */
  offline = false

  constructor(chainId: number) {
    super(Network.from(chainId), { staticNetwork: Network.from(chainId), batchMaxCount: 1 })

    this.handlers.set('eth_chainId', () => `0x${chainId.toString(16)}`)
  }

  /** Регистрирует обработчик метода. */
  on_(method: string, handler: NodeHandler): this {
    this.handlers.set(method, handler)

    return this
  }

  /** Параметры последнего вызова метода. */
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
      /* Ошибка формируется средствами ethers: настоящий транспорт
         выбрасывает именно NETWORK_ERROR, и подмена обычным Error
         проверяла бы не тот путь отображения ошибок. */
      throw makeError('узел недоступен', 'NETWORK_ERROR', { event: 'offline' })
    }

    const requests = Array.isArray(payload) ? payload : [payload]

    return requests.map((request) => {
      const params = (request.params ?? []) as readonly unknown[]
      this.calls.push({ method: request.method, params })

      const handler = this.handlers.get(request.method)

      if (handler === undefined) {
        return {
          id: request.id,
          error: { code: -32601, message: `метод "${request.method}" не поддержан` },
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
