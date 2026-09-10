import type { Brand } from '@/shared/types'

import type { DerivationPath, KeyringId, Timestamp } from '@/core/types'

/**
 * Scope a secret export belongs to.
 *
 * WHY NOT JUST A DERIVATION PATH. The dangerous pair "xpub plus a
 * child private key" exists only inside one HD account. An imported
 * key belongs to no tree: exporting it does not leak the HD account,
 * and exporting the HD account's xpub does not leak the imported key.
 *
 * If both operations were counted under one derivation path, exporting
 * an imported key would mark the HD account compromised. A false
 * warning here is not harmless: a user trained on false alarms stops
 * reading real ones.
 */
export type ExportScope = Brand<string, 'ExportScope'>

/** HD-account scope. Matches the account-level derivation path. */
export function hdAccountScope(accountPath: DerivationPath): ExportScope {
  return accountPath as string as ExportScope
}

/**
 * Imported-key scope.
 *
 * The prefix prevents a clash with a derivation path: those always
 * start with `m/`.
 */
export function importedKeyScope(keyringId: KeyringId): ExportScope {
  return `imported:${keyringId}` as ExportScope
}

/**
 * Whole-wallet scope. Applies only to the mnemonic.
 *
 * WHY NOT THE SIGNING ACCOUNT'S PATH. The phrase belongs to no single
 * account: it derives all of them, including ones not created yet.
 * Recording its export under `m/44'/60'/0'` would claim the risk is
 * limited to that account — the opposite of the truth.
 *
 * The value starts with neither `m/` nor `imported:`, so it cannot
 * collide with an account or imported-key scope.
 */
export const WALLET_SCOPE = 'wallet' as ExportScope

/**
 * Kind of secret being exported.
 *
 * The distinction is essential: exporting an xpub and exporting an
 * xprv differ by orders of magnitude, and a generic "export" would
 * hide that.
 */
export const EXPORT_KIND = {
  /** Extended public key. By itself it cannot move funds. */
  Xpub: 'xpub',
  /** Private key of one address. */
  PrivateKey: 'private-key',
  /** Extended private key — access to every address of the account. */
  Xprv: 'xprv',
  /** Mnemonic — access to the whole wallet. */
  Mnemonic: 'mnemonic',
} as const

export type ExportKind = (typeof EXPORT_KIND)[keyof typeof EXPORT_KIND]

/**
 * Risk level of an export.
 *
 * Ascending order is explicit: it is used to compare the level the
 * user acknowledged with the actual one.
 */
export const EXPORT_RISK = {
  /** Ordinary export with no known aggravating circumstances. */
  Low: 'low',
  /** The export creates a precondition for a later compromise. */
  Elevated: 'elevated',
  /**
   * The export CLOSES the "xpub + child private key" pair.
   *
   * After this the holder of both artefacts can arithmetically compute
   * the account's private key. That is not a guess — it is a direct
   * consequence of BIP-32 non-hardened derivation.
   */
  AccountCompromise: 'account-compromise',
  /** Release of a secret that opens the whole account or wallet. */
  Critical: 'critical',
} as const

export type ExportRisk = (typeof EXPORT_RISK)[keyof typeof EXPORT_RISK]

/**
 * Risk levels in ascending order.
 *
 * An array, not numeric values on the constant: numbers in an enum
 * tempt direct comparison, and the string values must land in storage
 * and the UI in a readable form.
 */
export const EXPORT_RISK_ORDER: readonly ExportRisk[] = [
  EXPORT_RISK.Low,
  EXPORT_RISK.Elevated,
  EXPORT_RISK.AccountCompromise,
  EXPORT_RISK.Critical,
]

export function riskLevel(risk: ExportRisk): number {
  return EXPORT_RISK_ORDER.indexOf(risk)
}

/**
 * Why that risk level was assigned.
 *
 * A machine-readable code, not finished copy: the UI picks wording in
 * the user's language, and the log gets a stable identifier.
 */
export const EXPORT_RISK_REASON = {
  None: 'none',
  /** An xpub has already been exported from this account. */
  XpubAlreadyExported: 'xpub-already-exported',
  /** A private key has already been exported from this account. */
  PrivateKeyAlreadyExported: 'private-key-already-exported',
  /** An xpub is requested from the account that signs transactions. */
  XpubFromSigningAccount: 'xpub-from-signing-account',
  /** The exported secret opens the whole account. */
  GrantsWholeAccount: 'grants-whole-account',
  /** The exported secret opens the whole wallet. */
  GrantsWholeWallet: 'grants-whole-wallet',
} as const

export type ExportRiskReason = (typeof EXPORT_RISK_REASON)[keyof typeof EXPORT_RISK_REASON]

export interface IExportRequest {
  readonly kind: ExportKind

  readonly scope: ExportScope

  /**
   * Address index. Set only for {@link EXPORT_KIND.PrivateKey}.
   * `null` for an account-level export.
   */
  readonly addressIndex: number | null
}

export interface IExportRiskAssessment {
  readonly request: IExportRequest
  readonly risk: ExportRisk
  readonly reason: ExportRiskReason

  /**
   * Whether the operation makes the whole account computable.
   *
   * A separate flag, not inferred from the risk level: the UI must
   * then show an explanation of irreversible consequences, not a
   * warning.
   */
  readonly closesCompromisePair: boolean

  /**
   * Recommendation to move the operation to a separate account.
   *
   * The BIP-44 account level is hardened, so compromising one account
   * does not touch the others. Exporting an xpub from an account
   * reserved for watching removes the escalation risk entirely.
   */
  readonly suggestsSeparateAccount: boolean
}

export interface IExportRecord {
  readonly kind: ExportKind
  readonly scope: ExportScope
  readonly addressIndex: number | null
  readonly risk: ExportRisk
  readonly at: Timestamp
}
