import type { IAccountManager } from '@/core/account'
import type { ISecretBuffer, ISecureStorage } from '@/core/encryption'
import {
  AccountNotFoundError,
  ExportNotPermittedError,
  InvalidPasswordError,
  WalletNotInitializedError,
} from '@/core/errors'
import type { IHDWalletService } from '@/core/hdwallet'
import { KEYRING_TYPE } from '@/core/keyring'
import { normalizeMnemonicInput, type IMnemonicService } from '@/core/mnemonic'
import type { ILogger } from '@/core/platform'
import {
  EXPORT_KIND,
  WALLET_SCOPE,
  accountExportRequest,
  hdAccountScope,
  importedKeyScope,
  privateKeyExportRequest,
  type ExportRisk,
  type IExportGuard,
  type IExportRequest,
  type IExportRiskAssessment,
} from '@/core/security'
import { STORAGE_NAMESPACE, VAULT_KEY } from '@/core/storage'
import type { AccountId } from '@/core/types'

import { checkMnemonic } from './check-mnemonic'
import type { IBackupManager, IMnemonicCheck } from './contracts'

const SERVICE_NAME = 'BackupManager'

export interface IBackupManagerDependencies {
  /** Phrase source and the only place the password is checked. */
  readonly secureStorage: ISecureStorage

  readonly mnemonicService: IMnemonicService

  /** Risk assessment and permit issuance. It cannot be bypassed. */
  readonly exportGuard: IExportGuard

  /** Account owner. Private-key reveal is done by it. */
  readonly accounts: IAccountManager

  /** Needed for the account path: it defines the export scope. */
  readonly hdWallet: IHDWalletService

  readonly logger: ILogger
}

/**
 * Backup of wallet secrets.
 *
 * WHAT THIS CLASS DOES. It brings together three independent
 * requirements, each of which is easy to forget on its own:
 * password confirmation, a permit for the shown risk level, and an
 * entry in the export log. Skipping any of them gives neither a
 * build error nor a failing test — it silently turns the protection
 * into its appearance.
 *
 * WHAT THIS CLASS DOES NOT DO. It does not store secrets, does not
 * cache the phrase, does not create files. The issued buffer belongs
 * to the caller, and wiping it is their job.
 *
 * WHY THERE IS NO FILE BACKUP. An encrypted file with the seed
 * phrase is only as strong as the password, and it ends up wherever
 * the user puts it: downloads, cloud folder sync, the trash. Paper
 * has no such feature. A file is password guessing with no rate
 * limit and without our knowledge.
 */
export class BackupManager implements IBackupManager {
  readonly #secureStorage: ISecureStorage
  readonly #mnemonicService: IMnemonicService
  readonly #exportGuard: IExportGuard
  readonly #accounts: IAccountManager
  readonly #hdWallet: IHDWalletService
  readonly #logger: ILogger

  constructor(dependencies: IBackupManagerDependencies) {
    this.#secureStorage = dependencies.secureStorage
    this.#mnemonicService = dependencies.mnemonicService
    this.#exportGuard = dependencies.exportGuard
    this.#accounts = dependencies.accounts
    this.#hdWallet = dependencies.hdWallet
    this.#logger = dependencies.logger.child(SERVICE_NAME)
  }

  async assessMnemonicExport(): Promise<IExportRiskAssessment> {
    return await this.#exportGuard.assess(BackupManager.#mnemonicRequest())
  }

  /**
   * Reveals the mnemonic phrase.
   *
   * THE ORDER OF STEPS IS DELIBERATE: password first, then the
   * permit. `confirm` writes to the export log before the permit is
   * issued, and the reverse order would record "phrase exported" on
   * every password typo. A log full of failed exports would inflate
   * the risk of later operations — that is, teach people not to
   * read the warnings.
   */
  async exportMnemonic(password: string, acknowledgedRisk: ExportRisk): Promise<ISecretBuffer> {
    await this.#requirePassword(password)

    /* The permit is not passed further: the manager itself does the
       reveal. The value of the call is not the permit object but
       its two side effects — matching the acknowledged risk to the
       actual one, and writing the log. */
    const permit = await this.#exportGuard.confirm(
      BackupManager.#mnemonicRequest(),
      acknowledgedRisk,
    )

