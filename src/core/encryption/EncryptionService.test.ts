import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  DecryptionFailedError,
  UnsupportedVaultVersionError,
  VaultCorruptedError,
} from '@/core/errors'
import { FastEncryptionService } from '@/test/doubles'

import { EncryptionService } from './EncryptionService'
import {
  AUTH_TAG_BITS,
  IV_LENGTH,
  KEY_LENGTH,
  PAYLOAD_VERSION,
  PBKDF2_HASH,
  PBKDF2_ITERATIONS,
  SALT_LENGTH,
} from './parameters'
import { decodePayload, encodePayload } from './payload-codec'
import { CIPHER_ALGORITHM, KDF_ALGORITHM, type IEncryptedPayload } from './types'

const PASSWORD = 'правильный-пароль-1234'
const SECRET = utf8ToBytes('приватный ключ пользователя')

let service: FastEncryptionService

beforeAll(() => {
  service = new FastEncryptionService()
})

describe('параметры шифрования', () => {
  it('соответствуют действующим рекомендациям', () => {
    expect(PBKDF2_ITERATIONS).toBe(600_000)
    expect(PBKDF2_HASH).toBe('SHA-256')
    expect(SALT_LENGTH).toBe(32)
    expect(KEY_LENGTH).toBe(32)
    expect(AUTH_TAG_BITS).toBe(128)
  })

  it('использует 96-битный вектор инициализации — размер, для которого определён GCM', () => {
    expect(IV_LENGTH).toBe(12)
  })

  it('боевой сервис создаёт параметры с полным числом итераций', () => {
    const params = new EncryptionService().createKdfParams()

    expect(params.iterations).toBe(PBKDF2_ITERATIONS)
    expect(params.algorithm).toBe(KDF_ALGORITHM.Pbkdf2)
    expect(params.salt).toHaveLength(SALT_LENGTH)
    expect(params.keyLength).toBe(KEY_LENGTH)
  })
})

describe('EncryptionService: цикл шифрования', () => {
  it('расшифровывает то, что зашифровал', async () => {
    const payload = await service.encrypt(SECRET, PASSWORD)
    const decrypted = await service.decrypt(payload, PASSWORD)

    try {
      expect(bytesToHex(decrypted.bytes)).toBe(bytesToHex(SECRET))
    } finally {
      decrypted.wipe()
    }
  })

  it('формирует контейнер с ожидаемой структурой', async () => {
    const payload = await service.encrypt(SECRET, PASSWORD)

    expect(payload.version).toBe(PAYLOAD_VERSION)
    expect(payload.cipher).toBe(CIPHER_ALGORITHM.AesGcm)
    expect(payload.iv).toHaveLength(IV_LENGTH)
    expect(payload.kdf.salt).toHaveLength(SALT_LENGTH)
  })

  it('не оставляет открытый текст в шифротексте', async () => {
    const payload = await service.encrypt(SECRET, PASSWORD)

    expect(bytesToHex(payload.ciphertext)).not.toContain(bytesToHex(SECRET))
  })

  it('шифротекст длиннее открытого текста на размер тега аутентификации', async () => {
    const payload = await service.encrypt(SECRET, PASSWORD)

    expect(payload.ciphertext.length).toBe(SECRET.length + AUTH_TAG_BITS / 8)
  })

  it('шифрует пустые данные', async () => {
    const payload = await service.encrypt(new Uint8Array(0), PASSWORD)
    const decrypted = await service.decrypt(payload, PASSWORD)

    try {
      expect(decrypted.bytes).toHaveLength(0)
    } finally {
      decrypted.wipe()
    }
  })
})

describe('EncryptionService: свежесть соли и вектора инициализации', () => {
  it('генерирует новую соль на каждое шифрование', async () => {
    const first = await service.encrypt(SECRET, PASSWORD)
    const second = await service.encrypt(SECRET, PASSWORD)

    expect(bytesToHex(first.kdf.salt)).not.toBe(bytesToHex(second.kdf.salt))
  })

  it('генерирует новый вектор инициализации на каждое шифрование', async () => {
    const first = await service.encrypt(SECRET, PASSWORD)
    const second = await service.encrypt(SECRET, PASSWORD)

    expect(bytesToHex(first.iv)).not.toBe(bytesToHex(second.iv))
  })

  it('даёт разный шифротекст для одних и тех же данных и пароля', async () => {
    /* Совпадение шифротекстов означало бы детерминированное шифрование:
       наблюдатель видел бы, что содержимое хранилища не изменилось. */
    const first = await service.encrypt(SECRET, PASSWORD)
    const second = await service.encrypt(SECRET, PASSWORD)

    expect(bytesToHex(first.ciphertext)).not.toBe(bytesToHex(second.ciphertext))
  })

  it('меняет вектор инициализации и при работе сессионным ключом', async () => {
    const params = service.createKdfParams()
    const key = await service.deriveKey(PASSWORD, params)

    try {
      const first = await service.encryptWithKey(SECRET, key, params)
      const second = await service.encryptWithKey(SECRET, key, params)

      expect(bytesToHex(first.iv)).not.toBe(bytesToHex(second.iv))
    } finally {
      key.destroy()
    }
  })
})

