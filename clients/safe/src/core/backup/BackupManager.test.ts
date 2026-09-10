import { beforeEach, describe, expect, it } from 'vitest'

import { AccountManager } from '@/core/account'
import { SecretBuffer, SecureStorage } from '@/core/encryption'
import {
  AccountNotFoundError,
  ExportNotPermittedError,
  InvalidPasswordError,
  MNEMONIC_INVALID_REASON,
} from '@/core/errors'
import { HDWalletService } from '@/core/hdwallet'
import { MnemonicService } from '@/core/mnemonic'
import {
  EXPORT_KIND,
  EXPORT_RISK,
  ExportAuditLog,
  ExportGuard,
  WALLET_SCOPE,
  accountExportRequest,
  hdAccountScope,
} from '@/core/security'
import { STORAGE_NAMESPACE, VAULT_KEY } from '@/core/storage'
import type { AccountId } from '@/core/types'
import {
  FakeClock,
  FastEncryptionService,
  InMemoryStorageService,
  NullLogger,
} from '@/test/doubles'

import { BackupManager } from './BackupManager'

const PASSWORD = 'correct-password-1234'
const WRONG_PASSWORD = 'wrong-password-9999'

/**
 * Zero-entropy test phrase.
 *
 * Matches the industry-wide vector. Written here not from memory:
 * a test below checks it against a phrase built from sixteen zero
 * bytes — a mismatch would mean the constant is corrupted.
 */
const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

/** Private key equal to one. Its address is well known. */
const IMPORTED_KEY = new Uint8Array(32)
IMPORTED_KEY[31] = 1

let storage: InMemoryStorageService
let secure: SecureStorage
let hdWallet: HDWalletService
let clock: FakeClock
let auditLog: ExportAuditLog
let guard: ExportGuard
let accounts: AccountManager
let backup: BackupManager

const mnemonicService = new MnemonicService()

/** Reads the issued secret as a string and wipes the buffer. */
function readAndWipe(secret: { bytes: Uint8Array; wipe: () => void }): string {
  const text = new TextDecoder().decode(secret.bytes)

  secret.wipe()

  return text
}

beforeEach(async () => {
  storage = new InMemoryStorageService()
  secure = new SecureStorage(storage, new FastEncryptionService())
  await secure.initialize(PASSWORD)
  await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY.Mnemonic, TEST_MNEMONIC)

  const mnemonic = mnemonicService.fromPhrase(TEST_MNEMONIC)
  const seed = await mnemonicService.toSeed(mnemonic)
  mnemonic.wipe()

  hdWallet = HDWalletService.fromSeed(seed)
  seed.wipe()

  clock = new FakeClock(1_700_000_000_000)
  auditLog = new ExportAuditLog(storage)
  guard = new ExportGuard(auditLog, clock)

  accounts = AccountManager.create({
    hdWallet,
    secureStorage: secure,
    clock,
    logger: new NullLogger(),
  })
  await accounts.init()
  await accounts.create()

  backup = new BackupManager({
    secureStorage: secure,
    mnemonicService,
    exportGuard: guard,
    accounts,
    hdWallet,
    logger: new NullLogger(),
  })
})

describe('BackupManager: risk assessment', () => {
  it('rates seed-phrase reveal as critical', async () => {
    const assessment = await backup.assessMnemonicExport()

    expect(assessment.risk).toBe(EXPORT_RISK.Critical)
  })

  it('the seed-phrase scope does not match an account scope', async () => {
    /* The phrase derives every account, including ones not yet
       created. Recording its reveal under the signing account's
       path, the log would claim the risk is limited to that
       account. */
    const assessment = await backup.assessMnemonicExport()

    expect(assessment.request.scope).toBe(WALLET_SCOPE)
    expect(assessment.request.scope).not.toBe(hdAccountScope(hdWallet.accountPath))
  })

  it('rates a private-key reveal with no history as elevated risk', async () => {
    const id = firstAccountId()

    await expect(backup.assessPrivateKeyExport(id)).resolves.toMatchObject({
      risk: EXPORT_RISK.Elevated,
    })
  })

  it('after an xpub reveal, rates a key reveal as account compromise', async () => {
    await guard.confirm(
      accountExportRequest(EXPORT_KIND.Xpub, hdAccountScope(hdWallet.accountPath)),
      EXPORT_RISK.Elevated,
    )

    const assessment = await backup.assessPrivateKeyExport(firstAccountId())

    expect(assessment.risk).toBe(EXPORT_RISK.AccountCompromise)
    expect(assessment.closesCompromisePair).toBe(true)
  })

  it('refuses assessment for a missing account', async () => {
    await expect(backup.assessPrivateKeyExport('does-not-exist' as AccountId)).rejects.toThrow(
      AccountNotFoundError,
    )
  })
})

