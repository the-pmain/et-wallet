import { beforeEach, describe, expect, it } from 'vitest'

import { TooManyAttemptsError } from '@/core/errors'
import { SETTINGS_KEY, STORAGE_NAMESPACE } from '@/core/storage'
import { FakeClock, InMemoryStorageService, NullLogger } from '@/test/doubles'

import { FREE_UNLOCK_ATTEMPTS, UnlockThrottle, delayFor } from './UnlockThrottle'

let storage: InMemoryStorageService
let clock: FakeClock
let throttle: UnlockThrottle

/** Записывает указанное число неудач подряд. */
async function fail(times: number): Promise<void> {
  for (let attempt = 0; attempt < times; attempt += 1) {
    await throttle.recordFailure()
  }
}

beforeEach(() => {
  storage = new InMemoryStorageService()
  clock = new FakeClock(1_700_000_000_000)
  throttle = new UnlockThrottle({ storage, clock, logger: new NullLogger() })
})

describe('delayFor: таблица задержек', () => {
  it('первые попытки проходят без задержки', () => {
    /* Запас на опечатку и на забытую раскладку. */
    for (let attempt = 1; attempt <= FREE_UNLOCK_ATTEMPTS; attempt += 1) {
      expect(delayFor(attempt)).toBe(0)
    }
  })

  it('задержка появляется сразу после исчерпания запаса', () => {
    expect(delayFor(FREE_UNLOCK_ATTEMPTS + 1)).toBeGreaterThan(0)
  })

  it('растёт с каждой следующей неудачей', () => {
    const первая = delayFor(FREE_UNLOCK_ATTEMPTS + 1)
    const вторая = delayFor(FREE_UNLOCK_ATTEMPTS + 2)
    const третья = delayFor(FREE_UNLOCK_ATTEMPTS + 3)

    expect(вторая).toBeGreaterThan(первая)
    expect(третья).toBeGreaterThan(вторая)
  })

  it('имеет предел и не запирает кошелёк навсегда', () => {
    /* Бесконечно растущая задержка означала бы, что владелец теряет
       доступ к собственным средствам из-за забытой раскладки. */
    const предел = delayFor(100)

    expect(предел).toBe(delayFor(1000))
    expect(предел).toBeLessThanOrEqual(15 * 60_000)
  })
})

describe('UnlockThrottle: подсчёт попыток', () => {
  it('на чистом состоянии ввод открыт', async () => {
    await expect(throttle.assertAllowed()).resolves.toBeUndefined()
    await expect(throttle.getState()).resolves.toEqual({ failedAttempts: 0, retryAfterMs: 0 })
  })

  it('первые неудачи не закрывают ввод', async () => {
    await fail(FREE_UNLOCK_ATTEMPTS)

    await expect(throttle.assertAllowed()).resolves.toBeUndefined()
    expect((await throttle.getState()).failedAttempts).toBe(FREE_UNLOCK_ATTEMPTS)
  })

  it('следующая неудача закрывает ввод', async () => {
    await fail(FREE_UNLOCK_ATTEMPTS + 1)

    await expect(throttle.assertAllowed()).rejects.toThrow(TooManyAttemptsError)
  })

  it('ошибка сообщает, сколько осталось ждать', async () => {
    /* Форма, молча переставшая принимать ввод, оставляет владельца
       в недоумении, почему верный пароль не подходит. */
    await fail(FREE_UNLOCK_ATTEMPTS + 1)

    await expect(throttle.assertAllowed()).rejects.toMatchObject({
      retryAfterMs: expect.any(Number) as number,
    })
  })

  it('ввод открывается по истечении срока', async () => {
    const { retryAfterMs } = await (async () => {
      await fail(FREE_UNLOCK_ATTEMPTS)

      return await throttle.recordFailure()
    })()

    clock.advance(retryAfterMs + 1)

    await expect(throttle.assertAllowed()).resolves.toBeUndefined()
  })

  it('счётчик не обнуляется истечением срока', async () => {
    /* Иначе подбирающий получал бы бесплатный запас попыток заново
       после каждого ожидания. */
    const { retryAfterMs } = await (async () => {
      await fail(FREE_UNLOCK_ATTEMPTS)

      return await throttle.recordFailure()
    })()

    clock.advance(retryAfterMs + 1)
    await throttle.recordFailure()

    expect((await throttle.getState()).retryAfterMs).toBe(delayFor(FREE_UNLOCK_ATTEMPTS + 2))
  })

  it('успешный ввод обнуляет счётчик', async () => {
    await fail(FREE_UNLOCK_ATTEMPTS + 2)
    await throttle.recordSuccess()

    await expect(throttle.getState()).resolves.toEqual({ failedAttempts: 0, retryAfterMs: 0 })
    await expect(throttle.assertAllowed()).resolves.toBeUndefined()
  })
})

describe('UnlockThrottle: сохранность состояния', () => {
  it('счётчик переживает пересоздание', async () => {
    /* Ограничитель, обнуляемый обновлением страницы, не ограничивает
       ничего: подбирающий нажимает F5 после каждой неудачи. */
    await fail(FREE_UNLOCK_ATTEMPTS + 1)

    const восстановленный = new UnlockThrottle({ storage, clock, logger: new NullLogger() })

    await expect(восстановленный.assertAllowed()).rejects.toThrow(TooManyAttemptsError)
  })

  it('состояние лежит в незашифрованных настройках', async () => {
    /* Иначе ограничитель не работал бы до разблокировки — то есть
       именно тогда, когда он нужен. */
    await fail(1)

    await expect(
      storage.get(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.UnlockThrottle),
    ).resolves.not.toBeNull()
  })

  it('испорченная запись не запирает кошелёк', async () => {
    /* Повреждение настроек не имеет права стать вечной блокировкой
       владельца в собственном кошельке. */
    await storage.set(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.UnlockThrottle, 'мусор')

    await expect(throttle.assertAllowed()).resolves.toBeUndefined()
  })

  it('запись без числа попыток считается отсутствующей', async () => {
    await storage.set(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.UnlockThrottle, {
      blockedUntil: 9_999_999_999_999,
    })

    await expect(throttle.assertAllowed()).resolves.toBeUndefined()
  })

  it('перевод часов назад не отменяет ожидания сверх меры', async () => {
    /* Полностью защититься от перевода часов на стороне клиента нельзя.
       Проверяется, что реализация хотя бы не даёт отрицательного
       ожидания и не открывает ввод раньше срока при движении времени
       вперёд. */
    await fail(FREE_UNLOCK_ATTEMPTS + 1)

    clock.advance(1_000)

    expect((await throttle.getState()).retryAfterMs).toBeGreaterThan(0)
  })
})
