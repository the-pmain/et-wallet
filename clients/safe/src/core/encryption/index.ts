export type { IEncryptionService, ISecureStorage } from './contracts'
export { EncryptionKey } from './EncryptionKey'
export { EncryptionService } from './EncryptionService'
export {
  AES_GCM,
  AUTH_TAG_BITS,
  IV_LENGTH,
  KEY_LENGTH,
  PAYLOAD_VERSION,
  PBKDF2,
  PBKDF2_HASH,
  PBKDF2_ITERATIONS,
  SALT_LENGTH,
  createDefaultKdfParams,
} from './parameters'
export {
  buildAdditionalData,
  decodePayload,
  encodePayload,
  type IEncryptedPayloadRecord,
} from './payload-codec'
export { getRandomBytes, wipeBytes } from './random'
export { withSecret, withSecretSync } from './with-secret'
export { SecretBuffer } from './SecretBuffer'
export { SecureStorage } from './SecureStorage'
export {
  CIPHER_ALGORITHM,
  KDF_ALGORITHM,
  type CipherAlgorithm,
  type IEncryptedPayload,
  type IKdfParams,
  type ISecretBuffer,
  type KdfAlgorithm,
} from './types'