describe('EncryptionService: обнаружение подмены', () => {
  let payload: IEncryptedPayload

  beforeAll(async () => {
    payload = await service.encrypt(SECRET, PASSWORD)
  })

  it('отвергает неверный пароль', async () => {
    await expect(service.decrypt(payload, 'неверный-пароль')).rejects.toThrow(DecryptionFailedError)
  })

  it('отвергает изменённый шифротекст', async () => {
    const tampered = { ...payload, ciphertext: Uint8Array.from(payload.ciphertext) }
    tampered.ciphertext.set([(tampered.ciphertext[0] as number) ^ 0xff], 0)

    await expect(service.decrypt(tampered, PASSWORD)).rejects.toThrow(DecryptionFailedError)
  })

  it('отвергает изменённый вектор инициализации', async () => {
    const tampered = { ...payload, iv: Uint8Array.from(payload.iv) }
    tampered.iv.set([(tampered.iv[0] as number) ^ 0xff], 0)

    await expect(service.decrypt(tampered, PASSWORD)).rejects.toThrow(DecryptionFailedError)
  })

  it('отвергает подмену числа итераций в заголовке', async () => {
    /* Заголовок входит в аутентифицируемые данные AES-GCM, поэтому
       его изменение обнаруживается тегом, а не только несовпадением
       выведенного ключа. */
    const tampered: IEncryptedPayload = {
      ...payload,
      kdf: { ...payload.kdf, iterations: 1 },
    }

    await expect(service.decrypt(tampered, PASSWORD)).rejects.toThrow(DecryptionFailedError)
  })

  it('отвергает подмену соли в заголовке', async () => {
    const tampered: IEncryptedPayload = {
      ...payload,
      kdf: { ...payload.kdf, salt: new Uint8Array(SALT_LENGTH).fill(7) },
    }

    await expect(service.decrypt(tampered, PASSWORD)).rejects.toThrow(DecryptionFailedError)
  })

  it('отвергает подмену версии формата на равную поддерживаемой', async () => {
    const params = service.createKdfParams()
    const key = await service.deriveKey(PASSWORD, params)

    try {
      const original = await service.encryptWithKey(SECRET, key, params)
      const tampered: IEncryptedPayload = { ...original, version: PAYLOAD_VERSION }

      /* Версия совпадает, но проверяется весь заголовок целиком:
         подмена любого поля ломает тег аутентификации. */
      const decrypted = await service.decryptWithKey(tampered, key)
      decrypted.wipe()

      const withOtherKdf: IEncryptedPayload = {
        ...original,
        kdf: { ...original.kdf, keyLength: 16 },
      }

      await expect(service.decryptWithKey(withOtherKdf, key)).rejects.toThrow(DecryptionFailedError)
    } finally {
      key.destroy()
    }
  })

  it('отказывается читать контейнер новее поддерживаемого формата', async () => {
    const future: IEncryptedPayload = { ...payload, version: PAYLOAD_VERSION + 1 }

    await expect(service.decrypt(future, PASSWORD)).rejects.toThrow(UnsupportedVaultVersionError)
  })
})

describe('EncryptionService: проверка пароля', () => {
  it('подтверждает верный пароль', async () => {
    const payload = await service.encrypt(SECRET, PASSWORD)

    await expect(service.verifyPassword(payload, PASSWORD)).resolves.toBe(true)
  })

  it('отклоняет неверный пароль', async () => {
    const payload = await service.encrypt(SECRET, PASSWORD)

    await expect(service.verifyPassword(payload, 'другой')).resolves.toBe(false)
  })

  it('различает пароли, отличающиеся одним символом', async () => {
    const payload = await service.encrypt(SECRET, PASSWORD)

    await expect(service.verifyPassword(payload, `${PASSWORD}5`)).resolves.toBe(false)
  })
})

describe('EncryptionService: устаревание параметров', () => {
  it('признаёт устаревшим контейнер с меньшим числом итераций', async () => {
    const payload = await service.encrypt(SECRET, PASSWORD)

    expect(service.needsUpgrade(payload)).toBe(true)
  })

  it('не признаёт устаревшим контейнер с актуальными параметрами', () => {
    const production = new EncryptionService()
    const payload: IEncryptedPayload = {
      version: PAYLOAD_VERSION,
      cipher: CIPHER_ALGORITHM.AesGcm,
      kdf: production.createKdfParams(),
      iv: new Uint8Array(IV_LENGTH),
      ciphertext: new Uint8Array(16),
    }

    expect(production.needsUpgrade(payload)).toBe(false)
  })
})

