/**
 * Форма записи публичного ключа secp256k1.
 *
 * Сжатая (33 байта) содержит координату X и признак чётности Y; применяется
 * в BIP-32 и экономит место. Несжатая (65 байт) содержит обе координаты
 * и требуется при выводе адреса Ethereum.
 *
 * Тип объявлен здесь, а не в модуле HD-кошелька, сознательно: адрес
 * выводится и из HD-ключа, и из импортированного приватного ключа.
 * Размещение в `core/address` задаёт направление зависимости
 * `hdwallet -> address` и исключает цикл между модулями.
 */
export const PUBLIC_KEY_FORMAT = {
  Compressed: 'compressed',
  Uncompressed: 'uncompressed',
} as const

export type PublicKeyFormat = (typeof PUBLIC_KEY_FORMAT)[keyof typeof PUBLIC_KEY_FORMAT]

/** Длина адреса EVM в байтах. */
export const ADDRESS_BYTE_LENGTH = 20

/** Длина приватного ключа secp256k1 в байтах. */
export const PRIVATE_KEY_LENGTH = 32

/** Сжатый публичный ключ SEC1: префикс 0x02/0x03 и координата X. */
export const COMPRESSED_PUBLIC_KEY_LENGTH = 33

/** Несжатый публичный ключ SEC1: префикс 0x04 и координаты X, Y. */
export const UNCOMPRESSED_PUBLIC_KEY_LENGTH = 65

/** Координаты X и Y без байта префикса — форма, используемая Ethereum. */
export const RAW_PUBLIC_KEY_LENGTH = 64
