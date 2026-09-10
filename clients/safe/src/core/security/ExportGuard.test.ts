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

describe('risk-level order', () => {
  it('rises from low to critical', () => {
    expect(riskLevel(EXPORT_RISK.Low)).toBeLessThan(riskLevel(EXPORT_RISK.Elevated))
    expect(riskLevel(EXPORT_RISK.Elevated)).toBeLessThan(riskLevel(EXPORT_RISK.AccountCompromise))
    expect(riskLevel(EXPORT_RISK.AccountCompromise)).toBeLessThan(riskLevel(EXPORT_RISK.Critical))
  })
})

describe('ExportGuard: full-access secrets', () => {
  it('rates a mnemonic as critical risk', async () => {
    const assessment = await guard.assess(
      accountExportRequest(EXPORT_KIND.Mnemonic, SIGNING_ACCOUNT),
    )

    expect(assessment.risk).toBe(EXPORT_RISK.Critical)
    expect(assessment.reason).toBe(EXPORT_RISK_REASON.GrantsWholeWallet)
  })

  it('rates an xprv as critical risk', async () => {
    const assessment = await guard.assess(accountExportRequest(EXPORT_KIND.Xprv, SIGNING_ACCOUNT))

    expect(assessment.risk).toBe(EXPORT_RISK.Critical)
    expect(assessment.reason).toBe(EXPORT_RISK_REASON.GrantsWholeAccount)
  })

  it('does not lower the xprv rating on a clean history', async () => {
    const assessment = await guard.assess(
      accountExportRequest(EXPORT_KIND.Xprv, WATCH_ONLY_ACCOUNT),
    )

    expect(assessment.risk).toBe(EXPORT_RISK.Critical)
  })
})

describe('ExportGuard: detecting the dangerous pair', () => {
  /* The reason this module exists. On their own, an xpub export and a
     private-key export look harmless; the second closes the pair,
     after which the recipient computes the whole account. */

  it('a private key after an exported xpub is account compromise', async () => {
    await guard.confirm(
      accountExportRequest(EXPORT_KIND.Xpub, SIGNING_ACCOUNT),
      EXPORT_RISK.Elevated,
    )

    const assessment = await guard.assess(privateKeyExportRequest(SIGNING_ACCOUNT, 0))

    expect(assessment.risk).toBe(EXPORT_RISK.AccountCompromise)
    expect(assessment.reason).toBe(EXPORT_RISK_REASON.XpubAlreadyExported)
    expect(assessment.closesCompromisePair).toBe(true)
  })

  it('an xpub after an exported private key is account compromise', async () => {
    await guard.confirm(privateKeyExportRequest(SIGNING_ACCOUNT, 0), EXPORT_RISK.Elevated)

    const assessment = await guard.assess(accountExportRequest(EXPORT_KIND.Xpub, SIGNING_ACCOUNT))

    expect(assessment.risk).toBe(EXPORT_RISK.AccountCompromise)
    expect(assessment.reason).toBe(EXPORT_RISK_REASON.PrivateKeyAlreadyExported)
    expect(assessment.closesCompromisePair).toBe(true)
  })

  it('an xpub after an exported xprv is account compromise', async () => {
    await guard.confirm(
      accountExportRequest(EXPORT_KIND.Xprv, SIGNING_ACCOUNT),
      EXPORT_RISK.Critical,
    )

    const assessment = await guard.assess(accountExportRequest(EXPORT_KIND.Xpub, SIGNING_ACCOUNT))

    expect(assessment.risk).toBe(EXPORT_RISK.AccountCompromise)
  })

  it('pair-closing is detected for a specific address independently', async () => {
    await guard.confirm(
      accountExportRequest(EXPORT_KIND.Xpub, SIGNING_ACCOUNT),
      EXPORT_RISK.Elevated,
    )

    /* The address index does not matter: the private key of ANY child
       plus the parent xpub reveals the parent key. */
    const assessment = await guard.assess(privateKeyExportRequest(SIGNING_ACCOUNT, 42))

    expect(assessment.risk).toBe(EXPORT_RISK.AccountCompromise)
  })
})

describe('ExportGuard: account isolation', () => {
  /* The BIP-44 account level is hardened, so compromising one account
     does not touch the others. That is a structural defence, not a
     convention. */

  it('does not carry risk across accounts', async () => {
    await guard.confirm(accountExportRequest(EXPORT_KIND.Xpub, WATCH_ONLY_ACCOUNT), EXPORT_RISK.Low)

    const assessment = await guard.assess(privateKeyExportRequest(SIGNING_ACCOUNT, 0))

    expect(assessment.risk).toBe(EXPORT_RISK.Elevated)
    expect(assessment.closesCompromisePair).toBe(false)
  })

  it('an xpub from the dedicated watch account has low risk', async () => {
    const assessment = await guard.assess(
      accountExportRequest(EXPORT_KIND.Xpub, WATCH_ONLY_ACCOUNT),
    )

    expect(assessment.risk).toBe(EXPORT_RISK.Low)
    expect(assessment.suggestsSeparateAccount).toBe(false)
  })

  it('an xpub from the signing account raises risk and recommends a separate one', async () => {
    const assessment = await guard.assess(accountExportRequest(EXPORT_KIND.Xpub, SIGNING_ACCOUNT))

    expect(assessment.risk).toBe(EXPORT_RISK.Elevated)
    expect(assessment.reason).toBe(EXPORT_RISK_REASON.XpubFromSigningAccount)
    expect(assessment.suggestsSeparateAccount).toBe(true)
  })

  it('a private key without an exported xpub has elevated, not critical, risk', async () => {
    const assessment = await guard.assess(privateKeyExportRequest(SIGNING_ACCOUNT, 0))

    expect(assessment.risk).toBe(EXPORT_RISK.Elevated)
    expect(assessment.closesCompromisePair).toBe(false)
  })
})