describe('сериализация контейнера', () => {
  it('обратима', async () => {
    const payload = await service.encrypt(SECRET, PASSWORD)
    const restored = decodePayload(encodePayload(payload))

    expect(bytesToHex(restored.ciphertext)).toBe(bytesToHex(payload.ciphertext))
    expect(bytesToHex(restored.iv)).toBe(bytesToHex(payload.iv))
    expect(bytesToHex(restored.kdf.salt)).toBe(bytesToHex(payload.kdf.salt))
    expect(restored.kdf.iterations).toBe(payload.kdf.iterations)
  })

  it('переживает передачу через JSON', async () => {
    const payload = await service.encrypt(SECRET, PASSWORD)
    const restored = decodePayload(JSON.parse(JSON.stringify(encodePayload(payload))))
    const decrypted = await service.decrypt(restored, PASSWORD)

    try {
      expect(bytesToHex(decrypted.bytes)).toBe(bytesToHex(SECRET))
    } finally {
      decrypted.wipe()
    }
  })

  it('отвергает контейнер без версии', () => {
    expect(() => decodePayload({ cipher: 'AES-GCM' })).toThrow(VaultCorruptedError)
  })

  it('отвергает неизвестный алгоритм шифрования', () => {
    expect(() => decodePayload({ version: 1, cipher: 'DES' })).toThrow(VaultCorruptedError)
  })

  it('отвергает неизвестный алгоритм вывода ключа', async () => {
    const record = encodePayload(await service.encrypt(SECRET, PASSWORD))

    expect(() => decodePayload({ ...record, kdf: { ...record.kdf, algorithm: 'MD5' } })).toThrow(
      VaultCorruptedError,
    )
  })

  it('отвергает нулевое число итераций', async () => {
    const record = encodePayload(await service.encrypt(SECRET, PASSWORD))

    expect(() => decodePayload({ ...record, kdf: { ...record.kdf, iterations: 0 } })).toThrow(
      VaultCorruptedError,
    )
  })

  it('отвергает недопустимые символы в шестнадцатеричном поле', async () => {
    const record = encodePayload(await service.encrypt(SECRET, PASSWORD))

    expect(() => decodePayload({ ...record, iv: 'zzzz' })).toThrow(VaultCorruptedError)
  })

  it('отвергает не-объект', () => {
    expect(() => decodePayload(null)).toThrow(VaultCorruptedError)
    expect(() => decodePayload('строка')).toThrow(VaultCorruptedError)
  })
})

describe('EncryptionService: сессионный ключ', () => {
  it('не позволяет выгрузить материал ключа', async () => {
    const key = await service.deriveKey(PASSWORD, service.createKdfParams())

    try {
      expect(key.unwrap().extractable).toBe(false)
    } finally {
      key.destroy()
    }
  })

  it('не раскрывает ключ при сериализации состояния', async () => {
    const key = await service.deriveKey(PASSWORD, service.createKdfParams())

    try {
      expect(JSON.stringify({ key })).toBe('{"key":"[EncryptionKey]"}')
      expect(String(key)).toBe('[EncryptionKey]')
    } finally {
      key.destroy()
    }
  })

  it('отвергает использование после уничтожения', async () => {
    const params = service.createKdfParams()
    const key = await service.deriveKey(PASSWORD, params)
    key.destroy()

    expect(key.isDestroyed).toBe(true)
    await expect(service.encryptWithKey(SECRET, key, params)).rejects.toThrow()
  })

  it('допускает повторное уничтожение', async () => {
    const key = await service.deriveKey(PASSWORD, service.createKdfParams())
    key.destroy()

    expect(() => {
      key.destroy()
    }).not.toThrow()
  })

  it('ключи от разных паролей несовместимы', async () => {
    const params = service.createKdfParams()
    const first = await service.deriveKey(PASSWORD, params)
    const second = await service.deriveKey('другой пароль', params)

    try {
      const payload = await service.encryptWithKey(SECRET, first, params)

      await expect(service.decryptWithKey(payload, second)).rejects.toThrow(DecryptionFailedError)
    } finally {
      first.destroy()
      second.destroy()
    }
  })

  it('ключи от одной соли и пароля совпадают', async () => {
    const params = service.createKdfParams()
    const first = await service.deriveKey(PASSWORD, params)
    const second = await service.deriveKey(PASSWORD, params)

    try {
      const payload = await service.encryptWithKey(SECRET, first, params)
      const decrypted = await service.decryptWithKey(payload, second)

      try {
        expect(bytesToHex(decrypted.bytes)).toBe(bytesToHex(SECRET))
      } finally {
        decrypted.wipe()
      }
    } finally {
      first.destroy()
      second.destroy()
    }
  })
})
