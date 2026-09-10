import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConsoleLogger } from './ConsoleLogger'
import { LOG_LEVEL } from './Logger'

const ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'

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

describe('ConsoleLogger: secret redaction', () => {
  it('does not print a field whose name looks like a secret', () => {
    const { calls, restore } = captureWarn()
    const logger = new ConsoleLogger()

    logger.warn('Check', {
      password: 'Korova-7-Luna!',
      mnemonic: 'abandon abandon about',
      privateKey: '0xdeadbeef',
      seedPhrase: 'something',
      accountXprv: 'xprv…',
    })

    restore()

    const serialized = JSON.stringify(calls)

    expect(serialized).not.toContain('Korova-7-Luna!')
    expect(serialized).not.toContain('abandon')
    expect(serialized).not.toContain('0xdeadbeef')
    expect(serialized).not.toContain('something')
    expect(serialized).not.toContain('xprv…')
  })

  it('redacts a field regardless of how the name is spelled', () => {
    const { calls, restore } = captureWarn()
    const logger = new ConsoleLogger()

    logger.warn('Check', {
      PRIVATE_KEY: 'secret-1',
      userPassword: 'secret-2',
      recoverySeed: 'secret-3',
    })

    restore()

    expect(JSON.stringify(calls)).not.toContain('secret')
  })

  it('truncates an EVM address', () => {
    const { calls, restore } = captureWarn()
    const logger = new ConsoleLogger()

    logger.warn('Check', { owner: ADDRESS })

    restore()

    const serialized = JSON.stringify(calls)

    /* A full address in the log ties the user to their whole
       history. Checksum case is preserved. */
    expect(serialized).not.toContain(ADDRESS)
    expect(serialized).toContain('0x5aAe…1BeAed')
  })

  it('hides an email named by a marker field', () => {
    const { calls, restore } = captureWarn()
    const logger = new ConsoleLogger()

    logger.warn('Check', { email: 'owner@example.com' })

    restore()

    expect(JSON.stringify(calls)).not.toContain('owner@example.com')
  })

  it('hides an email under an unrelated field name as well', () => {
    /* An address lands in the log as an account name: the first
       account is labelled with the owner's address. A check on the
       field name would miss that case. */
    const { calls, restore } = captureWarn()
    const logger = new ConsoleLogger()

    logger.warn('Checking', { name: 'owner@example.com' })

    restore()

    expect(JSON.stringify(calls)).not.toContain('owner@example.com')
  })

  it('turns bigint into a string instead of failing', () => {
    const { calls, restore } = captureWarn()
    const logger = new ConsoleLogger()

    /* `JSON.stringify` throws on bigint. A log write must not crash
       the caller. */
    expect(() => {
      logger.warn('Check', { chainId: 1n })
    }).not.toThrow()

    restore()

    expect(JSON.stringify(calls)).toContain('"1"')
  })

  it('truncates addresses inside an array', () => {
    const { calls, restore } = captureWarn()
    const logger = new ConsoleLogger()

    logger.warn('Check', { accounts: [ADDRESS] })

    restore()

    expect(JSON.stringify(calls)).not.toContain(ADDRESS)
  })
})

describe('ConsoleLogger: levels', () => {
  it('does not print debug and info by default', () => {
    const { calls, restore } = captureWarn()
    const logger = new ConsoleLogger()

    logger.debug('detail')
    logger.info('info')

    restore()

    expect(calls).toHaveLength(0)
  })

  it('prints warn and error', () => {
    const { calls, restore } = captureWarn()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const logger = new ConsoleLogger()

    logger.warn('warning')
    logger.error('failure')

    restore()

    expect(calls).toHaveLength(1)
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('lets info through when the threshold is lowered', () => {
    const { calls, restore } = captureWarn()
    const logger = new ConsoleLogger({ minimumLevel: LOG_LEVEL.Debug })

    logger.info('info')

    restore()

    expect(calls).toHaveLength(1)
  })
})

describe('ConsoleLogger: scope', () => {
  it('adds the module name to the message', () => {
    const { calls, restore } = captureWarn()
    const logger = new ConsoleLogger().child('WalletSession')

    logger.warn('Message')

    restore()

    expect(calls[0]?.[0]).toBe('[WalletSession] Message')
  })

  it('accumulates nested scopes', () => {
    const { calls, restore } = captureWarn()
    const logger = new ConsoleLogger().child('WalletSession').child('BalanceService')

    logger.warn('Message')

    restore()

    expect(calls[0]?.[0]).toBe('[WalletSession.BalanceService] Message')
  })

  it('keeps the level threshold on a child logger', () => {
    const { calls, restore } = captureWarn()
    const logger = new ConsoleLogger({ minimumLevel: LOG_LEVEL.Debug }).child('Module')

    logger.debug('detail')

    restore()

    expect(calls).toHaveLength(1)
  })
})
