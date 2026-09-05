import type { ExportPermit } from './ExportPermit'
import type {
  ExportKind,
  ExportRisk,
  ExportScope,
  IExportRecord,
  IExportRequest,
  IExportRiskAssessment,
} from './types'

/**
 * Log of secrets released outside the wallet.
 *
 * Exists for one specific BIP-32 risk: a parent's extended PUBLIC key
 * plus the private key of ANY of its children let an attacker compute
 * the parent's private key, and thus every address of the account.
 *
 * Each export looks harmless on its own, and the user has no way to
 * notice that the second one closed the dangerous pair. The log makes
 * that state observable.
 *
 * Holds no secrets: only the kind, the account path, and the time.
 */
export interface IExportAuditLog {
  record(entry: IExportRecord): Promise<void>

  /** Exports of one account, newest first. */
  listByScope(scope: ExportScope): Promise<readonly IExportRecord[]>

  hasExported(scope: ExportScope, kind: ExportKind): Promise<boolean>

  /**
   * Clears the account's log.
   *
   * Called only on wallet reset. Clearing "to dismiss a warning" is
   * forbidden: a released secret stays released, and erasing the
   * record only hides the real state.
   */
  clear(scope: ExportScope): Promise<void>
}

/**
 * Guard for export operations.
 *
 * Required caller order:
 *
 * 1. `assess(request)` — get the risk assessment.
 * 2. Show the user a warning that matches the risk level.
 * 3. `confirm(request, acknowledgedRisk)` — get a permit, passing the
 *    risk level that was shown.
 * 4. Hand the permit to the export method.
 *
 * Step 3 cannot be skipped, and the shown level cannot be understated:
 * if the actual risk is higher than the acknowledged one, no permit is
 * issued. That blocks a UI that shows a soft warning where irreversible
 * consequences must be explained.
 */
export interface IExportGuard {
  /** Assesses risk without writing or granting anything. */
  assess(request: IExportRequest): Promise<IExportRiskAssessment>

  /**
   * Issues a one-shot permit and records the export in the log.
   *
   * The write happens when the permit is issued, not after a successful
   * dump. The error direction is deliberate: an extra record leads to a
   * stricter warning later; a missed one leads to no warning where one
   * is required.
   *
   * @param acknowledgedRisk Risk level shown to the user.
   * @throws ExportNotPermittedError if the actual risk is higher than
   *         the acknowledged one.
   */
  confirm(request: IExportRequest, acknowledgedRisk: ExportRisk): Promise<ExportPermit>

  /** Account export history — for the security screen. */
  getHistory(scope: ExportScope): Promise<readonly IExportRecord[]>
}
