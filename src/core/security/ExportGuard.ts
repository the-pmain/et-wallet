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
 * Индекс аккаунта, которым подписываются транзакции.
 *
 * Соответствует `m/44'/60'/0'` и совпадает с поведением MetaMask, Trust
 * и прочих кошельков: восстановление фразы в любом из них даст те же адреса.
 */
export const SIGNING_ACCOUNT_INDEX = 0

/**
 * Индекс аккаунта, зарезервированного под режим наблюдения.
 *
 * СТРУКТУРНАЯ МЕРА ЗАЩИТЫ, а не соглашение об именовании.
 *
 * Уровень аккаунта в BIP-44 закалён: шаг `m/44'/60' -> m/44'/60'/n'`
 * использует приватный ключ родителя, поэтому из расширенного публичного
 * ключа одного аккаунта невозможно получить ничего об остальных.
 *
 * Следствие: xpub, выданный из `m/44'/60'/1'`, не создаёт никакого риска
 * для подписывающего аккаунта `m/44'/60'/0'` — даже если получателю
 * когда-либо достанется приватный ключ адреса из аккаунта наблюдения.
 * Компрометация остаётся запертой внутри одного аккаунта.
 */
export const WATCH_ONLY_ACCOUNT_INDEX = 1

/**
 * Индекс аккаунта из области экспорта: `m/44'/60'/1'` -> 1.
 *
 * Для областей импортированных ключей возвращает `null`: они не принадлежат
 * никакому дереву, и понятие индекса аккаунта к ним неприменимо.
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
 * Оценка риска и выдача разрешений на экспорт секретов.
 *
 * ЗАКРЫВАЕМАЯ ПРОБЛЕМА. Несмягчённая деривация BIP-32 устроена так, что
 *
 *     k_child = (IL + k_parent) mod n,
 *     IL = HMAC-SHA512(chainCode_parent, pubKey_parent || index)
 *
 * а расширенный публичный ключ содержит и `chainCode_parent`,
 * и `pubKey_parent`. Значит, обладая xpub родителя и приватным ключом
 * любого потомка, злоумышленник вычисляет
 *
 *     k_parent = (k_child − IL) mod n
 *
 * и получает все адреса аккаунта. Устранить это математически нельзя:
 * закалённая деривация на уровнях `change` и `addressIndex` сделала бы
 * xpub бесполезным и, что важнее, сломала бы совместимость с BIP-44 —
 * seed-фраза перестала бы восстанавливаться в других кошельках.
 *
 * ЧТО ДЕЛАЕТ ЭТОТ КЛАСС. Опасность возникает только когда ОБА артефакта
 * попадают к одному получателю. Это состояние отслеживается и делается
 * видимым: экспорт, замыкающий пару, помечается уровнем
 * `AccountCompromise`, и разрешение на него не выдаётся, пока интерфейс
 * не подтвердит, что показал предупреждение именно этого уровня.
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
        /* Расширенный приватный ключ уже даёт весь аккаунт. Замыкать
           здесь нечего: компрометация полная независимо от истории. */
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

    /* Ключевая проверка. Интерфейс, показавший мягкое предупреждение
       там, где требуется объяснение необратимых последствий, разрешения
       не получит. Без этого шага оценка риска осталась бы декоративной. */
    if (riskLevel(acknowledgedRisk) < riskLevel(assessment.risk)) {
      throw new ExportNotPermittedError(
        `подтверждён уровень риска "${acknowledgedRisk}", фактический — "${assessment.risk}"`,
      )
    }

    const record: IExportRecord = {
      kind: request.kind,
      scope: request.scope,
      addressIndex: request.addressIndex,
      risk: assessment.risk,
      at: this.#clock.now(),
    }

    /* Запись до выдачи разрешения, а не после успешной выгрузки.
       Лишняя запись приведёт к более строгому предупреждению в будущем,
       пропущенная — к отсутствию предупреждения там, где оно необходимо. */
    await this.#auditLog.record(record)

    return ExportPermit.issue(request, assessment.risk, record.at)
  }

  async getHistory(scope: ExportScope): Promise<readonly IExportRecord[]> {
    return await this.#auditLog.listByScope(scope)
  }

  async #assessPrivateKey(request: IExportRequest): Promise<IExportRiskAssessment> {
    const xpubExported = await this.#auditLog.hasExported(request.scope, EXPORT_KIND.Xpub)

    if (xpubExported) {
      /* Пара замыкается: xpub уже выдан, приватный ключ потомка выдаётся
         сейчас. Получатель обоих вычисляет весь аккаунт. */
      return ExportGuard.#assessment(
        request,
        EXPORT_RISK.AccountCompromise,
        EXPORT_RISK_REASON.XpubAlreadyExported,
        true,
        false,
      )
    }

    /* xpub не выдавался. Риск повышенный, но не критический: выдача
       приватного ключа сама по себе открывает только один адрес. */
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
      /* Пара ещё не замкнута, но аккаунт подписывающий: любой будущий
         экспорт приватного ключа из него приведёт к компрометации.
         Правильный выход — выдать xpub из аккаунта наблюдения. */
      return ExportGuard.#assessment(
        request,
        EXPORT_RISK.Elevated,
        EXPORT_RISK_REASON.XpubFromSigningAccount,
        false,
        true,
      )
    }

    /* Отдельный аккаунт, приватные ключи из него не выдавались.
       Уровень аккаунта закалён, поэтому подписывающий аккаунт
       не затрагивается ни при каких обстоятельствах. */
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

/** Удобный конструктор запроса на экспорт уровня аккаунта. */
export function accountExportRequest(kind: ExportKind, scope: ExportScope): IExportRequest {
  return { kind, scope, addressIndex: null }
}

/**
 * Удобный конструктор запроса на экспорт приватного ключа.
 *
 * `addressIndex` равен `null` для импортированных ключей: они не имеют
 * позиции в HD-дереве.
 */
export function privateKeyExportRequest(
  scope: ExportScope,
  addressIndex: number | null,
): IExportRequest {
  return { kind: EXPORT_KIND.PrivateKey, scope, addressIndex }
}
