import { describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import type { HexString } from '@/core/types'

import {
  TRANSFER_BATCH_TOPIC,
  TRANSFER_SINGLE_TOPIC,
  TRANSFER_TOPIC,
  addressToTopic,
  hexToBigInt,
  splitDataWords,
  topicToAddress,
} from './transfer-events'

const ADDRESS = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')

describe('Идентификаторы событий', () => {
  it('вычисляются, а не берутся из константы', () => {
    /* Значение keccak256 от подписи `Transfer(address,address,uint256)`
       опубликовано в стандарте ERC-20 и совпадает во всех сетях EVM.
       Проверка фиксирует именно его: ошибка в одном символе дала бы
       пустую историю без единого сообщения об ошибке. */
    expect(TRANSFER_TOPIC).toBe(
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
    )
  })

  it('различают события ERC-1155', () => {
    expect(TRANSFER_SINGLE_TOPIC).toBe(
      '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62',
    )
    expect(TRANSFER_BATCH_TOPIC).toBe(
      '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb',
    )
  })

  it('имеют длину 32 байта', () => {
    for (const topic of [TRANSFER_TOPIC, TRANSFER_SINGLE_TOPIC, TRANSFER_BATCH_TOPIC]) {
      expect(topic).toHaveLength(66)
    }
  })

  it('не совпадают между собой', () => {
    const topics = new Set([TRANSFER_TOPIC, TRANSFER_SINGLE_TOPIC, TRANSFER_BATCH_TOPIC])

    expect(topics.size).toBe(3)
  })
})

describe('addressToTopic', () => {
  it('дополняет адрес нулями до 32 байт', () => {
    const topic = addressToTopic(ADDRESS)

    expect(topic).toHaveLength(66)
    expect(topic.startsWith('0x000000000000000000000000')).toBe(true)
  })

  it('приводит адрес к нижнему регистру', () => {
    /* Узел сравнивает темы побайтово: запись в контрольной сумме EIP-55
       не совпала бы ни с одним журналом. */
    expect(addressToTopic(ADDRESS)).toBe(`0x${ADDRESS.slice(2).toLowerCase().padStart(64, '0')}`)
  })
})

describe('topicToAddress', () => {
  it('восстанавливает адрес из темы', () => {
    expect(topicToAddress(addressToTopic(ADDRESS)).toLowerCase()).toBe(ADDRESS.toLowerCase())
  })

  it('возвращает адрес в записи EIP-55', () => {
    /* Тема хранит адрес в нижнем регистре, но наружу обязан выходить
       адрес с контрольной суммой: без неё пользователь лишён единственной
       возможности заметить подмену. */
    expect(topicToAddress(addressToTopic(ADDRESS))).toBe(ADDRESS)
  })

  it('отвергает тему неверной длины', () => {
    expect(() => topicToAddress('0x1234' as HexString)).toThrow()
  })
})

describe('hexToBigInt', () => {
  it('читает шестнадцатеричное значение', () => {
    expect(hexToBigInt('0xff')).toBe(255n)
  })

  it('считает пустое значение нулём', () => {
    /* Узлы возвращают `0x` для пустых данных, а `BigInt('0x')`
       выбрасывает исключение. */
    expect(hexToBigInt('0x')).toBe(0n)
    expect(hexToBigInt('')).toBe(0n)
  })

  it('не теряет точность на больших суммах', () => {
    const raw = '0xffffffffffffffffffffffff'

    expect(hexToBigInt(raw)).toBe(79_228_162_514_264_337_593_543_950_335n)
  })
})

describe('splitDataWords', () => {
  it('делит данные на слова по 32 байта', () => {
    const data = `0x${'1'.padStart(64, '0')}${'2'.padStart(64, '0')}` as HexString

    expect(splitDataWords(data)).toEqual([1n, 2n])
  })

  it('возвращает пустой список для пустых данных', () => {
    expect(splitDataWords('0x' as HexString)).toEqual([])
  })

  it('игнорирует неполное последнее слово', () => {
    const data = `0x${'1'.padStart(64, '0')}abcd` as HexString

    expect(splitDataWords(data)).toEqual([1n])
  })
})
