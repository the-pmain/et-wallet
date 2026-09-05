import { ExportNotPermittedError } from '@/core/errors'
import type { IClock } from '@/core/platform'
import type { IExportAuditLog, IExportGuard } from './contracts'
import { ExportPermit } from './ExportPermit'
import {
  EXPORT_KIND,
  EXPORT_RISK,
  EXPORT_RISK_REASON,
  riskLevel,
  type ExportKind,
  type ExportRisk,
  type ExportRiskReason,
  type ExportScope,
  type IExportRecord,
  type IExportRequest,
  type IExportRiskAssessment,
} from './types'

/**
 * Index of the account that signs transactions.
 *
 * Matches `m/44'/60'/0'` and MetaMask, Trust, and other wallets:
 * restoring the phrase in any of them yields the same addresses.
 */
export const SIGNING_ACCOUNT_INDEX = 0

/**
 * Index of the account reserved for watch-only use.
 *
 * A STRUCTURAL DEFENCE, not a naming convention.
 *
 * The BIP-44 account level is hardened: the step
 * `m/44'/60' -> m/44'/60'/n'` uses the parent's private key, so an
 * extended public key of one account yields nothing about the others.
 *
 * Consequence: an xpub from `m/44'/60'/1'` creates no risk for the
 * signing account `m/44'/60'/0'` — even if the recipient later gets a
 * private key of a watch-only address. Compromise stays locked inside
 * one account.
 */
export const WATCH_ONLY_ACCOUNT_INDEX = 1

/**
 * Account index from an export scope: `m/44'/60'/1'` -> 1.
 *
 * Returns `null` for imported-key scopes: they belong to no tree, and
 * an account index does not apply.
 */
function extractAccountIndex(scope: ExportScope): number | null {
  if (!scope.startsWith('m/')) {
    return null
  }

  const segments = scope.split('/')
  const last = segments[segments.length - 1]

  if (last === undefined) {
    return null
  }

  const parsed = Number.parseInt(last.replace("'", ''), 10)

  return Number.isSafeInteger(parsed) ? parsed : null
}

/**
 * Risk assessment and permits for secret export.
 *
 * THE PROBLEM BEING CLOSED. BIP-32 non-hardened derivation is
 *
 *     k_child = (IL + k_parent) mod n,
 *     IL = HMAC-SHA512(chainCode_parent, pubKey_parent || index)
 *
 * and the extended public key holds both `chainCode_parent` and
 * `pubKey_parent`. So anyone with the parent's xpub and any child's
 * private key computes
 *
 *     k_parent = (k_child − IL) mod n
 *
 * and gets every address of the account. This cannot be fixed in
 * maths: hardened derivation at the `change` and `addressIndex`
 * levels would make the xpub useless and, worse, break BIP-44
 * compatibility — the seed phrase would no longer restore in other
 * wallets.
 *
 * WHAT THIS CLASS DOES. The danger exists only when BOTH artefacts
 * reach the same recipient. That state is tracked and made visible:
 * an export that closes the pair is marked `AccountCompromise`, and
 * a permit is not issued until the UI confirms it showed a warning
 * of exactly that level.
 */
export class ExportGuard implements IExportGuard {
  readonly #auditLog: IExportAuditLog
  readonly #clock: IClock

  constructor(auditLog: IExportAuditLog, clock: IClock) {
    this.#auditLog = auditLog
    this.#clock = clock
  }

  async assess(request: IExportRequest): Promise<IExportRiskAssessment> {
    switch (request.kind) {
      case EXPORT_KIND.Mnemonic:
        return ExportGuard.#assessment(
          request,
          EXPORT_RISK.Critical,
          EXPORT_RISK_REASON.GrantsWholeWallet,
          false,
          false,
        )

      case EXPORT_KIND.Xprv:
        /* An extended private key already gives the whole account.
           There is nothing to close here: compromise is complete
           regardless of history. */
        return ExportGuard.#assessment(
          request,
          EXPORT_RISK.Critical,
          EXPORT_RISK_REASON.GrantsWholeAccount,
          false,
          false,
        )

      case EXPORT_KIND.PrivateKey:
        return await this.#assessPrivateKey(request)

