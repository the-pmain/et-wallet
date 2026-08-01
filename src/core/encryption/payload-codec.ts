import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import { InvalidArgumentError, VaultCorruptedError } from '@/core/errors'

import { CIPHER_ALGORITHM, KDF_ALGORITHM, type IEncryptedPayload, type IKdfParams } from './types'

/**
 * Портируемое представление зашифрованного контейнера.
 *
 * Двоичные поля записаны шестнадцатеричными строками. Причина — та же,
 * что у представления сетей в этапе 3: требовать поддержки `Uint8Array`
 * от каждого бэкенда хранилища значит ограничить выбор. `chrome.storage`
 * сериализует через JSON, где типизированные массивы превращаются
 * в объекты с числовыми ключами и молча портятся.
 *
 * Шестнадцатеричная запись удваивает объём. Для хранилища ключей размером
 * в единицы килобайт это несущественно, а корректность важнее.
 */
export interface IEncryptedPayloadRecord {
  readonly version: number
  readonly cipher: string
  readonly kdf: {
    readonly algorithm: string
    readonly iterations: number
    readonly salt: string
    readonly keyLength: number
    readonly memoryKib?: number
    readonly parallelism?: number
  }
  readonly iv: string
  readonly ciphertext: string
}

/** Переводит контейнер в портируемый вид. */
export function encodePayload(payload: IEncryptedPayload): IEncryptedPayloadRecord {
  return {
    version: payload.version,
    cipher: payload.cipher,
    kdf: {
      algorithm: payload.kdf.algorithm,
      iterations: payload.kdf.iterations,
      salt: bytesToHex(payload.kdf.salt),
      keyLength: payload.kdf.keyLength,
      ...(payload.kdf.memoryKib === undefined ? {} : { memoryKib: payload.kdf.memoryKib }),
      ...(payload.kdf.parallelism === undefined ? {} : { parallelism: payload.kdf.parallelism }),
    },
    iv: bytesToHex(payload.iv),
    ciphertext: bytesToHex(payload.ciphertext),
  }
}

/**
 * Восстанавливает контейнер из портируемого вида.
 *
 * Данные из хранилища НЕДОВЕРЕННЫЕ: они могли быть записаны другой версией
 * приложения, повреждены сбоем записи либо изменены посторонним кодом.
 * Поэтому проверяется структура целиком, а не только наличие полей.
 *
 * Подмена самих параметров при этом обнаруживается не здесь, а при
 * расшифровке: заголовок входит в аутентифицируемые данные AES-GCM.
 *
 * @throws VaultCorruptedError при нарушении структуры.
 */
export function decodePayload(record: unknown): IEncryptedPayload {
  if (typeof record !== 'object' || record === null) {
    throw new VaultCorruptedError('контейнер не является объектом')
  }

  const candidate = record as Partial<IEncryptedPayloadRecord>

  if (typeof candidate.version !== 'number') {
    throw new VaultCorruptedError('отсутствует версия формата')
  }

  if (candidate.cipher !== CIPHER_ALGORITHM.AesGcm) {
    throw new VaultCorruptedError(`неизвестный алгоритм шифрования "${String(candidate.cipher)}"`)
  }

  if (typeof candidate.iv !== 'string' || typeof candidate.ciphertext !== 'string') {
    throw new VaultCorruptedError('отсутствует вектор инициализации либо шифротекст')
  }

  return {
    version: candidate.version,
    cipher: CIPHER_ALGORITHM.AesGcm,
    kdf: decodeKdfParams(candidate.kdf),
    iv: safeHexToBytes(candidate.iv, 'iv'),
    ciphertext: safeHexToBytes(candidate.ciphertext, 'ciphertext'),
  }
}

function decodeKdfParams(kdf: IEncryptedPayloadRecord['kdf'] | undefined): IKdfParams {
  if (typeof kdf !== 'object') {
    throw new VaultCorruptedError('отсутствуют параметры вывода ключа')
  }

  if (kdf.algorithm !== KDF_ALGORITHM.Pbkdf2 && kdf.algorithm !== KDF_ALGORITHM.Argon2id) {
    throw new VaultCorruptedError(`неизвестный алгоритм вывода ключа "${String(kdf.algorithm)}"`)
  }

  if (!Number.isSafeInteger(kdf.iterations) || kdf.iterations <= 0) {
    throw new VaultCorruptedError('некорректное число итераций')
  }

  if (!Number.isSafeInteger(kdf.keyLength) || kdf.keyLength <= 0) {
    throw new VaultCorruptedError('некорректная длина ключа')
  }

  return {
    algorithm: kdf.algorithm,
    iterations: kdf.iterations,
    salt: safeHexToBytes(kdf.salt, 'salt'),
    keyLength: kdf.keyLength,
    ...(kdf.memoryKib === undefined ? {} : { memoryKib: kdf.memoryKib }),
    ...(kdf.parallelism === undefined ? {} : { parallelism: kdf.parallelism }),
  }
}

function safeHexToBytes(value: unknown, field: string): Uint8Array {
  if (typeof value !== 'string' || value.length === 0 || value.length % 2 !== 0) {
    throw new VaultCorruptedError(`поле "${field}" не является шестнадцатеричной строкой`)
  }

  try {
    return hexToBytes(value)
  } catch (error) {
    throw new VaultCorruptedError(`поле "${field}" содержит недопустимые символы`, { cause: error })
  }
}

/**
 * Формирует дополнительные аутентифицируемые данные (AAD) для AES-GCM.
 *
 * ЗАЧЕМ ЭТО НУЖНО. Заголовок контейнера — версия формата, алгоритм шифра
 * и параметры KDF — хранится рядом с шифротекстом в открытом виде.
 * Включение его в AAD означает, что тег аутентификации покрывает и заголовок:
 * любое изменение параметров делает расшифровку невозможной.
 *
 * Без этого заголовок остаётся неподписанным. Прямой выгоды атакующему
 * это сейчас не даёт (изменённые параметры дадут другой ключ, и расшифровка
 * провалится), но с появлением второго алгоритма KDF открывается атака
 * понижения: подмена `algorithm` на более слабый вариант. AAD закрывает
 * весь этот класс заранее и стоит нескольких строк.
 *
 * Строка собирается вручную, а не через `JSON.stringify`: порядок ключей
 * при сериализации объекта не гарантирован спецификацией, а AAD обязан
 * побайтово совпадать при шифровании и расшифровке.
 */
export function buildAdditionalData(
  payload: Omit<IEncryptedPayload, 'ciphertext' | 'iv'>,
): Uint8Array {
  const parts = [
    `v=${String(payload.version)}`,
    `cipher=${payload.cipher}`,
    `kdf=${payload.kdf.algorithm}`,
    `iterations=${String(payload.kdf.iterations)}`,
    `keyLength=${String(payload.kdf.keyLength)}`,
    `salt=${bytesToHex(payload.kdf.salt)}`,
  ]

  return utf8ToBytes(parts.join('|'))
}

/** Проверяет, что число байт положительно. Защита от вырожденных вызовов. */
export function assertPositiveLength(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new InvalidArgumentError(name, 'ожидается положительное целое число')
  }
}
