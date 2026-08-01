import { describe, expect, it } from 'vitest'

import { AppError, isAppError } from './AppError'
import { ERROR_CODE } from './ErrorCode'
import { ChainIdMismatchError, RpcError } from './NetworkErrors'
import { NotImplementedError } from './NotImplementedError'
import { InsufficientFundsError, UserRejectedError } from './TransactionErrors'
import { InvalidPasswordError, WalletLockedError } from './WalletErrors'

/**
 * Этап 2 состоит из типов и интерфейсов, поэтому исполняемого кода в нём
 * почти нет. Исключение — иерархия ошибок. Проверяется именно она.
 */

describe('ERROR_CODE', () => {
  it('не содержит повторяющихся значений', () => {
    const values = Object.values(ERROR_CODE)

    expect(new Set(values).size).toBe(values.length)
  })

  it('использует единый формат SCREAMING_SNAKE_CASE', () => {
    for (const value of Object.values(ERROR_CODE)) {
      expect(value).toMatch(/^[A-Z][A-Z0-9_]*$/)
    }
  })
})

describe('AppError', () => {
  it('распознаётся функцией isAppError', () => {
    expect(isAppError(new WalletLockedError('signTransaction'))).toBe(true)
  })

  it('не распознаёт обычную ошибку как прикладную', () => {
    expect(isAppError(new Error('обычная ошибка'))).toBe(false)
    expect(isAppError('строка')).toBe(false)
    expect(isAppError(null)).toBe(false)
  })

  it('остаётся экземпляром Error и пригоден для throw', () => {
    expect(() => {
      throw new InvalidPasswordError()
    }).toThrow(Error)
  })

  it('сохраняет исходную ошибку в cause', () => {
    const cause = new Error('низкоуровневый сбой')
    class TestError extends AppError {
      readonly code = 'TEST'
      constructor() {
        super('обёртка', { cause })
      }
    }

    expect(new TestError().cause).toBe(cause)
  })
})

describe('коды конкретных ошибок', () => {
  it('соответствуют реестру', () => {
    expect(new WalletLockedError('unlock').code).toBe(ERROR_CODE.WalletLocked)
    expect(new InvalidPasswordError().code).toBe(ERROR_CODE.InvalidPassword)
    expect(new NotImplementedError('Service.method').code).toBe(ERROR_CODE.NotImplemented)
  })
})

describe('InvalidPasswordError', () => {
  it('не раскрывает подробностей проверки', () => {
    const message = new InvalidPasswordError().message

    expect(message).toBe('Неверный пароль.')
  })
})

describe('ChainIdMismatchError', () => {
  it('сохраняет оба идентификатора для разбора инцидента', () => {
    const error = new ChainIdMismatchError(1n, 137n)

    expect(error.expected).toBe(1n)
    expect(error.actual).toBe(137n)
    expect(error.message).toContain('137')
    expect(error.message).toContain('1')
  })
})

describe('InsufficientFundsError', () => {
  it('хранит суммы в bigint без потери точности', () => {
    const required = 12345678901234567890n
    const error = new InsufficientFundsError(required, 0n)

    expect(error.required).toBe(required)
    expect(error.available).toBe(0n)
  })
})

describe('RpcError', () => {
  it('сохраняет числовой код JSON-RPC отдельно от текста', () => {
    const error = new RpcError(-32000, 'execution reverted', { detail: 'x' })

    expect(error.rpcCode).toBe(-32000)
    expect(error.data).toEqual({ detail: 'x' })
  })
})

describe('UserRejectedError', () => {
  it('объявляет код отказа EIP-1193', () => {
    expect(UserRejectedError.EIP1193_CODE).toBe(4001)
  })
})
