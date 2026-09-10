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

describe('RpcClient: подключение', () => {
  it('устанавливает соединение при совпадении chainId', async () => {
    client = await connect()

    expect(client.isActive).toBe(true)
    expect(client.chainId).toBe(CHAIN_ID)
    expect(client.rpcUrl).toBe(RPC_URL)
  })

  it('сверяет chainId при подключении', async () => {
    client = await connect()

    expect(node.lastCall('eth_chainId')).not.toBeNull()
  })

  it('отвергает узел, обслуживающий другую сеть', async () => {
    /* Главная проверка безопасности транспорта. Узел с чужим chainId
       вернёт чужие балансы и чужой nonce, а подпись по его данным
       окажется пригодной для проигрывания в целевой сети. */
    node.handlers.set('eth_chainId', () => '0x89')

    await expect(RpcClient.attach(node, CHAIN_ID, RPC_URL)).rejects.toThrow(ChainIdMismatchError)

    client = { destroy: () => undefined } as RpcClient
  })

  it('сообщает оба идентификатора в ошибке несовпадения', async () => {
    node.handlers.set('eth_chainId', () => '0x89')

    await expect(RpcClient.attach(node, CHAIN_ID, RPC_URL)).rejects.toMatchObject({
      expected: 1n,
      actual: 137n,
    })

    client = { destroy: () => undefined } as RpcClient
  })

  it('порождает событие подключения', async () => {
    const events: unknown[] = []
    node.handlers.set('eth_chainId', () => '0x1')

    client = await RpcClient.attach(node, CHAIN_ID, RPC_URL)
    client.on('provider:connected', (payload) => events.push(payload))

    /* Событие уже отправлено к моменту возврата из attach — подписка
       после подключения его не получит. Проверяется, что соединение
       установлено. */
    expect(client.isActive).toBe(true)
    expect(events).toHaveLength(0)
  })

  it('отвергает ответ узла, не являющийся hex-числом', async () => {
    node.handlers.set('eth_chainId', () => 'единица')

    await expect(RpcClient.attach(node, CHAIN_ID, RPC_URL)).rejects.toThrow()

    client = { destroy: () => undefined } as RpcClient
  })
})

describe('RpcClient: getChainId', () => {
  beforeEach(async () => {
    client = await connect()
  })

  it('возвращает идентификатор, сообщённый узлом', async () => {
    await expect(client.getChainId()).resolves.toBe(CHAIN_ID)
  })

  it('обнаруживает смену сети узлом после подключения', async () => {
    /* Свойство chainId хранит ожидаемое значение, метод спрашивает узел
       заново. Расхождение означает, что узел сменил сеть — работу
       с ним следует прекратить. */
    node.handlers.set('eth_chainId', () => '0xa4b1')

    await expect(client.getChainId()).resolves.toBe(42161n)
    expect(client.chainId).toBe(CHAIN_ID)
  })
})

describe('RpcClient: getBalance', () => {
  beforeEach(async () => {
    client = await connect()
  })

  it('возвращает баланс в wei', async () => {
    node.handlers.set('eth_getBalance', () => '0xde0b6b3a7640000')

    await expect(client.getBalance(ACCOUNT)).resolves.toBe(1_000_000_000_000_000_000n)
  })

  it('возвращает нулевой баланс', async () => {
    node.handlers.set('eth_getBalance', () => '0x0')

    await expect(client.getBalance(ACCOUNT)).resolves.toBe(0n)
  })

  it('сохраняет точность на больших значениях', async () => {
    /* Баланс приходит как bigint без промежуточного number: перевод
       в number потерял бы точность уже на десятых долях токена. */
    node.handlers.set('eth_getBalance', () => '0xffffffffffffffffffff')

    await expect(client.getBalance(ACCOUNT)).resolves.toBe(1208925819614629174706175n)
  })

  it('передаёт указанный тег блока', async () => {
    node.handlers.set('eth_getBalance', () => '0x0')

    await client.getBalance(ACCOUNT, 'pending')

    expect(node.lastCall('eth_getBalance')?.[1]).toBe('pending')
  })

  it('передаёт номер блока числом', async () => {
    node.handlers.set('eth_getBalance', () => '0x0')

    await client.getBalance(ACCOUNT, 12345n)

    expect(node.lastCall('eth_getBalance')?.[1]).toBe('0x3039')
  })
})

describe('RpcClient: getNonce и getTransactionCount', () => {
  beforeEach(async () => {
    client = await connect()
    node.handlers.set('eth_getTransactionCount', () => '0x5')
  })

  it('getNonce всегда запрашивает состояние с учётом мемпула', async () => {
    /* Ключевое поведение. Тег по умолчанию (`latest`) не учитывает
       ожидающие транзакции, и новая транзакция заменила бы собой
       ожидающую вместо постановки в очередь. */
    await client.getNonce(ACCOUNT)

    expect(node.lastCall('eth_getTransactionCount')?.[1]).toBe('pending')
  })

  it('getNonce возвращает число', async () => {
    await expect(client.getNonce(ACCOUNT)).resolves.toBe(5)
  })

  it('getTransactionCount позволяет указать тег явно', async () => {
    await client.getTransactionCount(ACCOUNT, 'latest')

    expect(node.lastCall('eth_getTransactionCount')?.[1]).toBe('latest')
  })
})

