import type { ISecretBuffer } from '@/core/encryption'
import type { IEventSource } from '@/core/events'
import type { IKeyring, KeyringCreationOptions } from '@/core/keyring'
import type { Address, KeyringId } from '@/core/types'

import type {
  ICreateWalletParams,
  IImportWalletParams,
  IVault,
  IWalletCreationResult,
  LockReason,
  WalletEventMap,
  WalletStatus,
} from './types'

/**
 * Кошелёк как целое: зашифрованное хранилище и управление доступом к нему.
 *
 * Отношение к соседним абстракциям:
 * - `IWallet` владеет хранилищем и состоянием блокировки;
 * - `IKeyring` владеет секретами конкретного источника ключей;
 * - `IAccountService` работает с публичной проекцией — адресами и именами.
 *
 * Разделение позволяет UI постоянно держать список аккаунтов, тогда как
 * доступ к ключам существует лишь на время снятой блокировки.
 */
export interface IWallet extends IEventSource<WalletEventMap> {
  /** Читает хранилище и определяет исходное состояние. */
  init(): Promise<void>

  getStatus(): WalletStatus

  isUnlocked(): boolean

  /**
   * Создаёт новый кошелёк.
   *
   * Возвращает мнемонику ровно один раз. Повторно получить её можно только
   * через `exportMnemonic` с вводом пароля. Вызывающий обязан затереть буфер
   * после подтверждения пользователем.
   *
   * @throws WalletAlreadyInitializedError, WeakPasswordError
   */
  create(params: ICreateWalletParams): Promise<IWalletCreationResult>

  /**
   * Импортирует кошелёк по мнемонической фразе.
   *
   * @throws WalletAlreadyInitializedError, InvalidMnemonicError, WeakPasswordError
   */
  importFromMnemonic(params: IImportWalletParams): Promise<void>

  /**
   * Снимает блокировку.
   *
   * Реализация обязана иметь защиту от подбора: задержку между попытками
   * либо ограничение их числа. Стойкость KDF замедляет перебор, но не
   * отменяет необходимость ограничения на уровне приложения.
   *
   * @throws InvalidPasswordError, WalletNotInitializedError
   */
  unlock(password: string): Promise<void>

  /**
   * Ставит блокировку и обнуляет все буферы секретов.
   *
   * Синхронный метод намеренно: блокировка обязана выполниться до того,
   * как управление вернётся в цикл событий. Асинхронная блокировка
   * оставляет промежуток, в течение которого ключи ещё в памяти,
   * а приложение считает себя заблокированным.
   */
  lock(reason: LockReason): void

  /**
   * Меняет пароль.
   *
   * Перешифровывает хранилище новым ключом. Операция обязана быть
   * атомарной: сбой посреди перезаписи не должен оставить хранилище
   * ни в старом, ни в новом состоянии частично.
   *
   * @throws InvalidPasswordError, WeakPasswordError
   */
  changePassword(currentPassword: string, newPassword: string): Promise<void>

  /**
   * Выгружает мнемоническую фразу.
   *
   * Пароль запрашивается заново, даже если кошелёк уже разблокирован:
   * показ seed-фразы — необратимое по последствиям действие, и оно обязано
   * требовать явного подтверждения владения паролем.
   *
   * @throws InvalidPasswordError
   */
  exportMnemonic(password: string): Promise<ISecretBuffer>

  /** Наборы ключей. Пустой список при заблокированном кошельке. */
  getKeyrings(): readonly IKeyring[]

  /** Поиск набора по идентификатору. */
  getKeyringById(id: KeyringId): IKeyring | null

  /**
   * Находит набор, обслуживающий адрес.
   *
   * Используется перед подписью: выбор набора по адресу, а не наоборот.
   *
   * @throws AccountNotFoundError
   */
  getKeyringForAddress(address: Address): IKeyring

  /**
   * Добавляет набор ключей: импорт приватного ключа, подключение
   * аппаратного кошелька, добавление наблюдаемого адреса.
   *
   * @throws WalletLockedError, AccountAlreadyExistsError
   */
  addKeyring(options: KeyringCreationOptions): Promise<IKeyring>

  /**
   * Удаляет набор ключей.
   *
   * Основной HD-набор удалить нельзя: его удаление означало бы потерю
   * доступа ко всем выведенным из него аккаунтам при сохранении их
   * в списке.
   */
  removeKeyring(id: KeyringId): Promise<void>

  /**
   * Полностью удаляет кошелёк.
   *
   * НЕОБРАТИМАЯ ОПЕРАЦИЯ. Без сохранённой seed-фразы средства теряются
   * безвозвратно. Реализация обязана требовать пароль, а вызывающий код —
   * явное подтверждение пользователя.
   */
  reset(password: string): Promise<void>
}

/** Долговременное хранение зашифрованного хранилища ключей. */
export interface IVaultRepository {
  /** Существует ли хранилище. Проверяется до попытки чтения. */
  exists(): Promise<boolean>

  load(): Promise<IVault | null>

  /**
   * Сохраняет хранилище.
   *
   * Реализация обязана писать атомарно. Прерывание записи, оставляющее
   * повреждённое хранилище, означает безвозвратную потерю ключей.
   */
  save(vault: IVault): Promise<void>

  delete(): Promise<void>
}
