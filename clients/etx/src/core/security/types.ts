import type { Brand } from '@/shared/types'

import type { DerivationPath, KeyringId, Timestamp } from '@/core/types'

/**
 * Область, к которой относится экспорт секрета.
 *
 * ПОЧЕМУ НЕ ПРОСТО ПУТЬ ДЕРИВАЦИИ. Опасное сочетание «xpub плюс приватный
 * ключ потомка» существует только внутри одного HD-аккаунта. Импортированный
 * ключ не принадлежит никакому дереву: его выдача не раскрывает HD-аккаунт,
 * а выдача xpub HD-аккаунта не раскрывает импортированный ключ.
 *
 * Если бы обе операции учитывались под одним путём деривации, экспорт
 * импортированного ключа помечал бы HD-аккаунт скомпрометированным.
 * Ложное предупреждение здесь не безобидно: пользователь, приученный
 * к ложным тревогам, перестаёт читать настоящие.
 */
export type ExportScope = Brand<string, 'ExportScope'>

/** Область HD-аккаунта. Совпадает с путём деривации уровня аккаунта. */
export function hdAccountScope(accountPath: DerivationPath): ExportScope {
  return accountPath as string as ExportScope
}

/**
 * Область импортированного ключа.
 *
 * Префикс исключает совпадение с путём деривации: тот всегда начинается
 * с `m/`.
 */
export function importedKeyScope(keyringId: KeyringId): ExportScope {
  return `imported:${keyringId}` as ExportScope
}

/**
 * Область всего кошелька. Применима только к мнемонической фразе.
 *
 * ПОЧЕМУ НЕ ПУТЬ ПОДПИСЫВАЮЩЕГО АККАУНТА. Фраза не принадлежит ни одному
 * аккаунту: из неё выводятся все, включая ещё не созданные. Записав её
 * выдачу под путём `m/44'/60'/0'`, мы утверждали бы, что риск ограничен
 * этим аккаунтом, — прямо противоположное действительности.
 *
 * Значение не начинается ни с `m/`, ни с `imported:`, поэтому совпасть
 * с областью аккаунта либо импортированного ключа не может.
 */
export const WALLET_SCOPE = 'wallet' as ExportScope

/**
 * Вид экспортируемого секрета.
 *
 * Различение принципиально: последствия выдачи xpub и выдачи xprv
 * отличаются на порядки, и обобщённое «экспортировать» скрыло бы эту разницу.
 */
export const EXPORT_KIND = {
  /** Расширенный публичный ключ. Сам по себе средствами не распоряжается. */
  Xpub: 'xpub',
  /** Приватный ключ одного адреса. */
  PrivateKey: 'private-key',
  /** Расширенный приватный ключ — доступ ко всем адресам аккаунта. */
  Xprv: 'xprv',
  /** Мнемоническая фраза — доступ ко всему кошельку. */
  Mnemonic: 'mnemonic',
} as const

export type ExportKind = (typeof EXPORT_KIND)[keyof typeof EXPORT_KIND]

/**
 * Уровень риска операции экспорта.
 *
 * Порядок возрастания задан явно: он используется для сравнения
 * подтверждённого пользователем уровня с фактическим.
 */
export const EXPORT_RISK = {
  /** Обычный экспорт без известных осложняющих обстоятельств. */
  Low: 'low',
  /** Экспорт создаёт предпосылку для будущей компрометации. */
  Elevated: 'elevated',
  /**
   * Экспорт ЗАМЫКАЕТ пару «xpub + приватный ключ потомка».
   *
   * После него получатель обоих артефактов способен арифметически вычислить
   * приватный ключ всего аккаунта. Это не предположение, а прямое следствие
   * устройства несмягчённой деривации BIP-32.
   */
  AccountCompromise: 'account-compromise',
  /** Выдача секрета, дающего доступ ко всему аккаунту или кошельку. */
  Critical: 'critical',
} as const

export type ExportRisk = (typeof EXPORT_RISK)[keyof typeof EXPORT_RISK]

/**
 * Порядок уровней риска по возрастанию.
 *
 * Массив, а не числовые значения в самой константе: числа в перечислении
 * соблазняют сравнивать их напрямую, а строковые значения обязаны попадать
 * в хранилище и в интерфейс в читаемом виде.
 */
export const EXPORT_RISK_ORDER: readonly ExportRisk[] = [
  EXPORT_RISK.Low,
  EXPORT_RISK.Elevated,
  EXPORT_RISK.AccountCompromise,
  EXPORT_RISK.Critical,
]

/** Возвращает порядковый номер уровня риска. */
export function riskLevel(risk: ExportRisk): number {
  return EXPORT_RISK_ORDER.indexOf(risk)
}

/**
 * Причина назначенного уровня риска.
 *
 * Машиночитаемый код, а не готовый текст: интерфейс подбирает формулировку
 * на языке пользователя, а в журнал попадает стабильный идентификатор.
 */
export const EXPORT_RISK_REASON = {
  /** Осложняющих обстоятельств нет. */
  None: 'none',
  /** Из этого аккаунта уже выдавался xpub. */
  XpubAlreadyExported: 'xpub-already-exported',
  /** Из этого аккаунта уже выдавался приватный ключ. */
  PrivateKeyAlreadyExported: 'private-key-already-exported',
  /** xpub запрашивается из аккаунта, которым подписываются транзакции. */
  XpubFromSigningAccount: 'xpub-from-signing-account',
  /** Экспортируемый секрет открывает доступ ко всему аккаунту. */
  GrantsWholeAccount: 'grants-whole-account',
  /** Экспортируемый секрет открывает доступ ко всему кошельку. */
  GrantsWholeWallet: 'grants-whole-wallet',
} as const

export type ExportRiskReason = (typeof EXPORT_RISK_REASON)[keyof typeof EXPORT_RISK_REASON]

/** Запрос на экспорт секрета. */
export interface IExportRequest {
  readonly kind: ExportKind

  /** Область, из которой выполняется экспорт. */
  readonly scope: ExportScope

  /**
   * Индекс адреса. Заполняется только для {@link EXPORT_KIND.PrivateKey}.
   * Для экспорта уровня аккаунта равен `null`.
   */
  readonly addressIndex: number | null
}

/** Заключение о риске операции. */
export interface IExportRiskAssessment {
  readonly request: IExportRequest
  readonly risk: ExportRisk
  readonly reason: ExportRiskReason

  /**
   * Приведёт ли операция к тому, что аккаунт станет вычислимым целиком.
   *
   * Отдельный флаг, а не вывод из уровня риска: интерфейс обязан показать
   * при этом условии не предупреждение, а объяснение необратимых последствий.
   */
  readonly closesCompromisePair: boolean

  /**
   * Рекомендация вынести операцию в отдельный аккаунт.
   *
   * Уровень аккаунта в BIP-44 закалён, поэтому компрометация одного аккаунта
   * не затрагивает другие. Выдача xpub из аккаунта, зарезервированного
   * под наблюдение, полностью снимает риск эскалации.
   */
  readonly suggestsSeparateAccount: boolean
}

/** Запись журнала экспортов. */
export interface IExportRecord {
  readonly kind: ExportKind
  readonly scope: ExportScope
  readonly addressIndex: number | null
  readonly risk: ExportRisk
  readonly at: Timestamp
}
