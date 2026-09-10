import {
  DecryptionFailedError,
  InvalidArgumentError,
  RandomnessUnavailableError,
  UnsupportedVaultVersionError,
} from '@/core/errors'

import type { IEncryptionService } from './contracts'
import { EncryptionKey } from './EncryptionKey'
import {
  AES_GCM,
  AUTH_TAG_BITS,
  IV_LENGTH,
  PAYLOAD_VERSION,
  PBKDF2,
  PBKDF2_HASH,
  PBKDF2_ITERATIONS,
  SALT_LENGTH,
  createDefaultKdfParams,
} from './parameters'
import { buildAdditionalData } from './payload-codec'
import { getRandomBytes, wipeBytes } from './random'
import { SecretBuffer } from './SecretBuffer'
import {
  CIPHER_ALGORITHM,
  KDF_ALGORITHM,
  type IEncryptedPayload,
  type IKdfParams,
  type ISecretBuffer,
} from './types'

/**
 * Шифрование поверх Web Crypto API.
 *
 * ЧТО ЗДЕСЬ НЕ РЕАЛИЗОВАНО САМОСТОЯТЕЛЬНО И НЕ БУДЕТ: ни AES, ни GCM,
 * ни PBKDF2, ни генератор случайных чисел. Всё это выполняет браузер
 * нативным кодом. Собственная реализация любого из этих примитивов
 * заведомо хуже: она медленнее, уязвима к атакам по времени и не проходила
 * стороннего аудита.
 *
 * ПОЧЕМУ ПАРОЛЬ — СТРОКА. Он приходит из поля ввода, а значение поля
 * ввода в браузере это строка. Перевести её в буфер можно, но исходная
 * строка останется в куче неочищаемой — как и внутри самого поля ввода,
 * и в истории событий DOM. Притворяться, что пароль защищён от дампа
 * памяти, было бы обманом; реальная защита здесь — стойкость KDF
 * и короткое время жизни разблокированной сессии.
 */
export class EncryptionService implements IEncryptionService {
  async encrypt(plaintext: Uint8Array, password: string): Promise<IEncryptedPayload> {
    const params = this.createKdfParams()
    const key = await this.deriveKey(password, params)

    try {
      return await this.encryptWithKey(plaintext, key, params)
    } finally {
      key.destroy()
    }
  }

  async decrypt(payload: IEncryptedPayload, password: string): Promise<ISecretBuffer> {
    EncryptionService.#assertSupportedVersion(payload)

    const key = await this.deriveKey(password, payload.kdf)

    try {
      return await this.decryptWithKey(payload, key)
    } finally {
      key.destroy()
    }
  }

  async verifyPassword(payload: IEncryptedPayload, password: string): Promise<boolean> {
    try {
      const decrypted = await this.decrypt(payload, password)
      decrypted.wipe()

      return true
    } catch {
      /* Отличие «неверный пароль» от «данные повреждены» не возвращается
         сознательно: для подбирающего пароль это лишний сигнал, а для
         вызывающего кода разница здесь не имеет значения. */
      return false
    }
  }

  async deriveKey(password: string, params: IKdfParams): Promise<EncryptionKey> {
    if (params.algorithm !== KDF_ALGORITHM.Pbkdf2) {
      throw new InvalidArgumentError(
        'kdf.algorithm',
        `the algorithm "${params.algorithm}" is not supported by this build`,
      )
    }

    const subtle = EncryptionService.#requireSubtle()
    const passwordBytes = new TextEncoder().encode(password)

    try {
      /* Пароль импортируется как неизвлекаемый материал ключа: даже
         промежуточное представление не должно быть выгружаемым. */
      const baseKey = await subtle.importKey(
        'raw',
        EncryptionService.#toArrayBuffer(passwordBytes),
        PBKDF2,
        false,
        ['deriveKey'],
      )

      const derived = await subtle.deriveKey(
        {
          name: PBKDF2,
          salt: EncryptionService.#toArrayBuffer(params.salt),
          iterations: params.iterations,
          hash: PBKDF2_HASH,
        },
        baseKey,
        { name: AES_GCM, length: params.keyLength * 8 },
        /* extractable: false — выгрузить байты ключа из JavaScript
           невозможно ни отладчиком, ни сериализацией состояния. */
        false,
        ['encrypt', 'decrypt'],
      )

      return EncryptionKey.wrap(derived)
    } finally {
      wipeBytes(passwordBytes)
    }
  }

