import type { ISecretBuffer } from '@/core/encryption'
import type { ISignableTransaction, ITypedData } from '@/core/transaction'
import type { Address, DerivationPath, HexString, KeyringId } from '@/core/types'

import type {
  IKeyringCapabilities,
  ISerializedKeyring,
  KeyringCreationOptions,
  KeyringType,
} from './types'

/**
 * Набор ключей: единственный владелец секретов в приложении.
 *
 * Это центральная абстракция безопасности. Границы, обязательные для любой
 * реализации:
 *
 * 1. **Секрет наружу не выходит.** Публичные методы отдают адреса и готовые
 *    подписи. Единственное исключение — `exportPrivateKey`, который требует
 *    отдельного подтверждения паролем на уровне выше и возвращает буфер,
 *    подлежащий немедленному затиранию.
 *
 * 2. **Секрет не попадает в состояние UI.** Стор Zustand — обычный объект
 *    в куче вкладки: он виден в React DevTools, доступен любому скрипту
 *    на странице и сериализуется при отладочном дампе состояния.
 *
 * 3. **Секрет хранится в `Uint8Array`, а не в `string`.** Строки в JavaScript
 *    иммутабельны и интернируются — затереть их невозможно.
 *
 * 4. **`wipe()` обязан обнулять буферы**, а не просто терять ссылки на них.
 *    Потеря ссылки оставляет данные в куче до сборки мусора, момент которой
 *    не контролируется.
 *
 * Абстракция единообразно покрывает и программные ключи, и аппаратные
 * устройства. Именно поэтому все методы подписи асинхронны: подпись
 * на Ledger требует физического подтверждения и занимает секунды.
 */
export interface IKeyring {
  readonly id: KeyringId
  readonly type: KeyringType

  /** Что этот набор умеет. Проверяется до показа формы подписи. */
  readonly capabilities: IKeyringCapabilities

  /** Адреса, обслуживаемые набором. */
  getAddresses(): Promise<readonly Address[]>

  /**
   * Выводит очередной аккаунт из того же корня.
   *
   * @throws KeyringCannotSignError если тип набора не поддерживает деривацию.
   */
  deriveAccount(): Promise<Address>

  /** Путь деривации адреса. `null` для наборов без HD-структуры. */
  getDerivationPath(address: Address): DerivationPath | null

  /**
   * Подписывает транзакцию.
   *
   * На подпись уходит уже подготовленная и проверенная структура. Набор
   * ключей не изменяет её и не досчитывает поля: любая правка здесь означала
   * бы расхождение между показанным пользователю и подписанным.
   *
   * @throws KeyringCannotSignError, UserRejectedError
   */
  signTransaction(address: Address, transaction: ISignableTransaction): Promise<HexString>

  /**
   * Подписывает произвольное сообщение (`personal_sign`).
   *
   * Реализация обязана применять префикс EIP-191. Без него подписанные
   * байты могут оказаться корректной транзакцией, и подпись «безобидного»
   * сообщения превратится в подпись перевода средств.
   */
  signMessage(address: Address, message: Uint8Array): Promise<HexString>

  /**
   * Подписывает структурированные данные (EIP-712).
   *
   * Опаснее подписи транзакции: подписанное сообщение может быть предъявлено
   * контракту позже. Вызывающий код обязан показать разобранную структуру
   * и сверить `domain.chainId` с активной сетью.
   */
  signTypedData(address: Address, typedData: ITypedData): Promise<HexString>

  /**
   * Выгружает приватный ключ.
   *
   * Требует подтверждения паролем на уровне выше. Возвращённый буфер
   * вызывающий обязан затереть в блоке `finally`.
   *
   * @throws ExportNotPermittedError для аппаратных и наблюдаемых наборов.
   */
  exportPrivateKey(address: Address): Promise<ISecretBuffer>

  /** Готовит состояние набора к шифрованию и сохранению. */
  serialize(): Promise<ISerializedKeyring>

  /** Обнуляет все буферы секретов. Вызывается при блокировке кошелька. */
  wipe(): void
}

/**
 * Создание наборов ключей.
 *
 * Внедряется как зависимость. Это точка расширения: поддержка Ledger
 * и Trezor добавляется реализацией фабрики, без изменения `IWallet`
 * и всего, что от него зависит.
 */
export interface IKeyringFactory {
  /** Создаёт новый набор из параметров. */
  create(options: KeyringCreationOptions): Promise<IKeyring>

  /** Восстанавливает набор из расшифрованного состояния. */
  deserialize(serialized: ISerializedKeyring): Promise<IKeyring>

  /** Поддерживается ли тип в текущей сборке. */
  supports(type: KeyringType): boolean
}
