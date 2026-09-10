import type { Timestamp } from '@/core/types'

import type { ExportKind, ExportRisk, ExportScope, IExportRequest } from './types'

/**
 * Разрешение на однократный экспорт секрета.
 *
 * ЗАЧЕМ ЭТО НУЖНО. Без разрешения любой участок кода мог бы вызвать
 * `exportAccountXprv()` напрямую — например, в обработчике, добавленном
 * через полгода разработчиком, не читавшим комментарии про BIP-32.
 * Разрешение делает экспорт невозможным в обход оценки риска.
 *
 * Гарантии:
 *
 * 1. **Создаётся только защитником.** Конструктор закрыт, фабричный метод
 *    помечен как внутренний и не входит в публичный API ядра.
 *
 * 2. **Одноразовое.** После использования становится недействительным.
 *    Иначе одно подтверждение пользователя открывало бы неограниченное
 *    число выгрузок.
 *
 * 3. **Привязано к конкретной операции.** Разрешение на выдачу xpub нельзя
 *    предъявить для выдачи xprv, а разрешение для одного адреса — для другого.
 *
 * 4. **Не содержит секрета.** Само по себе безопасно, в журнал попадать может.
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
   * Выдаёт разрешение.
   *
   * @internal Вызывается только из `ExportGuard`. Не экспортируется
   *           из публичного API ядра: прямой вызов обходит оценку риска.
   */
  static issue(request: IExportRequest, risk: ExportRisk, issuedAt: Timestamp): ExportPermit {
    return new ExportPermit(request, risk, issuedAt)
  }

  /** Было ли разрешение уже использовано. */
  get isConsumed(): boolean {
    return this.#consumed
  }

  /**
   * Соответствует ли разрешение запрашиваемой операции.
   *
   * Проверяется исполнителем экспорта до выдачи секрета.
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
   * Помечает разрешение использованным.
   *
   * Вызывается исполнителем экспорта непосредственно перед выдачей секрета.
   */
  consume(): void {
    this.#consumed = true
  }

  /** Не раскрывает состояние при сериализации состояния приложения. */
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