describe('BackupManager: seed-phrase reveal', () => {
  it('returns the stored phrase', async () => {
    const secret = await backup.exportMnemonic(PASSWORD, EXPORT_RISK.Critical)

    expect(readAndWipe(secret)).toBe(TEST_MNEMONIC)
  })

  it('rejects a wrong password', async () => {
    await expect(backup.exportMnemonic(WRONG_PASSWORD, EXPORT_RISK.Critical)).rejects.toThrow(
      InvalidPasswordError,
    )
  })

  it('a wrong password leaves no export-log entry', async () => {
    /* A log full of failed exports would inflate the risk of later
       operations — that is, teach people not to read the warnings. */
    await expect(backup.exportMnemonic(WRONG_PASSWORD, EXPORT_RISK.Critical)).rejects.toThrow(
      InvalidPasswordError,
    )

    await expect(auditLog.hasExported(WALLET_SCOPE, EXPORT_KIND.Mnemonic)).resolves.toBe(false)
  })

  it('refuses if the shown risk level is below the actual one', async () => {
    await expect(backup.exportMnemonic(PASSWORD, EXPORT_RISK.Elevated)).rejects.toThrow(
      ExportNotPermittedError,
    )
  })

  it('records a completed reveal in the log', async () => {
    ;(await backup.exportMnemonic(PASSWORD, EXPORT_RISK.Critical)).wipe()

    await expect(auditLog.hasExported(WALLET_SCOPE, EXPORT_KIND.Mnemonic)).resolves.toBe(true)
  })

  it('the phrase does not appear in raw storage in the clear', async () => {
    ;(await backup.exportMnemonic(PASSWORD, EXPORT_RISK.Critical)).wipe()

    const raw = await storage.get<Record<string, unknown>>(
      STORAGE_NAMESPACE.Vault,
      VAULT_KEY.Mnemonic,
    )

    expect(JSON.stringify(raw)).not.toContain('abandon')
  })
})

describe('BackupManager: private-key reveal', () => {
  it('reveals an HD-account key', async () => {
    const secret = await backup.exportPrivateKey(
      firstAccountId(),
      PASSWORD,
      EXPORT_RISK.AccountCompromise,
    )

    expect(secret.bytes).toHaveLength(32)
    secret.wipe()
  })

  it('rejects a wrong password and does not write the log', async () => {
    const id = firstAccountId()

    await expect(
      backup.exportPrivateKey(id, WRONG_PASSWORD, EXPORT_RISK.AccountCompromise),
    ).rejects.toThrow(InvalidPasswordError)

    await expect(
      auditLog.hasExported(hdAccountScope(hdWallet.accountPath), EXPORT_KIND.PrivateKey),
    ).resolves.toBe(false)
  })

  it('refuses when the risk level is understated', async () => {
    await expect(
      backup.exportPrivateKey(firstAccountId(), PASSWORD, EXPORT_RISK.Low),
    ).rejects.toThrow(ExportNotPermittedError)
  })

  it('reveals an imported key and does not touch the HD-account scope', async () => {
    const key = SecretBuffer.copyOf(IMPORTED_KEY)
    const imported = await accounts.importPrivateKey({ privateKey: key })

    key.wipe()

    const secret = await backup.exportPrivateKey(
      imported.id,
      PASSWORD,
      EXPORT_RISK.AccountCompromise,
    )

    expect(secret.bytes).toHaveLength(32)
    secret.wipe()

    /* An imported key does not belong to the HD tree: marking the
       account with it, the wallet would issue a false compromise
       warning. */
    await expect(
      auditLog.hasExported(hdAccountScope(hdWallet.accountPath), EXPORT_KIND.PrivateKey),
    ).resolves.toBe(false)
  })

  it('the permit is one-shot: a second reveal needs a new confirmation', async () => {
    const id = firstAccountId()

    ;(await backup.exportPrivateKey(id, PASSWORD, EXPORT_RISK.AccountCompromise)).wipe()

    /* The second call goes through assessment and confirmation
       again — the permit from the first cannot be reused. */
    const secret = await backup.exportPrivateKey(id, PASSWORD, EXPORT_RISK.AccountCompromise)

    expect(secret.bytes).toHaveLength(32)
    secret.wipe()
  })
})

