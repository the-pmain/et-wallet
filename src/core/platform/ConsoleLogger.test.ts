import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConsoleLogger } from './ConsoleLogger'
import { LOG_LEVEL } from './Logger'

const ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'

/** Перехватывает вывод в консоль и возвращает записанные аргументы. */
function captureWarn(): { calls: unknown[][]; restore: () => void } {
  const calls: unknown[][] = []
  const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    calls.push(args)
  })

  return {
    calls,
    restore: () => {
      spy.mockRestore()
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ConsoleLogger: редакция секретов', () => {
  it('не выводит значение поля, похожего на секрет', () => {
    const { calls, restore } = captureWarn()
    const logger = new ConsoleLogger()

    logger.warn('Проверка', {
      password: 'Korova-7-Luna!',
      mnemonic: 'abandon abandon about',
      privateKey: '0xdeadbeef',
      seedPhrase: 'нечто',
      accountXprv: 'xprv…',
    })

    restore()

    const serialized = JSON.stringify(calls)

    expect(serialized).not.toContain('Korova-7-Luna!')
    expect(serialized).not.toContain('abandon')
    expect(serialized).not.toContain('0xdeadbeef')
    expect(serialized).not.toContain('нечто')
    expect(serialized).not.toContain('xprv…')
  })

  it('редактирует поле независимо от написания имени', () => {
    const { calls, restore } = captureWarn()
    const logger = new ConsoleLogger()

    logger.warn('Проверка', {
      PRIVATE_KEY: 'секрет-1',
      userPassword: 'секрет-2',
      recoverySeed: 'секрет-3',
    })

    restore()

    expect(JSON.stringify(calls)).not.toContain('секрет')
  })

  it('усекает адрес EVM', () => {
    const { calls, restore } = captureWarn()
    const logger = new ConsoleLogger()

    logger.warn('Проверка', { owner: ADDRESS })

    restore()

    const serialized = JSON.stringify(calls)

    /* Полный адрес в журнале связывает пользователя со всей его историей
       операций. Регистр контрольной суммы при этом сохраняется. */
    expect(serialized).not.toContain(ADDRESS)
    expect(serialized).toContain('0x5aAe…1BeAed')
  })

  it('скрывает адрес почты, названный полем-маркером', () => {
    const { calls, restore } = captureWarn()
    const logger = new ConsoleLogger()

    logger.warn('Проверка', { email: 'owner@example.com' })

    restore()

    expect(JSON.stringify(calls)).not.toContain('owner@example.com')
  })

  it('скрывает адрес почты и под посторонним именем поля', () => {
    /* Адрес попадает в журнал как имя аккаунта: первый аккаунт
       подписывается адресом владельца. Проверка по имени поля такой
       случай не поймала бы. */
    const { calls, restore } = captureWarn()
    const logger = new ConsoleLogger()

    logger.warn('Проверка', { name: 'owner@example.com' })

    restore()

    expect(JSON.stringify(calls)).not.toContain('owner@example.com')
  })

  it('переводит bigint в строку вместо отказа', () => {
    const { calls, restore } = captureWarn()
    const logger = new ConsoleLogger()

    /* `JSON.stringify` на bigint выбрасывает исключение. Запись журнала
       не имеет права уронить вызывающий код. */
    expect(() => {
      logger.warn('Проверка', { chainId: 1n })
    }).not.toThrow()

    restore()

    expect(JSON.stringify(calls)).toContain('"1"')
  })

  it('усекает адреса внутри массива', () => {
    const { calls, restore } = captureWarn()
    const logger = new ConsoleLogger()

    logger.warn('Проверка', { accounts: [ADDRESS] })

    restore()

    expect(JSON.stringify(calls)).not.toContain(ADDRESS)
  })
})

describe('ConsoleLogger: уровни', () => {
  it('по умолчанию не выводит debug и info', () => {
    const { calls, restore } = captureWarn()
    const logger = new ConsoleLogger()

    logger.debug('подробность')
    logger.info('сведение')

    restore()

    expect(calls).toHaveLength(0)
  })

  it('выводит warn и error', () => {
    const { calls, restore } = captureWarn()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const logger = new ConsoleLogger()

    logger.warn('предупреждение')
    logger.error('отказ')

    restore()

    expect(calls).toHaveLength(1)
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('пропускает info при пониженном пороге', () => {
    const { calls, restore } = captureWarn()
    const logger = new ConsoleLogger({ minimumLevel: LOG_LEVEL.Debug })

    logger.info('сведение')

    restore()

    expect(calls).toHaveLength(1)
  })
})

describe('ConsoleLogger: область', () => {
  it('добавляет имя модуля к сообщению', () => {
    const { calls, restore } = captureWarn()
    const logger = new ConsoleLogger().child('WalletSession')

    logger.warn('Сообщение')

    restore()

    expect(calls[0]?.[0]).toBe('[WalletSession] Сообщение')
  })

  it('накапливает вложенные области', () => {
    const { calls, restore } = captureWarn()
    const logger = new ConsoleLogger().child('WalletSession').child('BalanceService')

    logger.warn('Сообщение')

    restore()

    expect(calls[0]?.[0]).toBe('[WalletSession.BalanceService] Сообщение')
  })

  it('сохраняет порог уровня у дочернего логгера', () => {
    const { calls, restore } = captureWarn()
    const logger = new ConsoleLogger({ minimumLevel: LOG_LEVEL.Debug }).child('Модуль')

    logger.debug('подробность')

    restore()

    expect(calls).toHaveLength(1)
  })
})
