import type { ISecretBuffer } from '@/core/encryption'
import type { IEventSource } from '@/core/events'
import type { ExportPermit } from '@/core/security'
import type { AccountId, Address } from '@/core/types'

import type {
  AccountEventMap,
  IAccount,
  ICreateAccountParams,
  IImportPrivateKeyParams,
} from './types'

/**
 * Управление аккаунтами кошелька.
 *
 * Сервис работает с ПУБЛИЧНОЙ проекцией ключей: адресами, именами,
 * порядком отображения. Ни один его метод не возвращает секрет — кроме
 * `exportPrivateKey`, который требует и пароля, и разрешения от `ExportGuard`.
 *
 * ДВА ИСТОЧНИКА АККАУНТОВ, и различие между ними определяет поведение:
 *
 * | Источник       | Ключ восстановим из seed | Удаление |
 * | -------------- | ------------------------ | -------- |
 * | HD-дерево      | да                       | невозможно, только скрытие |
 * | Импортированный| нет                      | возможно, необратимо |
 *
 * Метаданные аккаунтов хранятся зашифрованными. Адреса сами по себе
 * не секрет, но их список связывает все аккаунты одного пользователя,
 * поэтому заблокированный кошелёк их не раскрывает.
 */
export interface IAccountManager extends IEventSource<AccountEventMap> {
  /**
   * Загружает аккаунты из хранилища.
   *
   * @throws WalletLockedError если хранилище заблокировано.
   */
  init(): Promise<void>

  /** Все аккаунты, включая скрытые, в пользовательском порядке. */
  list(): readonly IAccount[]

  /** Только видимые аккаунты. Именно этот список показывается в интерфейсе. */
  listVisible(): readonly IAccount[]

  /** Активный аккаунт. `null`, если аккаунтов ещё нет. */
  getActive(): IAccount | null

  getById(id: AccountId): IAccount | null

  getByAddress(address: Address): IAccount | null

  /**
   * Меняет активный аккаунт.
   *
   * Скрытый аккаунт активным не становится: он не показан в интерфейсе,
   * и пользователь не понял бы, откуда уходят средства.
   *
   * @throws AccountNotFoundError, InvalidArgumentError
   */
  setActive(id: AccountId): Promise<void>

  /**
   * Выводит очередной аккаунт из HD-дерева.
   *
   * Индекс адреса выбирается как следующий после максимального
   * из уже созданных, а не как число аккаунтов: удалить HD-аккаунт нельзя,
   * но можно скрыть, и подсчёт по количеству дал бы повторный индекс.
   *
   * @throws WalletLockedError
   */
  create(params?: ICreateAccountParams): Promise<IAccount>

  /**
   * Импортирует аккаунт по приватному ключу.
   *
   * Ключ сохраняется зашифрованным и с этого момента существует
   * в единственном экземпляре: из seed-фразы он не восстанавливается.
   *
   * @throws AccountAlreadyExistsError если адрес уже добавлен.
   * @throws InvalidPrivateKeyError при непригодном ключе.
   * @throws WalletLockedError
   */
  importPrivateKey(params: IImportPrivateKeyParams): Promise<IAccount>

  /**
   * Переименовывает аккаунт.
   *
   * Имя нормализуется: удаляются управляющие символы, схлопываются
   * пробелы, проверяется длина.
   *
   * @throws AccountNotFoundError, InvalidArgumentError
   */
  rename(id: AccountId, name: string): Promise<void>

  /**
   * Скрывает или показывает аккаунт.
   *
   * Скрытие — единственный доступный способ убрать HD-аккаунт из списка.
   * Активный аккаунт скрыть нельзя: интерфейс остался бы без выбранного
   * отправителя.
   *
   * @throws AccountNotFoundError, InvalidArgumentError
   */
  setHidden(id: AccountId, hidden: boolean): Promise<void>

  /**
   * Удаляет импортированный аккаунт вместе с его ключом.
   *
   * НЕОБРАТИМАЯ ОПЕРАЦИЯ. Импортированный ключ не восстанавливается
   * из seed-фразы: после удаления доступ к средствам на этом адресе
   * теряется, если ключ не сохранён отдельно.
   *
   * Пароль обязателен именно поэтому.
   *
   * @throws AccountNotRemovableError для аккаунтов из HD-дерева.
   * @throws InvalidPasswordError, AccountNotFoundError
   */
  remove(id: AccountId, password: string): Promise<void>

  /**
   * Меняет порядок отображения.
   *
   * Список обязан содержать идентификаторы всех существующих аккаунтов:
   * частичный порядок оставил бы часть аккаунтов без позиции.
   *
   * @throws InvalidArgumentError
   */
  reorder(orderedIds: readonly AccountId[]): Promise<void>

  /**
   * Выгружает приватный ключ аккаунта.
   *
   * ТРЕБУЕТ ДВУХ НЕЗАВИСИМЫХ ПОДТВЕРЖДЕНИЙ, и каждое закрывает свой риск:
   *
   * - **пароль** — доказывает, что за устройством сейчас владелец,
   *   а не тот, кому оставили разблокированный кошелёк;
   * - **разрешение `ExportGuard`** — доказывает, что пользователю показали
   *   уровень риска, включая случай, когда выдача ключа вместе с ранее
   *   выданным xpub раскрывает весь аккаунт.
   *
   * Возвращённый буфер вызывающий обязан затереть в блоке `finally`.
   *
   * @throws InvalidPasswordError, ExportNotPermittedError, AccountNotFoundError
   */
  exportPrivateKey(id: AccountId, password: string, permit: ExportPermit): Promise<ISecretBuffer>
}

/**
 * Долговременное хранение метаданных аккаунтов.
 *
 * Секретов не содержит: приватные ключи импортированных аккаунтов хранятся
 * отдельно и никогда не попадают в эту структуру.
 */
export interface IAccountRepository {
  findAll(): Promise<readonly IAccount[]>
  save(account: IAccount): Promise<void>
  saveAll(accounts: readonly IAccount[]): Promise<void>
  delete(id: AccountId): Promise<void>

  getActiveId(): Promise<AccountId | null>
  setActiveId(id: AccountId): Promise<void>
}
