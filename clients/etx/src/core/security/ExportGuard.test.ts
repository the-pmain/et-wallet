import { beforeEach, describe, expect, it } from 'vitest'

import { ExportNotPermittedError } from '@/core/errors'
import { buildAccountPath } from '@/core/hdwallet'
import { FakeClock, InMemoryStorageService } from '@/test/doubles'

import { ExportAuditLog } from './ExportAuditLog'
import {
  ExportGuard,
  SIGNING_ACCOUNT_INDEX,
  WATCH_ONLY_ACCOUNT_INDEX,
  accountExportRequest,
  privateKeyExportRequest,
} from './ExportGuard'
import { EXPORT_KIND, EXPORT_RISK, EXPORT_RISK_REASON, hdAccountScope, riskLevel } from './types'

const SIGNING_ACCOUNT = hdAccountScope(buildAccountPath({ accountIndex: SIGNING_ACCOUNT_INDEX }))
const WATCH_ONLY_ACCOUNT = hdAccountScope(
  buildAccountPath({ accountIndex: WATCH_ONLY_ACCOUNT_INDEX }),
)

let clock: FakeClock
let auditLog: ExportAuditLog
let guard: ExportGuard

beforeEach(() => {
  clock = new FakeClock(1_700_000_000_000)
  auditLog = new ExportAuditLog(new InMemoryStorageService())
  guard = new ExportGuard(auditLog, clock)
})

describe('порядок уровней риска', () => {
  it('возрастает от низкого к критическому', () => {
    expect(riskLevel(EXPORT_RISK.Low)).toBeLessThan(riskLevel(EXPORT_RISK.Elevated))
    expect(riskLevel(EXPORT_RISK.Elevated)).toBeLessThan(riskLevel(EXPORT_RISK.AccountCompromise))
    expect(riskLevel(EXPORT_RISK.AccountCompromise)).toBeLessThan(riskLevel(EXPORT_RISK.Critical))
  })
})

describe('ExportGuard: секреты полного доступа', () => {
  it('оценивает мнемонику как критический риск', async () => {
    const assessment = await guard.assess(
      accountExportRequest(EXPORT_KIND.Mnemonic, SIGNING_ACCOUNT),
    )

    expect(assessment.risk).toBe(EXPORT_RISK.Critical)
    expect(assessment.reason).toBe(EXPORT_RISK_REASON.GrantsWholeWallet)
  })

  it('оценивает xprv как критический риск', async () => {
    const assessment = await guard.assess(accountExportRequest(EXPORT_KIND.Xprv, SIGNING_ACCOUNT))

    expect(assessment.risk).toBe(EXPORT_RISK.Critical)
    expect(assessment.reason).toBe(EXPORT_RISK_REASON.GrantsWholeAccount)
  })

  it('не понижает оценку xprv при чистой истории', async () => {
    const assessment = await guard.assess(
      accountExportRequest(EXPORT_KIND.Xprv, WATCH_ONLY_ACCOUNT),
    )

    expect(assessment.risk).toBe(EXPORT_RISK.Critical)
  })
})

describe('ExportGuard: обнаружение опасной пары', () => {
  /* Главное, ради чего существует модуль. По отдельности выдача xpub
     и выдача приватного ключа выглядят безобидно; вторая из них замыкает
     пару, после которой получатель вычисляет весь аккаунт. */

  it('приватный ключ после выданного xpub — компрометация аккаунта', async () => {
    await guard.confirm(
      accountExportRequest(EXPORT_KIND.Xpub, SIGNING_ACCOUNT),
      EXPORT_RISK.Elevated,
    )

    const assessment = await guard.assess(privateKeyExportRequest(SIGNING_ACCOUNT, 0))

    expect(assessment.risk).toBe(EXPORT_RISK.AccountCompromise)
    expect(assessment.reason).toBe(EXPORT_RISK_REASON.XpubAlreadyExported)
    expect(assessment.closesCompromisePair).toBe(true)
  })

  it('xpub после выданного приватного ключа — компрометация аккаунта', async () => {
    await guard.confirm(privateKeyExportRequest(SIGNING_ACCOUNT, 0), EXPORT_RISK.Elevated)

    const assessment = await guard.assess(accountExportRequest(EXPORT_KIND.Xpub, SIGNING_ACCOUNT))

    expect(assessment.risk).toBe(EXPORT_RISK.AccountCompromise)
    expect(assessment.reason).toBe(EXPORT_RISK_REASON.PrivateKeyAlreadyExported)
    expect(assessment.closesCompromisePair).toBe(true)
  })

  it('xpub после выданного xprv — компрометация аккаунта', async () => {
    await guard.confirm(
      accountExportRequest(EXPORT_KIND.Xprv, SIGNING_ACCOUNT),
      EXPORT_RISK.Critical,
    )

    const assessment = await guard.assess(accountExportRequest(EXPORT_KIND.Xpub, SIGNING_ACCOUNT))

    expect(assessment.risk).toBe(EXPORT_RISK.AccountCompromise)
  })

  it('замыкание пары определяется по конкретному адресу независимо', async () => {
    await guard.confirm(
      accountExportRequest(EXPORT_KIND.Xpub, SIGNING_ACCOUNT),
      EXPORT_RISK.Elevated,
    )

    /* Индекс адреса значения не имеет: приватный ключ ЛЮБОГО потомка
       вместе с родительским xpub раскрывает родительский ключ. */
    const assessment = await guard.assess(privateKeyExportRequest(SIGNING_ACCOUNT, 42))

    expect(assessment.risk).toBe(EXPORT_RISK.AccountCompromise)
  })
})