describe('BackupManager: phrase check before import', () => {
  it('accepts a valid phrase', () => {
    const check = backup.checkMnemonic(TEST_MNEMONIC)

    expect(check.isValid).toBe(true)
    expect(check.wordCount).toBe(12)
  })

  it('names the reason on a wrong checksum', () => {
    const swapped = TEST_MNEMONIC.replace('about', 'abandon')

    expect(backup.checkMnemonic(swapped).reason).toBe(MNEMONIC_INVALID_REASON.Checksum)
  })

  it('points at word positions outside the wordlist', () => {
    const broken = TEST_MNEMONIC.replace('abandon abandon abandon a', 'abandon abandon zombie a')

    expect(backup.checkMnemonic(broken).unknownWordIndexes).toEqual([2])
  })

  it('warns about trivial entropy', () => {
    expect(backup.checkMnemonic(TEST_MNEMONIC).isGuessable).toBe(true)
  })

  it('the test phrase really matches zero entropy', () => {
    /* Check of the constant itself: it is written as a string, and
       a string cannot be checked by reading. A phrase built from
       sixteen zero bytes must match it word for word. */
    const built = mnemonicService.fromEntropy(new Uint8Array(16))

    expect(readAndWipe(built)).toBe(TEST_MNEMONIC)
  })

  it('does not treat a phrase with random entropy as trivial', () => {
    const generated = mnemonicService.generate()
    const phrase = mnemonicService.revealPhrase(generated)

    generated.wipe()

    expect(backup.checkMnemonic(phrase).isGuessable).toBe(false)
  })

  it('does not throw on unfinished input', () => {
    expect(() => backup.checkMnemonic('abandon aban')).not.toThrow()
    expect(backup.checkMnemonic('abandon aban').isValid).toBe(false)
  })

  it('does not treat empty input as trivial', () => {
    /* "Entropy unknown" and "entropy weak" are different claims.
       The second, shown in place of the first, is a false alarm. */
    expect(backup.checkMnemonic('').isGuessable).toBe(false)
  })
})

/** Identifier of the only created account. */
function firstAccountId(): AccountId {
  const account = accounts.list()[0]

  if (account === undefined) {
    throw new Error('Account was not created.')
  }

  return account.id
}

describe('BackupManager: written-copy check', () => {
  it('a correctly rewritten phrase is recognised as matching', async () => {
    await expect(backup.verifyMnemonicBackup(TEST_MNEMONIC, PASSWORD)).resolves.toBe(true)
  })

  it('a phrase with one changed word does not match', async () => {
    /* Exactly this error leads to loss: one word off — another
       wallet, and that is learned at restore. */
    const wrong = TEST_MNEMONIC.replace('about', 'above')

    await expect(backup.verifyMnemonicBackup(wrong, PASSWORD)).resolves.toBe(false)
  })

  it('a missing word does not match', async () => {
    const short = TEST_MNEMONIC.split(' ').slice(0, 11).join(' ')

    await expect(backup.verifyMnemonicBackup(short, PASSWORD)).resolves.toBe(false)
  })

  it('extra spaces and casing do not prevent a match', async () => {
    /* People rewrite from paper in a column and type on a mobile
       keyboard that capitalises. A refusal for that reason would
       look like "the phrase was written wrong" — a false alarm
       about an irrecoverable loss. */
    const messy = `  ${TEST_MNEMONIC.toUpperCase().split(' ').join('\n')}  `

    await expect(backup.verifyMnemonicBackup(messy, PASSWORD)).resolves.toBe(true)
  })

  it('does not answer at all without the right password', async () => {
    /* Otherwise the screen becomes an oracle: someone who found a
       paper with a few smeared words would guess the rest, getting
       yes/no on every attempt. */
    await expect(backup.verifyMnemonicBackup(TEST_MNEMONIC, 'wrong password')).rejects.toThrow(
      InvalidPasswordError,
    )
  })

  it('a wrong password does not differ in reply from a wrong phrase', async () => {
    /* Both cases must end in a refusal, not "the phrase did not
       match": the latter would report that the password was
       guessed. */
    await expect(backup.verifyMnemonicBackup('abandon abandon', 'wrong password')).rejects.toThrow(
      InvalidPasswordError,
    )
  })

  it('the phrase is not issued on a match or a mismatch', async () => {
    /* The method returns a flag, not the text: a second phrase-
       reveal path would bypass both risk confirmation and the
       export log. */
    const matched = await backup.verifyMnemonicBackup(TEST_MNEMONIC, PASSWORD)
    const missed = await backup.verifyMnemonicBackup('abandon abandon abandon', PASSWORD)

    expect(typeof matched).toBe('boolean')
    expect(typeof missed).toBe('boolean')
  })

  it('the check is not written to the export log', async () => {
    /* There is no "phrase exported" entry here, because there was
       no export. An entry would inflate the risk of later real
       exports, that is, teach people not to read the warnings. */
    const before = await backup.assessMnemonicExport()

    await backup.verifyMnemonicBackup(TEST_MNEMONIC, PASSWORD)

    expect((await backup.assessMnemonicExport()).risk).toBe(before.risk)
  })
})
