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
 * Checks that node errors map to domain errors.
 *
 * WHY A SEPARATE SUITE. Failover behavior depends on this mapping in a
 * way that does not look like an error concern: `FailoverProvider`
 * rotates backups exactly when it receives `ProviderUnavailableError`.
 * A misclassification here silently disables failover entirely — which
 * is what happened with an HTTP 500 response.
 *
 * Errors are built with ethers' own `makeError`, not by hand: a fake
 * would risk drifting from the library and asserting something that
 * does not exist.
 */
describe('mapProviderError', () => {
  it('treats an HTTP response with no JSON-RPC body as a node failure, not a node answer', () => {
    /* Exactly what arrived when a node refused a log query: ethers
       marks that as SERVER_ERROR and there is no JSON-RPC body. */
    /* The trailing space is not a typo: ethers concatenates the status
       with a reason, and an empty reason leaves it. Measured on a live
       node; the history screen showed `server response 500 `. */
    const error = makeError('server response 500 ', 'SERVER_ERROR', {
      request: 'https://node.example',
    })

    const mapped = mapProviderError(error, CHAIN_ID)

    expect(mapped).toBeInstanceOf(ProviderUnavailableError)

    /* And it names what happened, not an exhausted address list:
       this message reaches the history screen verbatim. */
    expect(mapped.message).toBe('server response 500')
  })

  it('does not replace a node answer with a failure when a JSON-RPC body is present', () => {
    /* A node may answer with a JSON-RPC error and a non-200 HTTP
       status. That is its answer, and the node code must pass through
       unaltered: otherwise `-32005` ("rate limited") would become
       "node unavailable", and failover would rotate addresses instead
       of waiting. */
    const error = makeError('server response 429', 'SERVER_ERROR', {
      request: 'https://node.example',
      info: { error: { code: -32005, message: 'limit exceeded' } },
    })

    const mapped = mapProviderError(error, CHAIN_ID)

    expect(mapped).toBeInstanceOf(RpcError)
    expect((mapped as RpcError).rpcCode).toBe(-32005)
  })

  it('keeps other library errors as an RPC error with the fallback code', () => {
    const error = makeError('something went wrong', 'UNKNOWN_ERROR', {})

    const mapped = mapProviderError(error, CHAIN_ID)

    expect(mapped).toBeInstanceOf(RpcError)
    expect((mapped as RpcError).rpcCode).toBe(-32603)
  })

  it('treats a network failure and a timeout as a node failure', () => {
    const network = makeError('offline', 'NETWORK_ERROR', { event: 'disconnect' })
    const timeout = makeError('too slow', 'TIMEOUT', {
      operation: 'eth_getLogs',
      reason: 'timeout',
    })

    expect(mapProviderError(network, CHAIN_ID)).toBeInstanceOf(ProviderUnavailableError)
    expect(mapProviderError(timeout, CHAIN_ID)).toBeInstanceOf(ProviderUnavailableError)
  })

  it('does not turn a call revert into a node failure', () => {
    /* The other side of the fix: a revert is an answer on the merits,
       and a second node would say the same. Addresses must not rotate
       on it. */
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

  it('does not turn insufficient funds into a node failure', () => {
    const error = makeError('no funds', 'INSUFFICIENT_FUNDS', { transaction: {} })

    expect(mapProviderError(error, CHAIN_ID)).toBeInstanceOf(InsufficientFundsError)
  })
})
