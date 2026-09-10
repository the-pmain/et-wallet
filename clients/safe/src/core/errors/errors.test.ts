import { describe, expect, it } from 'vitest'

import { AppError, isAppError } from './AppError'
import { ERROR_CODE } from './ErrorCode'
import { ChainIdMismatchError, RpcError } from './NetworkErrors'
import { NotImplementedError } from './NotImplementedError'
import { InsufficientFundsError, UserRejectedError } from './TransactionErrors'
import { InvalidPasswordError, WalletLockedError } from './WalletErrors'

/**
 * Stage 2 is types and interfaces, so there is almost no executable
 * code in it. The exception is the error hierarchy. That is what is
 * tested.
 */

describe('ERROR_CODE', () => {
  it('contains no duplicate values', () => {
    const values = Object.values(ERROR_CODE)

    expect(new Set(values).size).toBe(values.length)
  })

  it('uses a single SCREAMING_SNAKE_CASE format', () => {
    for (const value of Object.values(ERROR_CODE)) {
      expect(value).toMatch(/^[A-Z][A-Z0-9_]*$/)
    }
  })
})

describe('AppError', () => {
  it('is recognised by isAppError', () => {
    expect(isAppError(new WalletLockedError('signTransaction'))).toBe(true)
  })

  it('does not treat an ordinary error as an application error', () => {
    expect(isAppError(new Error('ordinary error'))).toBe(false)
    expect(isAppError('string')).toBe(false)
    expect(isAppError(null)).toBe(false)
  })

  it('remains an Error instance and can be thrown', () => {
    expect(() => {
      throw new InvalidPasswordError()
    }).toThrow(Error)
  })

  it('keeps the original error in cause', () => {
    const cause = new Error('low-level failure')
    class TestError extends AppError {
      readonly code = 'TEST'
      constructor() {
        super('wrapper', { cause })
      }
    }

    expect(new TestError().cause).toBe(cause)
  })
})

describe('codes of concrete errors', () => {
  it('match the registry', () => {
    expect(new WalletLockedError('unlock').code).toBe(ERROR_CODE.WalletLocked)
    expect(new InvalidPasswordError().code).toBe(ERROR_CODE.InvalidPassword)
    expect(new NotImplementedError('Service.method').code).toBe(ERROR_CODE.NotImplemented)
  })
})

describe('InvalidPasswordError', () => {
  it('does not reveal check details', () => {
    const message = new InvalidPasswordError().message

    expect(message).toBe('Wrong password.')
  })
})

describe('ChainIdMismatchError', () => {
  it('keeps both identifiers for incident analysis', () => {
    const error = new ChainIdMismatchError(1n, 137n)

    expect(error.expected).toBe(1n)
    expect(error.actual).toBe(137n)
    expect(error.message).toContain('137')
    expect(error.message).toContain('1')
  })
})

describe('InsufficientFundsError', () => {
  it('stores amounts as bigint without losing precision', () => {
    const required = 12345678901234567890n
    const error = new InsufficientFundsError(required, 0n)

    expect(error.required).toBe(required)
    expect(error.available).toBe(0n)
  })
})

describe('RpcError', () => {
  it('keeps the numeric JSON-RPC code separate from the text', () => {
    const error = new RpcError(-32000, 'execution reverted', { detail: 'x' })

    expect(error.rpcCode).toBe(-32000)
    expect(error.data).toEqual({ detail: 'x' })
  })
})

describe('UserRejectedError', () => {
  it('declares the EIP-1193 rejection code', () => {
    expect(UserRejectedError.EIP1193_CODE).toBe(4001)
  })
})