      case EXPORT_KIND.Xpub:
        return await this.#assessXpub(request)
    }
  }

  async confirm(request: IExportRequest, acknowledgedRisk: ExportRisk): Promise<ExportPermit> {
    const assessment = await this.assess(request)

    /* The key check. A UI that showed a soft warning where
       irreversible consequences must be explained will not get a
       permit. Without this step the risk assessment would be
       decorative. */
    if (riskLevel(acknowledgedRisk) < riskLevel(assessment.risk)) {
      throw new ExportNotPermittedError(
        `the acknowledged risk level is "${acknowledgedRisk}", actual: "${assessment.risk}"`,
      )
    }

    const record: IExportRecord = {
      kind: request.kind,
      scope: request.scope,
      addressIndex: request.addressIndex,
      risk: assessment.risk,
      at: this.#clock.now(),
    }

    /* Write before issuing the permit, not after a successful dump.
       An extra record leads to a stricter warning later; a missed one
       leads to no warning where one is required. */
    await this.#auditLog.record(record)

    return ExportPermit.issue(request, assessment.risk, record.at)
  }

  async getHistory(scope: ExportScope): Promise<readonly IExportRecord[]> {
    return await this.#auditLog.listByScope(scope)
  }

  async #assessPrivateKey(request: IExportRequest): Promise<IExportRiskAssessment> {
    const xpubExported = await this.#auditLog.hasExported(request.scope, EXPORT_KIND.Xpub)

    if (xpubExported) {
      /* The pair closes: the xpub is already out, the child private
         key is leaving now. The holder of both computes the whole
         account. */
      return ExportGuard.#assessment(
        request,
        EXPORT_RISK.AccountCompromise,
        EXPORT_RISK_REASON.XpubAlreadyExported,
        true,
        false,
      )
    }

    /* No xpub has been exported. Risk is elevated, not critical:
       a private key by itself opens only one address. */
    return ExportGuard.#assessment(
      request,
      EXPORT_RISK.Elevated,
      EXPORT_RISK_REASON.None,
      false,
      false,
    )
  }

  async #assessXpub(request: IExportRequest): Promise<IExportRiskAssessment> {
    const [privateKeyExported, xprvExported] = await Promise.all([
      this.#auditLog.hasExported(request.scope, EXPORT_KIND.PrivateKey),
      this.#auditLog.hasExported(request.scope, EXPORT_KIND.Xprv),
    ])

    if (privateKeyExported || xprvExported) {
      return ExportGuard.#assessment(
        request,
        EXPORT_RISK.AccountCompromise,
        EXPORT_RISK_REASON.PrivateKeyAlreadyExported,
        true,
        true,
      )
    }

    const accountIndex = extractAccountIndex(request.scope)

    if (accountIndex === SIGNING_ACCOUNT_INDEX) {
      /* The pair is not closed yet, but this is the signing account:
         any later private-key export from it would compromise it.
         The right move is to export an xpub from the watch account. */
      return ExportGuard.#assessment(
        request,
        EXPORT_RISK.Elevated,
        EXPORT_RISK_REASON.XpubFromSigningAccount,
        false,
        true,
      )
    }

    /* A separate account, no private keys exported from it.
       The account level is hardened, so the signing account is
       untouched in every case. */
    return ExportGuard.#assessment(request, EXPORT_RISK.Low, EXPORT_RISK_REASON.None, false, false)
  }

  static #assessment(
    request: IExportRequest,
    risk: ExportRisk,
    reason: ExportRiskReason,
    closesCompromisePair: boolean,
    suggestsSeparateAccount: boolean,
  ): IExportRiskAssessment {
    return { request, risk, reason, closesCompromisePair, suggestsSeparateAccount }
  }
}

export function accountExportRequest(kind: ExportKind, scope: ExportScope): IExportRequest {
  return { kind, scope, addressIndex: null }
}

/**
 * Convenience constructor for a private-key export request.
 *
 * `addressIndex` is `null` for imported keys: they have no position
 * in the HD tree.
 */
export function privateKeyExportRequest(
  scope: ExportScope,
  addressIndex: number | null,
): IExportRequest {
  return { kind: EXPORT_KIND.PrivateKey, scope, addressIndex }
}
