import type { ITypedData } from '@/core/transaction'
import { toChainId, type Address } from '@/core/types'

/**
 * Эталонные данные для проверки подписи.
 *
 * Все значения взяты из текстов соответствующих стандартов, а не получены
 * прогоном собственного кода. Это принципиально: тест, ожидающий то,
 * что выдала реализация, проверяет лишь её неизменность, но не корректность.
 */

/**
 * Официальный пример из текста EIP-155.
 *
 * Приведён в самом стандарте как иллюстрация защиты от повторного
 * проигрывания. Проверяет всю цепочку: сериализацию RLP, включение
 * chainId в подписываемые данные и формирование `v`.
 */
export const EIP155_VECTOR = {
  privateKeyHex: '4646464646464646464646464646464646464646464646464646464646464646',
  from: '0x9d8A62f656a8d1615C1294fd71e9CFb3E4855A4F' as Address,
  chainId: toChainId(1),
  nonce: 9,
  gasPrice: 20_000_000_000n,
  gasLimit: 21_000n,
  to: '0x3535353535353535353535353535353535353535' as Address,
  value: 1_000_000_000_000_000_000n,
  signedRaw:
    '0xf86c098504a817c800825208943535353535353535353535353535353535353535880de0b6b3a76400008025a028ef61340bd939bc2195fe537567866003e1a15d3c71ff63e1590620aa636276a067cbe9d8997f761aecb703304b3800ccf555c9f3dc64214b297fb1966a3b6d83',
} as const

/**
 * Пример структуры из текста EIP-712.
 *
 * Стандарт приводит для него итоговый хэш, что позволяет проверить
 * кодирование независимо от реализации подписи.
 */
export const EIP712_MAIL: ITypedData = {
  domain: {
    name: 'Ether Mail',
    version: '1',
    chainId: toChainId(1),
    verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC' as Address,
  },
  types: {
    Person: [
      { name: 'name', type: 'string' },
      { name: 'wallet', type: 'address' },
    ],
    Mail: [
      { name: 'from', type: 'Person' },
      { name: 'to', type: 'Person' },
      { name: 'contents', type: 'string' },
    ],
  },
  primaryType: 'Mail',
  message: {
    from: { name: 'Cow', wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826' },
    to: { name: 'Bob', wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' },
    contents: 'Hello, Bob!',
  },
}

/** Итоговый хэш примера `Mail`, приведённый в тексте EIP-712. */
export const EIP712_MAIL_HASH = '0xbe609aee343fb3c4b28e1df9e632fca64fcfaede20f02e86244efddf30957bd2'

/** Приватный ключ, равный единице. Его адрес общеизвестен. */
export const KEY_ONE_HEX = '0000000000000000000000000000000000000000000000000000000000000001'

/** Адрес приватного ключа, равного единице. */
export const KEY_ONE_ADDRESS = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf' as Address

/** Преобразует шестнадцатеричную строку в байты. Только для тестов. */
export function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }

  return bytes
}
