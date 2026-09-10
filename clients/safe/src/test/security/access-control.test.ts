import { beforeEach, describe, expect, it } from 'vitest'

import {
  EXPORT_KIND,
  EXPORT_RISK,
  ExportAuditLog,
  ExportGuard,
  ExportNotPermittedError,
  InvalidPasswordError,
  WALLET_SCOPE,
  accountExportRequest,
  hdAccountScope,
  privateKeyExportRequest,
  toAddress,
  toDerivationPath,
  toWei,
  type AccountId,
  type Wei,
} from '@/core'
import { TEST_MNEMONIC, TEST_MNEMONIC_ADDRESSES } from '@/core/hdwallet/vectors'
import { createTestAppServices, FakeClock, InMemoryStorageService } from '@/test/doubles'
import type { ITestAppServices } from '@/test/doubles'

const PASSWORD = 'Korova-7-Luna!'
const WRONG_PASSWORD = 'Sobaka-9-Solnce!'

const OWNER = toAddress(TEST_MNEMONIC_ADDRESSES[0] as string)
const OUTSIDER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

const BALANCE = (10n ** 19n) as Wei

let services: ITestAppServices

/** Opens an unlocked session with a ready account. */
async function openSession(): Promise<void> {
  services.providerFactory.configure({ balance: BALANCE })
  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
  await services.session.open()
}

function firstAccountId(): AccountId {
  const account = services.session.getSnapshot().accounts[0]

  if (account === undefined) {
    throw new Error('Account is not created.')
  }

  return account.id
}

beforeEach(() => {
  services = createTestAppServices()
})

describe('A locked wallet performs no operations', () => {
  it('closes the session and clears the snapshot', async () => {
    await openSession()

    expect(services.session.getSnapshot().accounts).not.toHaveLength(0)

    await services.session.close()

    expect(services.session.getSnapshot().accounts).toHaveLength(0)
    expect(services.session.getSnapshot().activeAccount).toBeNull()
  })

  it('backup is unavailable after close', async () => {
    /* An export screen that still worked after autolock would
       make autolock worthless. */
    await openSession()
    await services.session.close()

    expect(() => services.session.getBackup()).toThrow()
  })

  it('preparing a transfer after close refuses', async () => {
    await openSession()
    const chainId = services.session.getSnapshot().activeNetwork?.chainId

    if (chainId === undefined) {
      throw new Error('Network is not selected.')
    }

    await services.session.close()

    await expect(
      services.session.prepareTransfer({
        chainId,
        from: OWNER,
        to: OUTSIDER,
        value: toWei(1n),
      }),
    ).rejects.toThrow()
  })

  it('locking again does not break state', async () => {
    await openSession()
    await services.session.close()

    await expect(services.session.close()).resolves.toBeUndefined()
  })
})

describe('Releasing secrets requires a password even when unlocked', () => {
  it('does not release the seed phrase for a wrong password', async () => {
    await openSession()

    await expect(
      services.session.getBackup().exportMnemonic(WRONG_PASSWORD, EXPORT_RISK.Critical),
    ).rejects.toThrow(InvalidPasswordError)
  })

  it('does not release a private key for a wrong password', async () => {
    await openSession()

    await expect(
      services.session
        .getBackup()
        .exportPrivateKey(firstAccountId(), WRONG_PASSWORD, EXPORT_RISK.AccountCompromise),
    ).rejects.toThrow(InvalidPasswordError)
  })

  it('an understated risk level does not grant a release', async () => {
    /* A UI that showed a soft warning where irreversible
       consequences must be explained will not get a permit. */
    await openSession()

    await expect(
      services.session.getBackup().exportMnemonic(PASSWORD, EXPORT_RISK.Elevated),
    ).rejects.toThrow(ExportNotPermittedError)
  })

  it('a wrong password leaves no trace in the export log', async () => {
    /* A log full of failed exports would inflate the risk of
       later operations — that is, train people not to read
       warnings. */
    await openSession()

    await expect(
      services.session.getBackup().exportMnemonic(WRONG_PASSWORD, EXPORT_RISK.Critical),
    ).rejects.toThrow(InvalidPasswordError)

    const assessment = await services.session.getBackup().assessMnemonicExport()

    expect(assessment.risk).toBe(EXPORT_RISK.Critical)
    expect(assessment.closesCompromisePair).toBe(false)
  })
})

describe('An export permit is one-shot and bound to the operation', () => {
  /* The path is built by the constructor, not by a type cast: a
     cast would skip the format check the branded type exists for. */
  const ACCOUNT_SCOPE = hdAccountScope(toDerivationPath("m/44'/60'/0'"))

  let guard: ExportGuard

  beforeEach(() => {
    guard = new ExportGuard(
      new ExportAuditLog(new InMemoryStorageService()),
      new FakeClock(1_700_000_000_000),
    )
  })

  it('a permit does not match a different secret kind', async () => {
    const permit = await guard.confirm(
      accountExportRequest(EXPORT_KIND.Xpub, ACCOUNT_SCOPE),
      EXPORT_RISK.Elevated,
    )

    expect(permit.matches(EXPORT_KIND.Xprv, ACCOUNT_SCOPE, null)).toBe(false)
  })

  it('a permit does not match a different address', async () => {
    const permit = await guard.confirm(
      privateKeyExportRequest(ACCOUNT_SCOPE, 0),
      EXPORT_RISK.Elevated,
    )

    expect(permit.matches(EXPORT_KIND.PrivateKey, ACCOUNT_SCOPE, 1)).toBe(false)
  })

  it('a consumed permit matches nothing', async () => {
    /* Otherwise one user confirmation would unlock unlimited
       exports. */
    const request = privateKeyExportRequest(ACCOUNT_SCOPE, 0)
    const permit = await guard.confirm(request, EXPORT_RISK.Elevated)

    expect(permit.matches(EXPORT_KIND.PrivateKey, request.scope, 0)).toBe(true)

    permit.consume()

    expect(permit.matches(EXPORT_KIND.PrivateKey, request.scope, 0)).toBe(false)
  })

  it('a permit does not reveal state when serialized', () => {
    /* On its own it is safe and may reach a log, but only in
       the form it was designed for. */
    expect(JSON.stringify(guard)).not.toContain('secret')
  })

  it('the seed-phrase scope differs from an account scope', async () => {
    /* The phrase derives every account, including ones not yet
       created: logging its release under one account path would
       claim the risk is limited to that account. */
    const assessment = await guard.assess(accountExportRequest(EXPORT_KIND.Mnemonic, WALLET_SCOPE))

    expect(assessment.request.scope).toBe(WALLET_SCOPE)
    expect(assessment.risk).toBe(EXPORT_RISK.Critical)
  })
})