describe('ExportGuard: изоляция аккаунтов', () => {
  /* Уровень аккаунта в BIP-44 закалён, поэтому компрометация одного
     аккаунта не затрагивает другие. Это структурная мера, а не соглашение. */

  it('не переносит риск между разными аккаунтами', async () => {
    await guard.confirm(accountExportRequest(EXPORT_KIND.Xpub, WATCH_ONLY_ACCOUNT), EXPORT_RISK.Low)

    const assessment = await guard.assess(privateKeyExportRequest(SIGNING_ACCOUNT, 0))

    expect(assessment.risk).toBe(EXPORT_RISK.Elevated)
    expect(assessment.closesCompromisePair).toBe(false)
  })

  it('xpub из выделенного аккаунта наблюдения имеет низкий риск', async () => {
    const assessment = await guard.assess(
      accountExportRequest(EXPORT_KIND.Xpub, WATCH_ONLY_ACCOUNT),
    )

    expect(assessment.risk).toBe(EXPORT_RISK.Low)
    expect(assessment.suggestsSeparateAccount).toBe(false)
  })

  it('xpub из подписывающего аккаунта повышает риск и рекомендует отдельный', async () => {
    const assessment = await guard.assess(accountExportRequest(EXPORT_KIND.Xpub, SIGNING_ACCOUNT))

    expect(assessment.risk).toBe(EXPORT_RISK.Elevated)
    expect(assessment.reason).toBe(EXPORT_RISK_REASON.XpubFromSigningAccount)
    expect(assessment.suggestsSeparateAccount).toBe(true)
  })

  it('приватный ключ без выданного xpub имеет повышенный, но не критический риск', async () => {
    const assessment = await guard.assess(privateKeyExportRequest(SIGNING_ACCOUNT, 0))

    expect(assessment.risk).toBe(EXPORT_RISK.Elevated)
    expect(assessment.closesCompromisePair).toBe(false)
  })
})

describe('ExportGuard: подтверждение уровня риска', () => {
  it('выдаёт разрешение при точном совпадении уровня', async () => {
    const permit = await guard.confirm(
      accountExportRequest(EXPORT_KIND.Xpub, WATCH_ONLY_ACCOUNT),
      EXPORT_RISK.Low,
    )

    expect(permit.kind).toBe(EXPORT_KIND.Xpub)
    expect(permit.isConsumed).toBe(false)
  })

  it('выдаёт разрешение при подтверждении более высокого уровня', async () => {
    const permit = await guard.confirm(
      accountExportRequest(EXPORT_KIND.Xpub, WATCH_ONLY_ACCOUNT),
      EXPORT_RISK.Critical,
    )

    expect(permit.risk).toBe(EXPORT_RISK.Low)
  })

  it('отказывает, если интерфейс показал более мягкое предупреждение', async () => {
    /* Ключевая проверка. Без неё интерфейс мог бы показать «низкий риск»
       там, где выдача секрета раскрывает весь аккаунт, и оценка риска
       осталась бы декоративной. */
    await expect(
      guard.confirm(accountExportRequest(EXPORT_KIND.Xprv, SIGNING_ACCOUNT), EXPORT_RISK.Low),
    ).rejects.toThrow(ExportNotPermittedError)
  })

  it('отказывает при занижении на один уровень', async () => {
    await guard.confirm(
      accountExportRequest(EXPORT_KIND.Xpub, SIGNING_ACCOUNT),
      EXPORT_RISK.Elevated,
    )

    await expect(
      guard.confirm(privateKeyExportRequest(SIGNING_ACCOUNT, 0), EXPORT_RISK.Elevated),
    ).rejects.toThrow(ExportNotPermittedError)
  })

  it('не записывает в журнал при отказе', async () => {
    await expect(
      guard.confirm(accountExportRequest(EXPORT_KIND.Xprv, SIGNING_ACCOUNT), EXPORT_RISK.Low),
    ).rejects.toThrow()

    await expect(guard.getHistory(SIGNING_ACCOUNT)).resolves.toHaveLength(0)
  })
})