describe('ExportGuard: acknowledging the risk level', () => {
  it('issues a permit when the level matches exactly', async () => {
    const permit = await guard.confirm(
      accountExportRequest(EXPORT_KIND.Xpub, WATCH_ONLY_ACCOUNT),
      EXPORT_RISK.Low,
    )

    expect(permit.kind).toBe(EXPORT_KIND.Xpub)
    expect(permit.isConsumed).toBe(false)
  })

  it('issues a permit when a higher level is acknowledged', async () => {
    const permit = await guard.confirm(
      accountExportRequest(EXPORT_KIND.Xpub, WATCH_ONLY_ACCOUNT),
      EXPORT_RISK.Critical,
    )

    expect(permit.risk).toBe(EXPORT_RISK.Low)
  })

  it('refuses if the UI showed a softer warning', async () => {
    /* The key check. Without it the UI could show "low risk" where
       releasing the secret opens the whole account, and the
       assessment would stay decorative. */
    await expect(
      guard.confirm(accountExportRequest(EXPORT_KIND.Xprv, SIGNING_ACCOUNT), EXPORT_RISK.Low),
    ).rejects.toThrow(ExportNotPermittedError)
  })

  it('refuses when understated by one level', async () => {
    await guard.confirm(
      accountExportRequest(EXPORT_KIND.Xpub, SIGNING_ACCOUNT),
      EXPORT_RISK.Elevated,
    )

    await expect(
      guard.confirm(privateKeyExportRequest(SIGNING_ACCOUNT, 0), EXPORT_RISK.Elevated),
    ).rejects.toThrow(ExportNotPermittedError)
  })

  it('does not write to the log on refusal', async () => {
    await expect(
      guard.confirm(accountExportRequest(EXPORT_KIND.Xprv, SIGNING_ACCOUNT), EXPORT_RISK.Low),
    ).rejects.toThrow()

    await expect(guard.getHistory(SIGNING_ACCOUNT)).resolves.toHaveLength(0)
  })
})

describe('ExportGuard: log', () => {
  it('records the fact of an export', async () => {
    await guard.confirm(accountExportRequest(EXPORT_KIND.Xpub, WATCH_ONLY_ACCOUNT), EXPORT_RISK.Low)

    const history = await guard.getHistory(WATCH_ONLY_ACCOUNT)

    expect(history).toHaveLength(1)
    expect(history[0]?.kind).toBe(EXPORT_KIND.Xpub)
    expect(history[0]?.risk).toBe(EXPORT_RISK.Low)
  })

  it('keeps the export timestamp', async () => {
    await guard.confirm(accountExportRequest(EXPORT_KIND.Xpub, WATCH_ONLY_ACCOUNT), EXPORT_RISK.Low)

    const history = await guard.getHistory(WATCH_ONLY_ACCOUNT)

    expect(history[0]?.at).toBe(1_700_000_000_000)
  })

  it('returns records newest first', async () => {
    await guard.confirm(privateKeyExportRequest(WATCH_ONLY_ACCOUNT, 0), EXPORT_RISK.Elevated)
    clock.advance(60_000)
    await guard.confirm(privateKeyExportRequest(WATCH_ONLY_ACCOUNT, 1), EXPORT_RISK.Critical)

    const history = await guard.getHistory(WATCH_ONLY_ACCOUNT)

    expect(history[0]?.addressIndex).toBe(1)
    expect(history[1]?.addressIndex).toBe(0)
  })

  it('records the export before issuing the permit', async () => {
    /* The error direction is deliberate: an extra record leads to a
       stricter warning; a missed one leads to no warning where one
       is required. */
    const permit = await guard.confirm(
      accountExportRequest(EXPORT_KIND.Xpub, WATCH_ONLY_ACCOUNT),
      EXPORT_RISK.Low,
    )

    expect(permit.isConsumed).toBe(false)
    await expect(guard.getHistory(WATCH_ONLY_ACCOUNT)).resolves.toHaveLength(1)
  })

  it('keeps histories of different accounts separate', async () => {
    await guard.confirm(accountExportRequest(EXPORT_KIND.Xpub, WATCH_ONLY_ACCOUNT), EXPORT_RISK.Low)

    await expect(guard.getHistory(SIGNING_ACCOUNT)).resolves.toHaveLength(0)
  })

  it('survives recreating the guard on the same store', async () => {
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
  it('reports no exports for a new account', async () => {
    await expect(auditLog.hasExported(SIGNING_ACCOUNT, EXPORT_KIND.Xpub)).resolves.toBe(false)
  })

  it('distinguishes export kinds', async () => {
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

  it('clears an account history', async () => {
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