  async encryptWithKey(
    plaintext: Uint8Array,
    key: EncryptionKey,
    params: IKdfParams,
  ): Promise<IEncryptedPayload> {
    const subtle = EncryptionService.#requireSubtle()

    /* Свежий IV на каждую операцию без исключений. Повтор пары
       «ключ + IV» в AES-GCM раскрывает и содержимое, и ключ
       аутентификации — это не деградация стойкости, а её потеря. */
    const iv = getRandomBytes(IV_LENGTH)

    const header = {
      version: PAYLOAD_VERSION,
      cipher: CIPHER_ALGORITHM.AesGcm,
      kdf: params,
    } as const

    const ciphertext = await subtle.encrypt(
      {
        name: AES_GCM,
        iv: EncryptionService.#toArrayBuffer(iv),
        additionalData: EncryptionService.#toArrayBuffer(buildAdditionalData(header)),
        tagLength: AUTH_TAG_BITS,
      },
      key.unwrap(),
      EncryptionService.#toArrayBuffer(plaintext),
    )

    return {
      ...header,
      iv,
      ciphertext: new Uint8Array(ciphertext),
    }
  }

  async decryptWithKey(payload: IEncryptedPayload, key: EncryptionKey): Promise<ISecretBuffer> {
    EncryptionService.#assertSupportedVersion(payload)

    const subtle = EncryptionService.#requireSubtle()

    try {
      const plaintext = await subtle.decrypt(
        {
          name: AES_GCM,
          iv: EncryptionService.#toArrayBuffer(payload.iv),
          additionalData: EncryptionService.#toArrayBuffer(buildAdditionalData(payload)),
          tagLength: AUTH_TAG_BITS,
        },
        key.unwrap(),
        EncryptionService.#toArrayBuffer(payload.ciphertext),
      )

      return SecretBuffer.own(new Uint8Array(plaintext))
    } catch (error) {
      /* Web Crypto выбрасывает одинаковую ошибку и при неверном ключе,
         и при повреждённых данных, и при изменённом заголовке: тег
         аутентификации не сходится во всех трёх случаях. Различить их
         невозможно, и это правильно. */
      throw new DecryptionFailedError({ cause: error })
    }
  }

  createKdfParams(): IKdfParams {
    return createDefaultKdfParams(getRandomBytes(SALT_LENGTH))
  }

  needsUpgrade(payload: IEncryptedPayload): boolean {
    return (
      payload.version < PAYLOAD_VERSION ||
      payload.kdf.algorithm !== KDF_ALGORITHM.Pbkdf2 ||
      payload.kdf.iterations < PBKDF2_ITERATIONS
    )
  }

  /**
   * Отвергает контейнер, созданный более новой версией приложения.
   *
   * Попытка прочитать неизвестный формат «как получится» с последующей
   * перезаписью означает безвозвратную потерю ключей. Отказ в работе —
   * единственное безопасное поведение.
   */
  static #assertSupportedVersion(payload: IEncryptedPayload): void {
    if (payload.version > PAYLOAD_VERSION) {
      throw new UnsupportedVaultVersionError(payload.version, PAYLOAD_VERSION)
    }
  }

  static #requireSubtle(): SubtleCrypto {
    const subtle = globalThis.crypto.subtle as SubtleCrypto | undefined

    if (subtle === undefined) {
      /* Web Crypto недоступен в незащищённом контексте (обычный http).
         Работать в таком режиме кошелёк не должен вовсе: без него
         невозможны ни шифрование, ни криптостойкая случайность. */
      throw new RandomnessUnavailableError(
        'crypto.subtle is unavailable — a secure context is required (https or localhost)',
      )
    }

    return subtle
  }

  /**
   * Приводит представление к `ArrayBuffer`.
   *
   * Требуется потому, что `Uint8Array` может быть окном в больший буфер:
   * передача такого массива напрямую скормила бы Web Crypto лишние байты
   * либо, в другой реализации, вовсе не то содержимое. Явный срез
   * исключает этот класс ошибок.
   */
  static #toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  }
}