describe('ExportGuard: журнал', () => {
  it('записывает факт экспорта', async () => {
    await guard.confirm(accountExportRequest(EXPORT_KIND.Xpub, WATCH_ONLY_ACCOUNT), EXPORT_RISK.Low)

    const history = await guard.getHistory(WATCH_ONLY_ACCOUNT)

    expect(history).toHaveLength(1)
    expect(history[0]?.kind).toBe(EXPORT_KIND.Xpub)
    expect(history[0]?.risk).toBe(EXPORT_RISK.Low)
  })

  it('сохраняет момент экспорта', async () => {
    await guard.confirm(accountExportRequest(EXPORT_KIND.Xpub, WATCH_ONLY_ACCOUNT), EXPORT_RISK.Low)

    const history = await guard.getHistory(WATCH_ONLY_ACCOUNT)

    expect(history[0]?.at).toBe(1_700_000_000_000)
  })

  it('возвращает записи от новых к старым', async () => {
    await guard.confirm(privateKeyExportRequest(WATCH_ONLY_ACCOUNT, 0), EXPORT_RISK.Elevated)
    clock.advance(60_000)
    await guard.confirm(privateKeyExportRequest(WATCH_ONLY_ACCOUNT, 1), EXPORT_RISK.Critical)

    const history = await guard.getHistory(WATCH_ONLY_ACCOUNT)

    expect(history[0]?.addressIndex).toBe(1)
    expect(history[1]?.addressIndex).toBe(0)
  })

  it('записывает экспорт до выдачи разрешения', async () => {
    /* Направление ошибки выбрано сознательно: лишняя запись приводит
       к более строгому предупреждению, пропущенная — к отсутствию
       предупреждения там, где оно необходимо. */
    const permit = await guard.confirm(
      accountExportRequest(EXPORT_KIND.Xpub, WATCH_ONLY_ACCOUNT),
      EXPORT_RISK.Low,
    )

    expect(permit.isConsumed).toBe(false)
    await expect(guard.getHistory(WATCH_ONLY_ACCOUNT)).resolves.toHaveLength(1)
  })

  it('разделяет истории разных аккаунтов', async () => {
    await guard.confirm(accountExportRequest(EXPORT_KIND.Xpub, WATCH_ONLY_ACCOUNT), EXPORT_RISK.Low)

    await expect(guard.getHistory(SIGNING_ACCOUNT)).resolves.toHaveLength(0)
  })

  it('переживает пересоздание защитника поверх того же хранилища', async () => {
    const storage = new InMemoryStorageService()
    const first = new ExportGuard(new ExportAuditLog(storage), clock)
    await first.confirm(
      accountExportRequest(EXPORT_KIND.Xpub, SIGNING_ACCOUNT),
      EXPORT_RISK.Elevated,
    )

    const second = new ExportGuard(new ExportAuditLog(storage), clock)
    const assessment = await second.assess(privateKeyExportRequest(SIGNING_ACCOUNT, 0))

    expect(assessment.risk).toBe(EXPORT_RISK.AccountCompromise)
  })
})

describe('ExportAuditLog', () => {
  it('сообщает об отсутствии экспортов у нового аккаунта', async () => {
    await expect(auditLog.hasExported(SIGNING_ACCOUNT, EXPORT_KIND.Xpub)).resolves.toBe(false)
  })

  it('различает виды экспорта', async () => {
    await auditLog.record({
      kind: EXPORT_KIND.Xpub,
      scope: SIGNING_ACCOUNT,
      addressIndex: null,
      risk: EXPORT_RISK.Elevated,
      at: clock.now(),
    })

    await expect(auditLog.hasExported(SIGNING_ACCOUNT, EXPORT_KIND.Xpub)).resolves.toBe(true)
    await expect(auditLog.hasExported(SIGNING_ACCOUNT, EXPORT_KIND.PrivateKey)).resolves.toBe(false)
  })

  it('очищает историю аккаунта', async () => {
    await auditLog.record({
      kind: EXPORT_KIND.Xpub,
      scope: SIGNING_ACCOUNT,
      addressIndex: null,
      risk: EXPORT_RISK.Elevated,
      at: clock.now(),
    })
    await auditLog.clear(SIGNING_ACCOUNT)

    await expect(auditLog.listByScope(SIGNING_ACCOUNT)).resolves.toHaveLength(0)
  })
})
