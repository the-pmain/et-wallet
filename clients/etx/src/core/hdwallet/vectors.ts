/**
 * Эталонные тестовые данные для HD-кошелька.
 *
 * Стратегия проверки — послойная, а не «одним махом от фразы до адреса».
 * Слоёв три, и каждый проверяется своим общепризнанным набором данных:
 *
 * 1. Деривация BIP-32 — официальными векторами из текста BIP-32
 *    (расширенные ключи проверяются как строки base58).
 * 2. Контрольная сумма EIP-55 — примерами из текста самого EIP.
 * 3. Композиция «мнемоника -> адрес» — общеизвестными адресами тестовой
 *    фразы `abandon ... about`.
 *
 * Смысл разделения: при расхождении сразу видно, какой слой сломан.
 * Единственный сквозной тест показал бы только факт поломки.
 */

/** Официальный вектор 1 из текста BIP-32. */
export const BIP32_VECTOR_1 = {
  seedHex: '000102030405060708090a0b0c0d0e0f',
  masterXprv:
    'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi',
  masterXpub:
    'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8',
} as const

/**
 * Примеры контрольной суммы из текста EIP-55.
 *
 * Именно эти четыре адреса приведены в самом стандарте как эталонные.
 */
export const EIP55_ADDRESSES: readonly string[] = [
  '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
  '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
  '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
  '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
]

/**
 * Тестовая мнемоническая фраза.
 *
 * Соответствует нулевой энтропии и применяется как эталон во всей отрасли.
 * ИСПОЛЬЗОВАТЬ ЕЁ ДЛЯ РЕАЛЬНЫХ СРЕДСТВ НЕЛЬЗЯ: приватные ключи этой фразы
 * известны каждому, и любые поступления на её адреса выводятся ботами
 * в течение секунд.
 */
export const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

/**
 * Адреса тестовой фразы по пути `m/44'/60'/0'/0/n` при пустой парольной фразе.
 *
 * Совпадают с тем, что показывают MetaMask, Rabby и Trust Wallet
 * при импорте этой мнемоники.
 */
export const TEST_MNEMONIC_ADDRESSES: readonly string[] = [
  '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
  '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0',
  '0xb6716976A3ebe8D39aCEB04372f22Ff8e6802D7A',
  '0xF3f50213C1d2e255e4B2bAD430F8A38EEF8D718E',
  '0x51cA8ff9f1C0a99f88E86B8112eA3237F55374cA',
]
