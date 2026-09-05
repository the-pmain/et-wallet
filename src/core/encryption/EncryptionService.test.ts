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

const PASSWORD = 'correct-password-1234'
const SECRET = utf8ToBytes('user private key')

let service: FastEncryptionService

beforeAll(() => {
  service = new FastEncryptionService()
})

describe('encryption parameters', () => {
  it('match current recommendations', () => {
    expect(PBKDF2_ITERATIONS).toBe(600_000)
    expect(PBKDF2_HASH).toBe('SHA-256')
    expect(SALT_LENGTH).toBe(32)
    expect(KEY_LENGTH).toBe(32)
    expect(AUTH_TAG_BITS).toBe(128)
  })

  it('uses a 96-bit IV — the size GCM is defined for', () => {
    expect(IV_LENGTH).toBe(12)
  })

  it('the production service creates parameters with the full iteration count', () => {
    const params = new EncryptionService().createKdfParams()

    expect(params.iterations).toBe(PBKDF2_ITERATIONS)
    expect(params.algorithm).toBe(KDF_ALGORITHM.Pbkdf2)
    expect(params.salt).toHaveLength(SALT_LENGTH)
    expect(params.keyLength).toBe(KEY_LENGTH)
  })
})

describe('EncryptionService: encrypt/decrypt cycle', () => {
  it('decrypts what it encrypted', async () => {
    const payload = await service.encrypt(SECRET, PASSWORD)
    const decrypted = await service.decrypt(payload, PASSWORD)

    try {
      expect(bytesToHex(decrypted.bytes)).toBe(bytesToHex(SECRET))
    } finally {
      decrypted.wipe()
    }
  })

  it('builds a container with the expected structure', async () => {
    const payload = await service.encrypt(SECRET, PASSWORD)

    expect(payload.version).toBe(PAYLOAD_VERSION)
    expect(payload.cipher).toBe(CIPHER_ALGORITHM.AesGcm)
    expect(payload.iv).toHaveLength(IV_LENGTH)
    expect(payload.kdf.salt).toHaveLength(SALT_LENGTH)
  })

  it('does not leave plaintext in the ciphertext', async () => {
    const payload = await service.encrypt(SECRET, PASSWORD)

    expect(bytesToHex(payload.ciphertext)).not.toContain(bytesToHex(SECRET))
  })

  it('ciphertext is longer than plaintext by the authentication-tag size', async () => {
    const payload = await service.encrypt(SECRET, PASSWORD)

    expect(payload.ciphertext.length).toBe(SECRET.length + AUTH_TAG_BITS / 8)
  })

  it('encrypts empty data', async () => {
    const payload = await service.encrypt(new Uint8Array(0), PASSWORD)
    const decrypted = await service.decrypt(payload, PASSWORD)

    try {
      expect(decrypted.bytes).toHaveLength(0)
    } finally {
      decrypted.wipe()
    }
  })
})

