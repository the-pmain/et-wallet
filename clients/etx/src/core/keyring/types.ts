import type { ISecretBuffer } from '@/core/encryption'
import type { Address, DerivationPath, KeyringId } from '@/core/types'

/**
 * Тип набора ключей.
 *
 * Это не декоративная метка, а определяющая характеристика: способ подписи
 * принципиально разный, и без явного различения аппаратные кошельки
 * встроить невозможно.
 *
 * | Тип          | Где ключ                 | Как подписывает                    |
 * |--------------|--------------------------|------------------------------------|
 * | Hd           | в памяти, разблокирован  | локально                           |
 * | PrivateKey   | в памяти, разблокирован  | локально                           |
 * | Ledger/Trezor| никогда не покидает      | по USB/HID, подтверждение на экране|
 * | WatchOnly    | отсутствует              | не может подписывать вообще        |
 */
export const KEYRING_TYPE = {
  /** HD-дерево, выведенное из мнемонической фразы (BIP-39 + BIP-32). */
  Hd: 'hd',
  /** Единичный импортированный приватный ключ. */
  PrivateKey: 'private-key',
  /** Аппаратный кошелёк Ledger. */
  Ledger: 'ledger',
  /** Аппаратный кошелёк Trezor. */
  Trezor: 'trezor',
  /** Наблюдение за чужим адресом. Подпись невозможна. */
  WatchOnly: 'watch-only',
} as const

export type KeyringType = (typeof KEYRING_TYPE)[keyof typeof KEYRING_TYPE]

/**
 * Возможности набора ключей.
 *
 * Проверяются ДО показа пользователю формы подписи. Иначе интерфейс
 * предложит подписать сообщение аккаунтом, который физически на это
 * не способен, и ошибка всплывёт после заполнения формы.
 */
export interface IKeyringCapabilities {
  readonly canSignTransaction: boolean
  readonly canSignMessage: boolean
  readonly canSignTypedData: boolean

  /**
   * Возможен ли экспорт приватного ключа.
   *
   * Для аппаратных кошельков всегда `false`: ключ физически не покидает
   * устройство. Это не ограничение реализации, а свойство устройства.
   */
  readonly canExportPrivateKey: boolean

  /** Возможно ли добавление новых аккаунтов выводом из того же корня. */
  readonly canDeriveAccounts: boolean

  /** Требуется ли физическое подтверждение операции на устройстве. */
  readonly requiresPhysicalConfirmation: boolean
}

/** Сериализованное состояние набора ключей внутри зашифрованного хранилища. */
export interface ISerializedKeyring {
  readonly id: KeyringId
  readonly type: KeyringType

  /**
   * Данные, специфичные для типа.
   *
   * Для HD — мнемоника и число выведенных аккаунтов. Для аппаратного —
   * только пути деривации и адреса, без какого-либо секрета.
   */
  readonly data: Readonly<Record<string, unknown>>
}

/** Параметры создания HD-набора. */
export interface IHdKeyringOptions {
  /** Мнемоническая фраза. Передаётся буфером, а не строкой. */
  readonly mnemonic: ISecretBuffer
  /** Базовый путь деривации. По умолчанию `m/44'/60'/0'/0`. */
  readonly basePath?: DerivationPath
  /** Сколько аккаунтов вывести сразу. */
  readonly accountCount?: number
}

/** Параметры импорта одиночного ключа. */
export interface IPrivateKeyKeyringOptions {
  readonly privateKey: ISecretBuffer
}

/** Параметры подключения аппаратного кошелька. */
export interface IHardwareKeyringOptions {
  readonly type: typeof KEYRING_TYPE.Ledger | typeof KEYRING_TYPE.Trezor
  readonly basePath: DerivationPath
  /** Адреса, выбранные пользователем из списка на устройстве. */
  readonly addresses: readonly Address[]
}

/** Параметры добавления наблюдаемого адреса. */
export interface IWatchOnlyKeyringOptions {
  readonly address: Address
}

/**
 * Размеченное объединение параметров создания набора ключей.
 *
 * Объединение вместо набора необязательных полей: оно не позволяет передать
 * мнемонику вместе с параметрами Ledger и делает невалидные комбинации
 * невыразимыми в типах.
 */
export type KeyringCreationOptions =
  | ({ readonly type: typeof KEYRING_TYPE.Hd } & IHdKeyringOptions)
  | ({ readonly type: typeof KEYRING_TYPE.PrivateKey } & IPrivateKeyKeyringOptions)
  | IHardwareKeyringOptions
  | ({ readonly type: typeof KEYRING_TYPE.WatchOnly } & IWatchOnlyKeyringOptions)
