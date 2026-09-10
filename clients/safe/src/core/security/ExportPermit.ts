import type { Timestamp } from '@/core/types'

import type { ExportKind, ExportRisk, ExportScope, IExportRequest } from './types'

/**
 * Permit for a single secret export.
 *
 * WHY THIS EXISTS. Without a permit any code could call
 * `exportAccountXprv()` directly — for example in a handler added six
 * months later by a developer who never read the BIP-32 comments.
 * The permit makes export impossible without a risk assessment.
 *
 * Guarantees:
 *
 * 1. **Created only by the guard.** The constructor is private; the
 *    factory is marked internal and is not part of the core public API.
 *
 * 2. **One-shot.** After use it becomes invalid. Otherwise one user
 *    confirmation would open unlimited dumps.
 *
 * 3. **Bound to a specific operation.** A permit for an xpub cannot
 *    be presented for an xprv, nor one for one address for another.
 *
 * 4. **Holds no secret.** Safe by itself; may appear in a log.
 */
export class ExportPermit {
  readonly kind: ExportKind
  readonly scope: ExportScope
  readonly addressIndex: number | null
  readonly risk: ExportRisk
  readonly issuedAt: Timestamp

  #consumed = false

  private constructor(request: IExportRequest, risk: ExportRisk, issuedAt: Timestamp) {
    this.kind = request.kind
    this.scope = request.scope
    this.addressIndex = request.addressIndex
    this.risk = risk
    this.issuedAt = issuedAt
  }

  /**
   * Issues a permit.
   *
   * @internal Called only from `ExportGuard`. Not exported from the
   *           core public API: a direct call bypasses the risk
   *           assessment.
   */
  static issue(request: IExportRequest, risk: ExportRisk, issuedAt: Timestamp): ExportPermit {
    return new ExportPermit(request, risk, issuedAt)
  }

  get isConsumed(): boolean {
    return this.#consumed
  }

  /**
   * Whether the permit matches the requested operation.
   *
   * Checked by the export executor before releasing the secret.
   */
  matches(kind: ExportKind, scope: ExportScope, addressIndex: number | null): boolean {
    return (
      !this.#consumed &&
      this.kind === kind &&
      this.scope === scope &&
      this.addressIndex === addressIndex
    )
  }

  /**
   * Marks the permit used.
   *
   * Called by the export executor immediately before releasing the
   * secret.
   */
  consume(): void {
    this.#consumed = true
  }

  /** Does not reveal extra state when app state is serialised. */
  toJSON(): Record<string, unknown> {
    return {
      kind: this.kind,
      scope: this.scope,
      addressIndex: this.addressIndex,
      risk: this.risk,
      isConsumed: this.#consumed,
    }
  }
}