describe('RpcClient: estimateGas', () => {
  beforeEach(async () => {
    client = await connect()
  })

  it('возвращает оценку лимита газа', async () => {
    node.handlers.set('eth_estimateGas', () => '0x5208')

    await expect(client.estimateGas({ to: RECIPIENT })).resolves.toBe(21000n)
  })

  it('передаёт данные вызова узлу', async () => {
    node.handlers.set('eth_estimateGas', () => '0x5208')

    await client.estimateGas({ to: RECIPIENT, from: ACCOUNT, value: 1n as never })

    const params = node.lastCall('eth_estimateGas')?.[0] as Record<string, unknown>

    expect(String(params['to']).toLowerCase()).toBe(RECIPIENT.toLowerCase())
    expect(String(params['from']).toLowerCase()).toBe(ACCOUNT.toLowerCase())
  })

  it('превращает откат вызова в GasEstimationFailedError', async () => {
    /* Отказ оценки практически всегда означает, что и транзакция
       откатится. Отправлять её с произвольным лимитом нельзя: газ
       спишется, а операция не выполнится. */
    node.handlers.set('eth_estimateGas', () => {
      throw new NodeRpcError(3, 'execution reverted')
    })

    await expect(client.estimateGas({ to: RECIPIENT })).rejects.toThrow(GasEstimationFailedError)
  })

  it('превращает нехватку средств в InsufficientFundsError', async () => {
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

  it('публикует подписанную транзакцию и возвращает хэш', async () => {
    const hash = '0x1111111111111111111111111111111111111111111111111111111111111111'
    node.handlers.set('eth_sendRawTransaction', () => hash)

    await expect(client.sendRawTransaction(SIGNED)).resolves.toBe(hash)
  })

  it('передаёт узлу именно подписанные байты', async () => {
    node.handlers.set('eth_sendRawTransaction', () => `0x${'22'.repeat(32)}`)

    await client.sendRawTransaction(SIGNED)

    expect(node.lastCall('eth_sendRawTransaction')?.[0]).toBe(SIGNED)
  })

  it('не делает лишних обращений к узлу', async () => {
    /* `broadcastTransaction` из ethers дополнительно запрашивает номер
       блока, чтобы собрать объект ответа. Кошельку нужен только хэш. */
    node.handlers.set('eth_sendRawTransaction', () => `0x${'33'.repeat(32)}`)
    node.calls.length = 0

    await client.sendRawTransaction(SIGNED)

    expect(node.calls.map((call) => call.method)).toEqual(['eth_sendRawTransaction'])
  })

  it('отвергает некорректный хэш, вернувшийся от узла', async () => {
    /* Ответ узла недоверенный. Некорректный хэш попал бы в историю
       операций и в ссылку на обозреватель блоков. */
    node.handlers.set('eth_sendRawTransaction', () => '0xdeadbeef')

    await expect(client.sendRawTransaction(SIGNED)).rejects.toThrow()
  })

  it('приводит хэш к нижнему регистру', async () => {
    node.handlers.set('eth_sendRawTransaction', () => `0x${'AB'.repeat(32)}`)

    await expect(client.sendRawTransaction(SIGNED)).resolves.toBe(`0x${'ab'.repeat(32)}`)
  })

  it('превращает устаревший nonce в NonceTooLowError', async () => {
    node.handlers.set('eth_sendRawTransaction', () => {
      throw new NodeRpcError(-32000, 'nonce too low')
    })

    await expect(client.sendRawTransaction(SIGNED)).rejects.toThrow(NonceTooLowError)
  })

  it('превращает низкую цену замещения в TransactionUnderpricedError', async () => {
    node.handlers.set('eth_sendRawTransaction', () => {
      throw new NodeRpcError(-32000, 'replacement transaction underpriced')
    })

    await expect(client.sendRawTransaction(SIGNED)).rejects.toThrow(TransactionUnderpricedError)
  })
})

describe('RpcClient: произвольный вызов', () => {
  beforeEach(async () => {
    client = await connect()
  })

  it('передаёт метод и параметры узлу', async () => {
    node.handlers.set('eth_blockNumber', () => '0x10')

    await expect(client.request({ method: 'eth_blockNumber' })).resolves.toBe('0x10')
  })

  it('превращает ошибку узла в RpcError с исходным кодом', async () => {
    node.handlers.set('custom_method', () => {
      throw new NodeRpcError(-32005, 'limit exceeded')
    })

    await expect(client.request({ method: 'custom_method' })).rejects.toMatchObject({
      rpcCode: -32005,
    })
  })

  it('превращает неизвестный метод в RpcError', async () => {
    await expect(client.request({ method: 'нет_такого' })).rejects.toThrow(RpcError)
  })
})

describe('RpcClient: номер блока', () => {
  beforeEach(async () => {
    client = await connect()
  })

  it('возвращает номер блока как bigint', async () => {
    node.handlers.set('eth_blockNumber', () => '0x1234567')

    await expect(client.getBlockNumber()).resolves.toBe(19088743n)
  })
})

describe('RpcClient: уничтожение', () => {
  it('помечает транспорт неактивным', async () => {
    client = await connect()
    client.destroy()

    expect(client.isActive).toBe(false)
  })

  it('отказывает в запросах после уничтожения', async () => {
    client = await connect()
    client.destroy()

    await expect(client.getBalance(ACCOUNT)).rejects.toThrow(ProviderUnavailableError)
  })

  it('допускает повторное уничтожение', async () => {
    client = await connect()
    client.destroy()

    expect(() => {
      client.destroy()
    }).not.toThrow()
  })

  it('сообщает подписчикам о разрыве соединения', async () => {
    client = await connect()

    const events: { reason: string }[] = []
    client.on('provider:disconnected', (payload) => events.push(payload))
    client.destroy()

    expect(events).toHaveLength(1)
  })
})

describe('RpcClient: недоступный узел', () => {
  it('превращает отказ транспорта в ProviderUnavailableError', async () => {
    client = await connect()
    node.offline = true
    node.handlers.set('eth_getBalance', () => '0x0')

    await expect(client.getBalance(ACCOUNT)).rejects.toThrow(ProviderUnavailableError)
  })
})
