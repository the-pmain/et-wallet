import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeClock } from '@/test/doubles'

import { AutoLockService } from './AutoLockService'

const TIMEOUT_MS = 60_000
const WARNING_MS = 10_000

let clock: FakeClock
let service: AutoLockService

beforeEach(() => {
  clock = new FakeClock(1_700_000_000_000)
  service = new AutoLockService({ clock }, { timeoutMs: TIMEOUT_MS, warningMs: WARNING_MS })
})

describe('AutoLockService: отсчёт', () => {
  it('до запуска остаток неизвестен', () => {
    /* «Не запущено» и «осталось ноль» — разные состояния, и второе
       означает немедленную блокировку. */
    expect(service.remainingMs).toBeNull()
    expect(service.isRunning).toBe(false)
  })

  it('после запуска остаток равен полному сроку', () => {
    service.start()

    expect(service.remainingMs).toBe(TIMEOUT_MS)
  })

  it('остаток уменьшается со временем', () => {
    service.start()
    clock.advance(20_000)

    expect(service.remainingMs).toBe(TIMEOUT_MS - 20_000)
  })

  it('остановка снимает отсчёт', () => {
    service.start()
    service.stop()

    expect(service.remainingMs).toBeNull()
    expect(service.isRunning).toBe(false)
  })

  it('повторный запуск не создаёт второй таймер', () => {
    const expired = vi.fn()

    service.on('autolock:expired', expired)
    service.start()
    service.start()

    clock.advance(TIMEOUT_MS + 1000)

    expect(expired).toHaveBeenCalledTimes(1)
  })
})

describe('AutoLockService: истечение срока', () => {
  it('сообщает об истечении по достижении срока', () => {
    const expired = vi.fn()

    service.on('autolock:expired', expired)
    service.start()

    clock.advance(TIMEOUT_MS + 1000)

    expect(expired).toHaveBeenCalledTimes(1)
  })

  it('не сообщает раньше срока', () => {
    const expired = vi.fn()

    service.on('autolock:expired', expired)
    service.start()

    clock.advance(TIMEOUT_MS - 5000)

    expect(expired).not.toHaveBeenCalled()
  })

  it('останавливает отсчёт до вызова обработчика', () => {
    /* Обработчик блокирует кошелёк; таймер, переживший блокировку,
       обращался бы к уничтоженным сервисам. */
    let runningInsideHandler: boolean | null = null

    service.on('autolock:expired', () => {
      runningInsideHandler = service.isRunning
    })
    service.start()

    clock.advance(TIMEOUT_MS + 1000)

    expect(runningInsideHandler).toBe(false)
  })

  it('активность откладывает блокировку', () => {
    const expired = vi.fn()

    service.on('autolock:expired', expired)
    service.start()

    clock.advance(TIMEOUT_MS - 5000)
    service.notifyActivity()
    clock.advance(TIMEOUT_MS - 5000)

    expect(expired).not.toHaveBeenCalled()
  })

  it('активность после остановки ничего не запускает', () => {
    const expired = vi.fn()

    service.on('autolock:expired', expired)
    service.start()
    service.stop()
    service.notifyActivity()

    clock.advance(TIMEOUT_MS + 1000)

    expect(expired).not.toHaveBeenCalled()
  })
})

describe('AutoLockService: предупреждение', () => {
  it('предупреждает до блокировки', () => {
    /* Блокировка посреди заполнения формы теряет введённое.
       Предупреждение даёт продлить сессию одним движением. */
    const warned = vi.fn()

    service.on('autolock:warning', warned)
    service.start()

    clock.advance(TIMEOUT_MS - WARNING_MS + 1000)

    expect(warned).toHaveBeenCalledTimes(1)
  })

  it('предупреждает один раз, а не на каждом такте', () => {
    const warned = vi.fn()

    service.on('autolock:warning', warned)
    service.start()

    clock.advance(TIMEOUT_MS - 2000)

    expect(warned).toHaveBeenCalledTimes(1)
  })

  it('сообщает оставшееся время', () => {
    const warned = vi.fn()

    service.on('autolock:warning', warned)
    service.start()

    clock.advance(TIMEOUT_MS - WARNING_MS + 1000)

    expect(warned.mock.calls[0]?.[0]).toMatchObject({ remainingMs: expect.any(Number) })
  })

  it('активность снимает предупреждение', () => {
    /* Иначе оно висело бы до самой блокировки, которой уже не будет. */
    const resumed = vi.fn()

    service.on('autolock:resumed', resumed)
    service.start()

    clock.advance(TIMEOUT_MS - WARNING_MS + 1000)
    service.notifyActivity()

    expect(resumed).toHaveBeenCalledTimes(1)
  })

  it('без предупреждения активность не сообщает о возобновлении', () => {
    const resumed = vi.fn()

    service.on('autolock:resumed', resumed)
    service.start()
    service.notifyActivity()

    expect(resumed).not.toHaveBeenCalled()
  })
})

describe('AutoLockService: смена срока', () => {
  it('новый срок применяется с начала отсчёта', () => {
    /* Применить новый срок к уже прошедшему времени значило бы
       заблокировать кошелёк немедленно при выборе более короткого. */
    service.start()
    clock.advance(50_000)

    service.setTimeout(30_000)

    expect(service.remainingMs).toBe(30_000)
  })

  it('смена срока у остановленного сервиса не запускает отсчёт', () => {
    service.setTimeout(30_000)

    expect(service.isRunning).toBe(false)
  })

  it('предупреждение не длиннее половины короткого срока', () => {
    /* Иначе оно показывалось бы с первой секунды и перестало бы
       означать «скоро заблокируется». */
    const warned = vi.fn()

    service.on('autolock:warning', warned)
    service.setTimeout(20_000)
    service.start()

    clock.advance(5000)

    expect(warned).not.toHaveBeenCalled()
  })
})
