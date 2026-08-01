import { AppError } from './AppError'
import { ERROR_CODE, type ErrorCode } from './ErrorCode'

/**
 * Ошибки жизненного цикла кошелька, доступа и работы с ключами.
 *
 * Общее правило для всех классов ниже: сообщение НЕ содержит ни введённого
 * пароля, ни фрагментов мнемоники, ни приватного ключа. Даже часть секрета
 * в тексте ошибки означает его попадание в журнал и в отчёт о сбое.
 */

/** Операция требует снятой блокировки. */
export class WalletLockedError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.WalletLocked

  constructor(operation: string) {
    super(`Операция "${operation}" недоступна: кошелёк заблокирован.`)
  }
}

/** Кошелёк ещё не создан и не импортирован. */
export class WalletNotInitializedError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.WalletNotInitialized

  constructor() {
    super('Кошелёк не инициализирован.')
  }
}

/** Попытка создать кошелёк поверх существующего. */
export class WalletAlreadyInitializedError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.WalletAlreadyInitialized

  constructor() {
    super('Кошелёк уже инициализирован. Требуется явный сброс.')
  }
}

/**
 * Неверный пароль.
 *
 * Сообщение намеренно не уточняет, что именно не сошлось. Отличие
 * «неверный пароль» от «хранилище повреждено» — это информация для
 * подбирающего пароль, а не для пользователя.
 */
export class InvalidPasswordError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.InvalidPassword

  constructor() {
    super('Неверный пароль.')
  }
}

/**
 * Попыток ввода пароля слишком много: ввод временно закрыт.
 *
 * ОТДЕЛЬНАЯ ОШИБКА, А НЕ «НЕВЕРНЫЙ ПАРОЛЬ». Различие видно и без неё —
 * по тому, что форма перестала принимать ввод, — и скрывать его значит
 * оставить владельца в недоумении, почему верный пароль не подходит.
 * Подбирающему это ничего не даёт: он и так упирается в задержку.
 */
export class TooManyAttemptsError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.TooManyAttempts

  /** Через сколько миллисекунд можно повторить. */
  readonly retryAfterMs: number

  constructor(retryAfterMs: number) {
    super(`Слишком много попыток. Повторите через ${String(Math.ceil(retryAfterMs / 1000))} с.`)
    this.retryAfterMs = retryAfterMs
  }
}

/** Пароль не удовлетворяет политике сложности. */
export class WeakPasswordError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.WeakPassword

  constructor(reason: string) {
    super(`Пароль не соответствует требованиям: ${reason}`)
  }
}

/**
 * Причина непригодности мнемонической фразы.
 *
 * Различение обязательно для интерфейса: «в слове опечатка» и «не сходится
 * контрольная сумма» требуют разных действий пользователя. Единое сообщение
 * «фраза некорректна» оставляет его наедине с 24 словами и без подсказки,
 * где искать ошибку, — а цена нерешённой проблемы здесь равна потере доступа
 * к средствам.
 */
export const MNEMONIC_INVALID_REASON = {
  /** Пустой ввод. */
  Empty: 'empty',
  /** Число слов не входит в набор 12, 15, 18, 21, 24. */
  WordCount: 'word-count',
  /** Одно или несколько слов отсутствуют в словаре BIP-39. */
  UnknownWord: 'unknown-word',
  /**
   * Слова корректны, но контрольная сумма не сходится.
   * Практически всегда означает перепутанный порядок слов.
   */
  Checksum: 'checksum',
} as const

export type MnemonicInvalidReason =
  (typeof MNEMONIC_INVALID_REASON)[keyof typeof MNEMONIC_INVALID_REASON]

/** Понятные пояснения к каждой причине. Секретов не содержат. */
const MNEMONIC_REASON_MESSAGE: Readonly<Record<MnemonicInvalidReason, string>> = {
  [MNEMONIC_INVALID_REASON.Empty]: 'фраза не введена',
  [MNEMONIC_INVALID_REASON.WordCount]: 'недопустимое количество слов',
  [MNEMONIC_INVALID_REASON.UnknownWord]: 'одно или несколько слов отсутствуют в словаре BIP-39',
  [MNEMONIC_INVALID_REASON.Checksum]: 'не сходится контрольная сумма BIP-39',
}

/**
 * Мнемоническая фраза не прошла проверку BIP-39.
 *
 * Сообщение НЕ содержит ни самой фразы, ни отдельных её слов: текст ошибки
 * попадает в журнал и в отчёт о сбое. Позиции ошибочных слов возвращаются
 * отдельно, через результат валидации, и остаются в памяти вызывающего кода.
 */
export class InvalidMnemonicError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.InvalidMnemonic

  /** Машиночитаемая причина. Именно по ней интерфейс подбирает подсказку. */
  readonly reason: MnemonicInvalidReason

  constructor(reason: MnemonicInvalidReason) {
    super(`Мнемоническая фраза некорректна: ${MNEMONIC_REASON_MESSAGE[reason]}.`)
    this.reason = reason
  }
}

/** Приватный ключ имеет неверный формат или лежит вне допустимого диапазона. */
export class InvalidPrivateKeyError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.InvalidPrivateKey

  constructor() {
    super('Приватный ключ некорректен.')
  }
}

/** Аккаунт с указанным идентификатором или адресом не найден. */
export class AccountNotFoundError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.AccountNotFound

  constructor(identifier: string) {
    super(`Аккаунт не найден: ${identifier}`)
  }
}

/** Аккаунт с таким адресом уже присутствует в кошельке. */
export class AccountAlreadyExistsError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.AccountAlreadyExists

  constructor(address: string) {
    super(`Аккаунт уже добавлен: ${address}`)
  }
}

/**
 * Аккаунт не может быть удалён.
 *
 * Относится к аккаунтам, выведенным из seed-фразы. Их удаление невозможно
 * не по решению разработчика, а по устройству BIP-32: тот же аккаунт
 * появится снова при следующем восстановлении кошелька по той же фразе.
 *
 * Кнопка «удалить», которая на деле лишь прячет запись, вводит пользователя
 * в заблуждение относительно того, что происходит с его средствами.
 * Честное поведение — отказ с объяснением и предложение скрыть аккаунт.
 */
export class AccountNotRemovableError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.AccountNotRemovable

  constructor(reason: string) {
    super(`Аккаунт нельзя удалить: ${reason}`)
  }
}

/** Набор ключей не найден. */
export class KeyringNotFoundError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.KeyringNotFound

  constructor(keyringId: string) {
    super(`Набор ключей не найден: ${keyringId}`)
  }
}

/**
 * Набор ключей не способен подписывать.
 *
 * Штатная ситуация для watch-only аккаунтов и для аппаратного кошелька,
 * который не подключён физически.
 */
export class KeyringCannotSignError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.KeyringCannotSign

  constructor(reason: string) {
    super(`Подпись невозможна: ${reason}`)
  }
}

/**
 * Экспорт секрета запрещён.
 *
 * Возникает при попытке выгрузить приватный ключ из аппаратного кошелька
 * (физически невозможно) либо при отсутствии явного подтверждения операции.
 */
export class ExportNotPermittedError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.ExportNotPermitted

  constructor(reason: string) {
    super(`Экспорт секрета запрещён: ${reason}`)
  }
}
