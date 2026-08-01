import { WeakPasswordError } from '@/core/errors'

/**
 * Минимальная длина пароля.
 *
 * Восемь символов — распространённый минимум, но для кошелька он слабоват.
 * Двенадцать выбраны потому, что пароль здесь защищает не учётную запись
 * на сайте (где сервер ограничивает частоту попыток), а зашифрованный файл
 * на диске: перебор идёт офлайн и упирается только в стоимость KDF.
 */
export const MIN_PASSWORD_LENGTH = 12

/**
 * Верхняя граница длины.
 *
 * Не про безопасность: PBKDF2 хэширует пароль любой длины. Ограничение
 * защищает от случайной вставки мегабайтного текста, вывод ключа из
 * которого подвесит интерфейс.
 */
export const MAX_PASSWORD_LENGTH = 256

/**
 * Наиболее распространённые пароли.
 *
 * Список намеренно короткий. Полноценная проверка по словарю утечек
 * требует загрузки десятков мегабайт либо обращения к внешнему сервису —
 * последнее для кошелька неприемлемо: отправка даже хэша пароля наружу
 * связывает пользователя с его кошельком.
 *
 * Здесь отсекаются только те варианты, которые подбираются первыми
 * секундами любой атаки.
 */
const COMMON_PASSWORDS: readonly string[] = [
  'password',
  'passw0rd',
  'qwertyuiop',
  '123456789012',
  'qwerty123456',
  'administrator',
  'iloveyou1234',
  'letmein12345',
]

/** Разновидности символов, учитываемые при оценке. */
export const CHARACTER_CLASS = {
  Lowercase: 'lowercase',
  Uppercase: 'uppercase',
  Digit: 'digit',
  Symbol: 'symbol',
} as const

export type CharacterClass = (typeof CHARACTER_CLASS)[keyof typeof CHARACTER_CLASS]

/** Причина, по которой пароль отвергнут. */
export const PASSWORD_ISSUE = {
  TooShort: 'too-short',
  TooLong: 'too-long',
  TooFewClasses: 'too-few-classes',
  Common: 'common',
  Repetitive: 'repetitive',
} as const

export type PasswordIssue = (typeof PASSWORD_ISSUE)[keyof typeof PASSWORD_ISSUE]

/** Оценка качества пароля для отображения. */
export const PASSWORD_STRENGTH = {
  Weak: 'weak',
  Fair: 'fair',
  Strong: 'strong',
} as const

export type PasswordStrength = (typeof PASSWORD_STRENGTH)[keyof typeof PASSWORD_STRENGTH]

export interface IPasswordAssessment {
  readonly isAcceptable: boolean
  readonly strength: PasswordStrength
  readonly issues: readonly PasswordIssue[]
  readonly presentClasses: readonly CharacterClass[]
}

/** Минимальное число разновидностей символов. */
const MIN_CHARACTER_CLASSES = 3

/** Длина, начиная с которой пароль считается надёжным. */
const STRONG_PASSWORD_LENGTH = 16

/**
 * Оценивает пароль, не выбрасывая исключений.
 *
 * Предназначена для подсказки по мере ввода: пользователь не должен видеть
 * ошибку до того, как закончил печатать.
 *
 * ЧЕГО ЭТА ОЦЕНКА НЕ ДЕЛАЕТ. Она не измеряет энтропию и не заменяет проверку
 * по словарю утечек. Пароль `Tr0ub4dor&3` пройдёт все правила и при этом
 * подбирается по словарю за минуты. Правила отсекают заведомо плохое,
 * но не подтверждают, что пароль хороший — интерфейс не должен обещать
 * обратное словом «надёжный» без оговорок.
 */
export function assessPassword(password: string): IPasswordAssessment {
  const issues: PasswordIssue[] = []
  const presentClasses = detectCharacterClasses(password)

  if (password.length < MIN_PASSWORD_LENGTH) {
    issues.push(PASSWORD_ISSUE.TooShort)
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    issues.push(PASSWORD_ISSUE.TooLong)
  }

  if (presentClasses.length < MIN_CHARACTER_CLASSES) {
    issues.push(PASSWORD_ISSUE.TooFewClasses)
  }

  if (isCommon(password)) {
    issues.push(PASSWORD_ISSUE.Common)
  }

  if (isRepetitive(password)) {
    issues.push(PASSWORD_ISSUE.Repetitive)
  }

  return {
    isAcceptable: issues.length === 0,
    strength: gradeStrength(password, presentClasses, issues),
    issues,
    presentClasses,
  }
}

/**
 * Проверяет пароль перед созданием кошелька.
 *
 * @throws WeakPasswordError с перечислением нарушенных правил.
 */
export function assertAcceptablePassword(password: string): void {
  const assessment = assessPassword(password)

  if (!assessment.isAcceptable) {
    throw new WeakPasswordError(assessment.issues.join(', '))
  }
}

function detectCharacterClasses(password: string): readonly CharacterClass[] {
  const classes: CharacterClass[] = []

  if (/\p{Ll}/u.test(password)) {
    classes.push(CHARACTER_CLASS.Lowercase)
  }

  if (/\p{Lu}/u.test(password)) {
    classes.push(CHARACTER_CLASS.Uppercase)
  }

  if (/\p{Nd}/u.test(password)) {
    classes.push(CHARACTER_CLASS.Digit)
  }

  if (/[^\p{L}\p{Nd}]/u.test(password)) {
    classes.push(CHARACTER_CLASS.Symbol)
  }

  return classes
}

function isCommon(password: string): boolean {
  const normalized = password.toLowerCase()

  return COMMON_PASSWORDS.some((candidate) => normalized.includes(candidate))
}

/**
 * Обнаруживает пароль из повторяющегося фрагмента.
 *
 * `abcabcabcabc` формально удовлетворяет длине, но перебирается как
 * четырёхсимвольный.
 */
function isRepetitive(password: string): boolean {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return false
  }

  for (let size = 1; size <= password.length / 2; size += 1) {
    if (password.length % size !== 0) {
      continue
    }

    const fragment = password.slice(0, size)

    if (fragment.repeat(password.length / size) === password) {
      return true
    }
  }

  return false
}

function gradeStrength(
  password: string,
  presentClasses: readonly CharacterClass[],
  issues: readonly PasswordIssue[],
): PasswordStrength {
  if (issues.length > 0) {
    return PASSWORD_STRENGTH.Weak
  }

  if (password.length >= STRONG_PASSWORD_LENGTH && presentClasses.length === 4) {
    return PASSWORD_STRENGTH.Strong
  }

  return PASSWORD_STRENGTH.Fair
}
