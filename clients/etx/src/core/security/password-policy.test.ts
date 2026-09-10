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
  it('отвергает пустой пароль', () => {
    expect(assessPassword('').issues).toContain(PASSWORD_ISSUE.TooShort)
    expect(assessPassword('').isAcceptable).toBe(false)
  })

  it('принимает короткий простой пароль', () => {
    expect(assessPassword('123456').isAcceptable).toBe(true)
    expect(assessPassword('1').isAcceptable).toBe(true)
  })

  it('минимум — один символ', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(1)
  })

  it('отвергает чрезмерно длинный пароль', () => {
    /* Ограничение не про стойкость: PBKDF2 хэширует любую длину.
       Оно защищает от вставки мегабайтного текста, вывод ключа
       из которого подвесит интерфейс. */
    expect(assessPassword(`Ab1!${'x'.repeat(300)}`).issues).toContain(PASSWORD_ISSUE.TooLong)
    expect(assessPassword(`Ab1!${'x'.repeat(300)}`).isAcceptable).toBe(false)
  })
})

describe('assessPassword: разновидности символов', () => {
  it('отмечает мало разновидностей, но не отвергает пароль', () => {
    expect(assessPassword('abcdefghijklmnop').issues).toContain(PASSWORD_ISSUE.TooFewClasses)
    expect(assessPassword('abcdefghijklmnop').isAcceptable).toBe(true)
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
  it('отмечает распространённый пароль, но не отвергает его', () => {
    expect(assessPassword('Password1234').issues).toContain(PASSWORD_ISSUE.Common)
    expect(assessPassword('Password1234').isAcceptable).toBe(true)
  })

  it('находит распространённый фрагмент внутри пароля', () => {
    expect(assessPassword('MyPassword12!').issues).toContain(PASSWORD_ISSUE.Common)
  })

  it('отмечает пароль из повторяющегося фрагмента', () => {
    expect(assessPassword('Ab1!Ab1!Ab1!').issues).toContain(PASSWORD_ISSUE.Repetitive)
    expect(assessPassword('Ab1!Ab1!Ab1!').isAcceptable).toBe(true)
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

  it('пропускает простой пароль', () => {
    expect(() => {
      assertAcceptablePassword('123456')
    }).not.toThrow()
    expect(() => {
      assertAcceptablePassword('123')
    }).not.toThrow()
  })

  it('отвергает пустой пароль', () => {
    expect(() => {
      assertAcceptablePassword('')
    }).toThrow(WeakPasswordError)
  })

  it('не раскрывает пароль в тексте ошибки', () => {
    expect.assertions(1)

    try {
      assertAcceptablePassword(`secret123${'x'.repeat(300)}`)
    } catch (error) {
      expect((error as Error).message).not.toContain('secret123')
    }
  })
})
