import type { IEncryptedPayload, ISecretBuffer } from '@/core/encryption'
import type { ISerializedKeyring } from '@/core/keyring'
import type { Timestamp } from '@/core/types'

/**
 * Состояние кошелька.
 *
 * Три состояния, а не флаг «заблокирован»: «не создан» и «заблокирован» —
 * принципиально разные ситуации. В первом случае интерфейс обязан предложить
 * создание или импорт, во втором — ввод пароля. Сведение их к одному булеву
 * значению приводит к экрану ввода пароля от несуществующего кошелька.
 */
export const WALLET_STATUS = {
  /** Хранилище не создано. Требуется создание или импорт. */
  Uninitialized: 'uninitialized',
  /** Хранилище существует, ключи зашифрованы. Требуется пароль. */
  Locked: 'locked',
  /** Ключи расшифрованы и находятся в памяти. */
  Unlocked: 'unlocked',
} as const

export type WalletStatus = (typeof WALLET_STATUS)[keyof typeof WALLET_STATUS]

/**
 * Причина блокировки.
 *
 * Различается для интерфейса: блокировку по таймауту стоит сопроводить
 * пояснением, блокировку по требованию пользователя — нет.
 */
export const LOCK_REASON = {
  /** Пользователь заблокировал вручную. */
  User: 'user',
  /** Истёк таймаут бездействия. */
  Timeout: 'timeout',
  /** Приложение закрывается либо вкладка выгружается. */
  Shutdown: 'shutdown',
} as const

export type LockReason = (typeof LOCK_REASON)[keyof typeof LOCK_REASON]

/**
 * Расшифрованное содержимое хранилища.
 *
 * Существует только в памяти при снятой блокировке. Никогда не сохраняется
 * и не сериализуется в открытом виде.
 */
export interface IVaultContent {
  readonly keyrings: readonly ISerializedKeyring[]
}

/**
 * Зашифрованное хранилище в том виде, в каком оно лежит в постоянной памяти.
 *
 * Метаданные (`createdAt`, `updatedAt`) снаружи шифрования сознательно:
 * они не являются секретом, а их доступность без пароля позволяет показать
 * пользователю сведения о резервной копии до разблокировки.
 */
export interface IVault {
  readonly payload: IEncryptedPayload
  readonly createdAt: Timestamp
  readonly updatedAt: Timestamp
}

/**
 * Результат создания нового кошелька.
 *
 * Мнемоника возвращается буфером, а не строкой, и подлежит затиранию сразу
 * после того, как пользователь подтвердил её сохранение. Держать seed-фразу
 * в состоянии React до конца сессии недопустимо.
 */
export interface IWalletCreationResult {
  readonly mnemonic: ISecretBuffer
}

/** Параметры создания кошелька. */
export interface ICreateWalletParams {
  readonly password: string

  /**
   * Стойкость мнемоники в битах: 128 (12 слов) либо 256 (24 слова).
   *
   * Энтропия берётся исключительно из `crypto.getRandomValues`.
   * `Math.random` непригоден: он не криптостойкий, и выведенные из него
   * ключи предсказуемы.
   */
  readonly strength?: 128 | 256
}

/** Параметры импорта существующего кошелька. */
export interface IImportWalletParams {
  readonly mnemonic: ISecretBuffer
  readonly password: string
  /** Сколько аккаунтов восстановить сразу. */
  readonly accountCount?: number
}

/** События кошелька. */
export interface WalletEventMap {
  'wallet:initialized': { readonly at: Timestamp }
  'wallet:unlocked': { readonly at: Timestamp }
  'wallet:locked': { readonly at: Timestamp; readonly reason: LockReason }
  'wallet:reset': { readonly at: Timestamp }
  /** Состав наборов ключей изменён: добавлен или удалён источник аккаунтов. */
  'wallet:keyringsChanged': { readonly count: number }
}
