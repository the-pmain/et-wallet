import { describe, expect, it } from 'vitest'

import { WeakPasswordError } from '@/core/errors'

import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_ISSUE,
  PASSWORD_STRENGTH,
  assertAcceptablePassword,
  assessPassword,
} from './password-policy'

describe('assessPassword: длина', () => {
  it('отвергает пароль короче минимума', () => {
    expect(assessPassword('Ab1!').issues).toContain(PASSWORD_ISSUE.TooShort)
  })

  it('принимает пароль ровно минимальной длины', () => {
    expect(assessPassword('Abcdefg1234!'.slice(0, MIN_PASSWORD_LENGTH)).issues).not.toContain(
      PASSWORD_ISSUE.TooShort,
    )
  })

  it('минимум — восемь символов', () => {
    /* Значение закреплено намеренно. Порог снижен с двенадцати, и
       обратное движение обязано быть осознанным, а не случайным
       следствием правки соседней строки. */
    expect(MIN_PASSWORD_LENGTH).toBe(8)
    expect(assessPassword('Abcdefg1').issues).not.toContain(PASSWORD_ISSUE.TooShort)
    expect(assessPassword('Abcdef1').issues).toContain(PASSWORD_ISSUE.TooShort)
  })

  it('отвергает чрезмерно длинный пароль', () => {
    /* Ограничение не про стойкость: PBKDF2 хэширует любую длину.
       Оно защищает от вставки мегабайтного текста, вывод ключа
       из которого подвесит интерфейс. */
    expect(assessPassword(`Ab1!${'x'.repeat(300)}`).issues).toContain(PASSWORD_ISSUE.TooLong)
  })
})

describe('assessPassword: разновидности символов', () => {
  it('требует не менее трёх разновидностей', () => {
    expect(assessPassword('abcdefghijklmnop').issues).toContain(PASSWORD_ISSUE.TooFewClasses)
  })

  it('принимает три разновидности', () => {
    expect(assessPassword('Abcdefgh1234').issues).not.toContain(PASSWORD_ISSUE.TooFewClasses)
  })

  it('распознаёт все четыре разновидности', () => {
    expect(assessPassword('Abcdefgh123!').presentClasses).toHaveLength(4)
  })

  it('распознаёт разновидности в нелатинских алфавитах', () => {
    expect(assessPassword('Пароль12345!').presentClasses).toHaveLength(4)
  })
})

describe('assessPassword: заведомо плохие пароли', () => {
  it('отвергает распространённый пароль', () => {
    expect(assessPassword('Password1234').issues).toContain(PASSWORD_ISSUE.Common)
  })

  it('находит распространённый фрагмент внутри пароля', () => {
    expect(assessPassword('MyPassword12!').issues).toContain(PASSWORD_ISSUE.Common)
  })

  it('отвергает пароль из повторяющегося фрагмента', () => {
    /* `abcabcabcabc` формально удовлетворяет длине, но перебирается
       как четырёхсимвольный. */
    expect(assessPassword('Ab1!Ab1!Ab1!').issues).toContain(PASSWORD_ISSUE.Repetitive)
  })

  it('не считает повторяющимся обычный пароль', () => {
    expect(assessPassword('Korova-7-Luna!').issues).not.toContain(PASSWORD_ISSUE.Repetitive)
  })
})

describe('assessPassword: оценка качества', () => {
  it('называет слабым пароль с нарушениями', () => {
    expect(assessPassword('abc').strength).toBe(PASSWORD_STRENGTH.Weak)
  })

  it('называет приемлемым короткий пароль без нарушений', () => {
    expect(assessPassword('Abcdefgh1234').strength).toBe(PASSWORD_STRENGTH.Fair)
  })

  it('называет хорошим длинный пароль со всеми разновидностями', () => {
    expect(assessPassword('Korova-7-Luna-Reka!').strength).toBe(PASSWORD_STRENGTH.Strong)
  })

  it('отсекает расхожие пароли короче прежнего порога', () => {
    /* Словарь был написан под минимум в двенадцать символов и пароль
       `Qwerty12` не замечал вовсе. После снижения порога такие
       варианты стали достижимы. */
    expect(assessPassword('Qwerty12').issues).toContain(PASSWORD_ISSUE.Common)
    expect(assessPassword('Abc123!x').issues).toContain(PASSWORD_ISSUE.Common)
    expect(assessPassword('Dragon1!').issues).toContain(PASSWORD_ISSUE.Common)
  })

  it('восьмисимвольный пароль без нарушений считается приемлемым', () => {
    expect(assessPassword('Reka-7Lu').strength).toBe(PASSWORD_STRENGTH.Fair)
    expect(assessPassword('Reka-7Lu').isAcceptable).toBe(true)
  })

  it('признаёт пригодным пароль без нарушений', () => {
    expect(assessPassword('Korova-7-Luna!').isAcceptable).toBe(true)
  })
})

describe('assertAcceptablePassword', () => {
  it('пропускает пригодный пароль', () => {
    expect(() => {
      assertAcceptablePassword('Korova-7-Luna!')
    }).not.toThrow()
  })

  it('отвергает непригодный', () => {
    expect(() => {
      assertAcceptablePassword('123')
    }).toThrow(WeakPasswordError)
  })

  it('не раскрывает пароль в тексте ошибки', () => {
    expect.assertions(1)

    try {
      assertAcceptablePassword('secret123')
    } catch (error) {
      expect((error as Error).message).not.toContain('secret123')
    }
  })
})