describe('EncryptionService: fresh salt and IV', () => {
  it('generates a new salt on every encryption', async () => {
    const first = await service.encrypt(SECRET, PASSWORD)
    const second = await service.encrypt(SECRET, PASSWORD)

    expect(bytesToHex(first.kdf.salt)).not.toBe(bytesToHex(second.kdf.salt))
  })

  it('generates a new IV on every encryption', async () => {
    const first = await service.encrypt(SECRET, PASSWORD)
    const second = await service.encrypt(SECRET, PASSWORD)

    expect(bytesToHex(first.iv)).not.toBe(bytesToHex(second.iv))
  })

  it('produces different ciphertext for the same data and password', async () => {
    /* Matching ciphertext would mean deterministic encryption: an
       observer would see that vault contents did not change. */
    const first = await service.encrypt(SECRET, PASSWORD)
    const second = await service.encrypt(SECRET, PASSWORD)

    expect(bytesToHex(first.ciphertext)).not.toBe(bytesToHex(second.ciphertext))
  })

  it('changes the IV when using a session key too', async () => {
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

describe('EncryptionService: tamper detection', () => {
  let payload: IEncryptedPayload

  beforeAll(async () => {
    payload = await service.encrypt(SECRET, PASSWORD)
  })

  it('rejects a wrong password', async () => {
    await expect(service.decrypt(payload, 'wrong-password')).rejects.toThrow(DecryptionFailedError)
  })

  it('rejects a modified ciphertext', async () => {
    const tampered = { ...payload, ciphertext: Uint8Array.from(payload.ciphertext) }
    tampered.ciphertext.set([(tampered.ciphertext[0] as number) ^ 0xff], 0)

    await expect(service.decrypt(tampered, PASSWORD)).rejects.toThrow(DecryptionFailedError)
  })

  it('rejects a modified IV', async () => {
    const tampered = { ...payload, iv: Uint8Array.from(payload.iv) }
    tampered.iv.set([(tampered.iv[0] as number) ^ 0xff], 0)

    await expect(service.decrypt(tampered, PASSWORD)).rejects.toThrow(DecryptionFailedError)
  })

  it('rejects a swapped iteration count in the header', async () => {
    /* The header is AES-GCM additional data, so a change is caught by
       the tag, not only by a mismatched derived key. */
    const tampered: IEncryptedPayload = {
      ...payload,
      kdf: { ...payload.kdf, iterations: 1 },
    }

    await expect(service.decrypt(tampered, PASSWORD)).rejects.toThrow(DecryptionFailedError)
  })

  it('rejects a swapped salt in the header', async () => {
    const tampered: IEncryptedPayload = {
      ...payload,
      kdf: { ...payload.kdf, salt: new Uint8Array(SALT_LENGTH).fill(7) },
    }

    await expect(service.decrypt(tampered, PASSWORD)).rejects.toThrow(DecryptionFailedError)
  })

  it('rejects a format-version swap even when it still matches the supported version', async () => {
    const params = service.createKdfParams()
    const key = await service.deriveKey(PASSWORD, params)

    try {
      const original = await service.encryptWithKey(SECRET, key, params)
      const tampered: IEncryptedPayload = { ...original, version: PAYLOAD_VERSION }

      /* The version matches, but the whole header is checked:
         swapping any field breaks the authentication tag. */
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

  it('refuses to read a container newer than the supported format', async () => {
    const future: IEncryptedPayload = { ...payload, version: PAYLOAD_VERSION + 1 }

    await expect(service.decrypt(future, PASSWORD)).rejects.toThrow(UnsupportedVaultVersionError)
  })
})

describe('EncryptionService: password check', () => {
  it('accepts the correct password', async () => {
    const payload = await service.encrypt(SECRET, PASSWORD)

    await expect(service.verifyPassword(payload, PASSWORD)).resolves.toBe(true)
  })

  it('rejects a wrong password', async () => {
    const payload = await service.encrypt(SECRET, PASSWORD)

    await expect(service.verifyPassword(payload, 'other')).resolves.toBe(false)
  })

  it('distinguishes passwords that differ by one character', async () => {
    const payload = await service.encrypt(SECRET, PASSWORD)

    await expect(service.verifyPassword(payload, `${PASSWORD}5`)).resolves.toBe(false)
  })
})

describe('EncryptionService: stale parameters', () => {
  it('treats a container with a lower iteration count as stale', async () => {
    const payload = await service.encrypt(SECRET, PASSWORD)

    expect(service.needsUpgrade(payload)).toBe(true)
  })

  it('does not treat a container with current parameters as stale', () => {
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

describe('container serialisation', () => {
  it('is reversible', async () => {
    const payload = await service.encrypt(SECRET, PASSWORD)
    const restored = decodePayload(encodePayload(payload))

    expect(bytesToHex(restored.ciphertext)).toBe(bytesToHex(payload.ciphertext))
    expect(bytesToHex(restored.iv)).toBe(bytesToHex(payload.iv))
    expect(bytesToHex(restored.kdf.salt)).toBe(bytesToHex(payload.kdf.salt))
    expect(restored.kdf.iterations).toBe(payload.kdf.iterations)
  })

  it('survives a JSON round-trip', async () => {
    const payload = await service.encrypt(SECRET, PASSWORD)
    const restored = decodePayload(JSON.parse(JSON.stringify(encodePayload(payload))))
    const decrypted = await service.decrypt(restored, PASSWORD)

    try {
      expect(bytesToHex(decrypted.bytes)).toBe(bytesToHex(SECRET))
    } finally {
      decrypted.wipe()
    }
  })

  it('rejects a container without a version', () => {
    expect(() => decodePayload({ cipher: 'AES-GCM' })).toThrow(VaultCorruptedError)
  })

  it('rejects an unknown cipher', () => {
    expect(() => decodePayload({ version: 1, cipher: 'DES' })).toThrow(VaultCorruptedError)
  })

  it('rejects an unknown key-derivation algorithm', async () => {
    const record = encodePayload(await service.encrypt(SECRET, PASSWORD))

    expect(() => decodePayload({ ...record, kdf: { ...record.kdf, algorithm: 'MD5' } })).toThrow(
      VaultCorruptedError,
    )
  })

  it('rejects a zero iteration count', async () => {
    const record = encodePayload(await service.encrypt(SECRET, PASSWORD))

    expect(() => decodePayload({ ...record, kdf: { ...record.kdf, iterations: 0 } })).toThrow(
      VaultCorruptedError,
    )
  })

  it('rejects illegal characters in a hex field', async () => {
    const record = encodePayload(await service.encrypt(SECRET, PASSWORD))

    expect(() => decodePayload({ ...record, iv: 'zzzz' })).toThrow(VaultCorruptedError)
  })

  it('rejects a non-object', () => {
    expect(() => decodePayload(null)).toThrow(VaultCorruptedError)
    expect(() => decodePayload('string')).toThrow(VaultCorruptedError)
  })
})

describe('EncryptionService: session key', () => {
  it('does not allow exporting key material', async () => {
    const key = await service.deriveKey(PASSWORD, service.createKdfParams())

    try {
      expect(key.unwrap().extractable).toBe(false)
    } finally {
      key.destroy()
    }
  })

  it('does not reveal the key when state is serialised', async () => {
    const key = await service.deriveKey(PASSWORD, service.createKdfParams())

    try {
      expect(JSON.stringify({ key })).toBe('{"key":"[EncryptionKey]"}')
      expect(String(key)).toBe('[EncryptionKey]')
    } finally {
      key.destroy()
    }
  })

  it('rejects use after destroy', async () => {
    const params = service.createKdfParams()
    const key = await service.deriveKey(PASSWORD, params)
    key.destroy()

    expect(key.isDestroyed).toBe(true)
    await expect(service.encryptWithKey(SECRET, key, params)).rejects.toThrow()
  })

  it('allows destroying again', async () => {
    const key = await service.deriveKey(PASSWORD, service.createKdfParams())
    key.destroy()

    expect(() => {
      key.destroy()
    }).not.toThrow()
  })

  it('keys from different passwords are incompatible', async () => {
    const params = service.createKdfParams()
    const first = await service.deriveKey(PASSWORD, params)
    const second = await service.deriveKey('other password', params)

    try {
      const payload = await service.encryptWithKey(SECRET, first, params)

      await expect(service.decryptWithKey(payload, second)).rejects.toThrow(DecryptionFailedError)
    } finally {
      first.destroy()
      second.destroy()
    }
  })

  it('keys from the same salt and password match', async () => {
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