    const phrase = await this.#secureStorage.get<string>(
      STORAGE_NAMESPACE.Vault,
      VAULT_KEY.Mnemonic,
    )

    if (phrase === null) {
      throw new WalletNotInitializedError()
    }

    /* Consumed before the secret is issued: an exception during
       reveal must not leave a live permit. */
    permit.consume()

    this.#logger.warn('Seed phrase revealed', {
      note: 'anyone who obtains it can reproduce the whole wallet',
    })

    /* Parse the phrase again, do not return the storage string: the
       caller gets a wipeable buffer, not another uncleared string. */
    return this.#mnemonicService.fromPhrase(phrase)
  }

  /**
   * Checks a rewritten phrase against the stored one.
   *
   * WHY THIS IS A SEPARATE METHOD, NOT SHOWING THE PHRASE AGAIN.
   * The only way to confirm the written copy used to be showing the
   * phrase and checking by eye — that is, an extra reveal of exactly
   * what we protect, for a check that can be done without revealing
   * anything. A rewrite error is not hypothetical: it is found at
   * restore, when there is nothing left to fix.
   *
   * THE PASSWORD IS REQUIRED. Without it the method becomes an
   * oracle: someone who found a paper with a few smeared words
   * would guess the rest, getting yes/no on every attempt. The
   * requirement costs the owner nothing — they have the password —
   * and a stranger who has the password learns nothing new: they
   * will get the phrase by export anyway.
   *
   * COMPARISON WITHOUT EARLY EXIT. Ordinary string comparison
   * returns on the first difference, and the response time leaks
   * how many characters matched — the phrase could be guessed one
   * word at a time. Here every byte is inspected regardless of the
   * result.
   *
   * THE ANSWER IS ONE BIT. Pointing at the differing word would
   * help both the owner and the guesser, but the owner has
   * somewhere to look: they have the paper. Remarks about the
   * entered phrase itself (word not in the wordlist, checksum
   * mismatch) come from `checkMnemonic` and say nothing about the
   * stored phrase.
   *
   * NOTHING IS WRITTEN TO THE EXPORT LOG: no secret was issued, and
   * an entry would inflate the risk of later real exports.
   *
   * @throws InvalidPasswordError, WalletNotInitializedError
   */
  async verifyMnemonicBackup(phrase: string, password: string): Promise<boolean> {
    await this.#requirePassword(password)

    const stored = await this.#secureStorage.get<string>(
      STORAGE_NAMESPACE.Vault,
      VAULT_KEY.Mnemonic,
    )

    if (stored === null) {
      throw new WalletNotInitializedError()
    }

    const matches = equalInConstantTime(
      normalizeMnemonicInput(stored),
      normalizeMnemonicInput(phrase),
    )

    /* Contents do not enter the log: neither the phrase, nor a
       part of it, nor its length. */
    this.#logger.info('The written copy of the seed phrase was checked', { matches })

    return matches
  }

  async assessPrivateKeyExport(id: AccountId): Promise<IExportRiskAssessment> {
    return await this.#exportGuard.assess(this.#privateKeyRequest(id))
  }

  /**
   * Reveals an account private key.
   *
   * THE PASSWORD IS CHECKED TWICE — here and inside
   * `AccountManager`. Neither check can be removed. The first is
   * needed so a wrong password does not leave an export-log entry
   * (see `exportMnemonic`); the second is `AccountManager`'s own
   * guarantee, applying to every caller, not only this one. The
   * cost is deriving the key from the password twice, about a
   * second on a deliberate user action.
   */
  async exportPrivateKey(
    id: AccountId,
    password: string,
    acknowledgedRisk: ExportRisk,
  ): Promise<ISecretBuffer> {
    const request = this.#privateKeyRequest(id)

    await this.#requirePassword(password)

    const permit = await this.#exportGuard.confirm(request, acknowledgedRisk)

    this.#logger.warn('Account private key revealed', {
      note: 'the address passes irreversibly under the control of whoever receives the key',
    })

    return await this.#accounts.exportPrivateKey(id, password, permit)
  }

  checkMnemonic(phrase: string): IMnemonicCheck {
    return checkMnemonic(phrase, this.#mnemonicService)
  }

  /** Checks the password without revealing decrypted contents. */
  async #requirePassword(password: string): Promise<void> {
    if (!(await this.#secureStorage.verifyPassword(password))) {
      throw new InvalidPasswordError()
    }
  }

  /**
   * Builds a request to reveal a specific account's private key.
   *
   * The scope distinguishes an imported key from an HD-tree branch:
   * treating them as equal would mark an HD account compromised
   * because of an export of a key that has nothing to do with it.
   */
  #privateKeyRequest(id: AccountId): IExportRequest {
    const account = this.#accounts.getById(id)

    if (account === null) {
      throw new AccountNotFoundError(id)
    }

    if (account.source === KEYRING_TYPE.PrivateKey) {
      return privateKeyExportRequest(importedKeyScope(account.keyringId), null)
    }

    if (account.addressIndex === null) {
      throw new ExportNotPermittedError(
        `an account of type "${account.source}" holds no extractable private key`,
      )
    }

    return privateKeyExportRequest(hdAccountScope(this.#hdWallet.accountPath), account.addressIndex)
  }

  static #mnemonicRequest(): IExportRequest {
    return accountExportRequest(EXPORT_KIND.Mnemonic, WALLET_SCOPE)
  }
}

/**
 * Compares two strings without exiting on the first difference.
 *
 * A length difference cannot be hidden — it is visible from typing
 * time too — but the position of the first difference is leaked by
 * nothing: every character of the longer string is inspected.
 */
function equalInConstantTime(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length)
  let difference = left.length ^ right.length

  for (let index = 0; index < length; index += 1) {
    /* Going out of range yields NaN from `charCodeAt`, so a code
       that is certainly absent from the text is used. */
    difference |= (left.codePointAt(index) ?? -1) ^ (right.codePointAt(index) ?? -2)
  }

  return difference === 0
}
