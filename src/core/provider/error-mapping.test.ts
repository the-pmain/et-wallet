import { makeError } from 'ethers'
import { describe, expect, it } from 'vitest'

import {
  GasEstimationFailedError,
  InsufficientFundsError,
  ProviderUnavailableError,
  RpcError,
} from '@/core/errors'
import { toChainId } from '@/core/types'

import { mapProviderError } from './error-mapping'

const CHAIN_ID = toChainId(1n)

/**
 * Проверки отображения ошибок узла в ошибки предметной области.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ НАБОР. От этого отображения зависит поведение, которое
 * само по себе выглядит не связанным с ошибками: `FailoverProvider`
 * перебирает резервные адреса ровно тогда, когда получает
 * `ProviderUnavailableError`. Ошибка классификации здесь беззвучно
 * отключает резерв целиком — что и случилось с ответом HTTP 500.
 *
 * Ошибки строятся `makeError` из самой ethers, а не вручную: подделка
 * несла бы риск разойтись с библиотекой и подтверждать несуществующее.
 */
describe('mapProviderError', () => {
  it('считает ответ HTTP без тела JSON-RPC отказом узла, а не его ответом', () => {
    /* Ровно то, что приходило при отказе узла на выборке журналов:
       ethers помечает такое кодом SERVER_ERROR, тела JSON-RPC нет. */
    /* Хвостовой пробел — не описка: ethers склеивает код состояния
       с пояснением, и при пустом пояснении он остаётся. Измерено на
       живом узле, куда экран истории вывел `server response 500 `. */
    const error = makeError('server response 500 ', 'SERVER_ERROR', {
      request: 'https://node.example',
    })

    const mapped = mapProviderError(error, CHAIN_ID)

    expect(mapped).toBeInstanceOf(ProviderUnavailableError)

    /* И сообщает о случившемся, а не об исчерпанном списке адресов:
       эта ошибка доходит до экрана истории дословно. */
    expect(mapped.message).toBe('server response 500')
  })

  it('не подменяет ответ узла отказом, когда тело JSON-RPC есть', () => {
    /* Узел вправе ответить ошибкой JSON-RPC и с кодом HTTP, отличным
       от 200. Это его ответ, и код узла должен дойти без искажения:
       иначе `-32005` («превышен лимит») превратился бы в «узел
       недоступен», и резерв перебирал бы адреса вместо ожидания. */
    const error = makeError('server response 429', 'SERVER_ERROR', {
      request: 'https://node.example',
      info: { error: { code: -32005, message: 'limit exceeded' } },
    })

    const mapped = mapProviderError(error, CHAIN_ID)

    expect(mapped).toBeInstanceOf(RpcError)
    expect((mapped as RpcError).rpcCode).toBe(-32005)
  })

  it('оставляет прочие ошибки библиотеки ошибкой RPC с запасным кодом', () => {
    const error = makeError('something went wrong', 'UNKNOWN_ERROR', {})

    const mapped = mapProviderError(error, CHAIN_ID)

    expect(mapped).toBeInstanceOf(RpcError)
    expect((mapped as RpcError).rpcCode).toBe(-32603)
  })

  it('считает отказ сети и истечение времени отказом узла', () => {
    const network = makeError('offline', 'NETWORK_ERROR', { event: 'disconnect' })
    const timeout = makeError('too slow', 'TIMEOUT', {
      operation: 'eth_getLogs',
      reason: 'timeout',
    })

    expect(mapProviderError(network, CHAIN_ID)).toBeInstanceOf(ProviderUnavailableError)
    expect(mapProviderError(timeout, CHAIN_ID)).toBeInstanceOf(ProviderUnavailableError)
  })

  it('не превращает откат вызова в отказ узла', () => {
    /* Обратная сторона правки: откат — это ответ по существу, и второй
       узел ответит то же самое. Перебирать адреса на нём нельзя. */
    const error = makeError('reverted', 'CALL_EXCEPTION', {
      action: 'call',
      data: null,
      reason: null,
      transaction: { to: null, data: '0x' },
      invocation: null,
      revert: null,
    })

    expect(mapProviderError(error, CHAIN_ID)).toBeInstanceOf(GasEstimationFailedError)
  })

  it('не превращает нехватку средств в отказ узла', () => {
    const error = makeError('no funds', 'INSUFFICIENT_FUNDS', { transaction: {} })

    expect(mapProviderError(error, CHAIN_ID)).toBeInstanceOf(InsufficientFundsError)
  })
})
