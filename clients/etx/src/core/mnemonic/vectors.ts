/**
 * Официальные тестовые векторы BIP-39.
 *
 * Источник: эталонный набор из репозитория Trezor (python-mnemonic),
 * на который ссылается сам текст BIP-39. Парольная фраза во всех векторах —
 * строка `TREZOR`.
 *
 * Зачем они здесь, если `@scure/bip39` уже проверена этими же векторами:
 * тесты защищают не библиотеку, а обёртку над ней. Нормализация ввода,
 * порядок преобразований, работа с буферами — всё это наш код, и ошибка
 * в нём даст неверный seed при формально корректной библиотеке.
 *
 * Файл не имеет расширения `.test.ts` сознательно: это данные,
 * используемые несколькими тестовыми файлами.
 */

export interface IBip39Vector {
  /** Энтропия в шестнадцатеричном виде. */
  readonly entropy: string
  /** Ожидаемая мнемоническая фраза. */
  readonly mnemonic: string
  /** Ожидаемый seed при парольной фразе `TREZOR`. `null`, если не проверяется. */
  readonly seed: string | null
}

export const TREZOR_PASSPHRASE = 'TREZOR'

export const BIP39_VECTORS: readonly IBip39Vector[] = [
  {
    entropy: '00000000000000000000000000000000',
    mnemonic:
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    seed: 'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04',
  },
  {
    entropy: '7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f',
    mnemonic: 'legal winner thank year wave sausage worth useful legal winner thank yellow',
    seed: '2e8905819b8723fe2c1d161860e5ee1830318dbf49a83bd451cfb8440c28bd6fa457fe1296106559a3c80937a1c1069be3a3a5bd381ee6260e8d9739fce1f607',
  },
  {
    entropy: '80808080808080808080808080808080',
    mnemonic: 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above',
    seed: null,
  },
  {
    entropy: 'ffffffffffffffffffffffffffffffff',
    mnemonic: 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',
    seed: null,
  },
  {
    entropy: '0000000000000000000000000000000000000000000000000000000000000000',
    mnemonic:
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art',
    seed: null,
  },
  {
    entropy: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    mnemonic:
      'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo vote',
    seed: null,
  },
]

/** Преобразует шестнадцатеричную строку в байты. Только для тестов. */
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }

  return bytes
}

/** Преобразует байты в шестнадцатеричную строку. Только для тестов. */
export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
