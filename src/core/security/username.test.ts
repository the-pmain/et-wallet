import { describe, expect, it } from 'vitest'

import {
  MAX_USERNAME_LENGTH,
  areUsernamesEqual,
  isValidUsername,
  normalizeUsername,
} from './username'

/** Символы, которых в имени быть не должно, — заданы кодами. */
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b)
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e)
const NEWLINE = String.fromCodePoint(0x000a)

describe('Приведение имени', () => {
  it('убирает пробелы по краям', () => {
    expect(normalizeUsername('  Дмитрий  ')).toBe('Дмитрий')
  })

  it('схлопывает повторяющиеся пробелы', () => {
    /* «Дмитрий  Иванов» и «Дмитрий Иванов» — одно и то же имя,
       а разница в интерфейсе выглядела бы опечаткой. */
    expect(normalizeUsername('Дмитрий   Иванов')).toBe('Дмитрий Иванов')
  })

  it('сохраняет регистр', () => {
    /* Это отображаемое имя: приводить «Дмитрий» к «дмитрий» значит
       показывать владельцу не то, что он ввёл. */
    expect(normalizeUsername('ДМитрий')).toBe('ДМитрий')
  })
})

describe('Пригодность имени', () => {
  it.each(['Дмитрий', 'Alex', 'Мария Петрова', 'user_42', 'Ли', '大明'])(
    'принимает «%s»',
    (name) => {
      /* Набор символов не ограничивается: запрещать людям называться так,
       как они называются, кошелёк не вправе. */
      expect(isValidUsername(name)).toBe(true)
    },
  )

  it('отвергает пустое значение', () => {
    expect(isValidUsername('')).toBe(false)
    expect(isValidUsername('   ')).toBe(false)
  })

  it('отвергает имя из одного символа', () => {
    /* Подпись кошелька из единственной буквы не отличает его ни от чего. */
    expect(isValidUsername('Д')).toBe(false)
  })

  it('отвергает слишком длинное имя', () => {
    /* Длинное имя вытеснило бы адрес из строки подтверждения
       транзакции — то есть скрыло бы то, куда уходят средства. */
    expect(isValidUsername('а'.repeat(MAX_USERNAME_LENGTH + 1))).toBe(false)
  })

  it('принимает имя ровно предельной длины', () => {
    expect(isValidUsername('а'.repeat(MAX_USERNAME_LENGTH))).toBe(true)
  })

  it('перевод строки становится пробелом, а не отказом', () => {
    /* Он ломает вёрстку списка аккаунтов, но отвергать из-за него имя
       незачем: вставка из буфера с переносом — обычная случайность,
       и разумнее её исправить, чем требовать переписать имя. */
    expect(isValidUsername(`Дмитрий${NEWLINE}Иванов`)).toBe(true)
    expect(normalizeUsername(`Дмитрий${NEWLINE}Иванов`)).toBe('Дмитрий Иванов')
  })

  it('отвергает непечатаемый управляющий символ', () => {
    /* В отличие от переноса, он не пробельный: превратить его
       во что-то осмысленное нельзя, а в имени он не нужен. */
    expect(isValidUsername(`Дмитрий${String.fromCodePoint(0x0007)}`)).toBe(false)
  })

  it('отвергает символ нулевой ширины', () => {
    /* Двумя внешне одинаковыми именами подделывают подписи так же,
       как адреса и имена ENS. */
    expect(isValidUsername(`Дмитрий${ZERO_WIDTH_SPACE}`)).toBe(false)
  })

  it('отвергает переключение направления письма', () => {
    /* Им переставляют видимый порядок символов, не меняя строку. */
    expect(isValidUsername(`Дмитрий${RIGHT_TO_LEFT_OVERRIDE}`)).toBe(false)
  })
})

describe('Сравнение имён', () => {
  it('не различает регистр', () => {
    expect(areUsernamesEqual('Дмитрий', 'дмитрий')).toBe(true)
  })

  it('не различает лишние пробелы', () => {
    expect(areUsernamesEqual(' Дмитрий  Иванов ', 'Дмитрий Иванов')).toBe(true)
  })

  it('различает разные имена', () => {
    expect(areUsernamesEqual('Дмитрий', 'Мария')).toBe(false)
  })
})
