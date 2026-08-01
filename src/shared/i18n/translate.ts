import { DICTIONARIES, type Language, type TranslationKey } from './dictionary'

/** Значения для подстановки в строку перевода. */
export type TranslationValues = Readonly<Record<string, string | number>>

/**
 * Подставляет значения в строку перевода.
 *
 * ПОДСТАНОВКА ТЕКСТОВАЯ И НЕ ИСПОЛНЯЕТ НИЧЕГО. Заполнитель вида
 * `{name}` заменяется значением как есть; результат попадает в React
 * текстовым узлом и разметкой не становится. Шаблонизатор, умеющий
 * больше, открыл бы путь к подстановке разметки из перевода.
 *
 * Незаданный заполнитель остаётся на месте, а не превращается в пустоту:
 * `{amount}` на экране виден и чинится, пустое место — нет.
 */
function interpolate(template: string, values: TranslationValues | undefined): string {
  if (values === undefined) {
    return template
  }

  return template.replace(/\{(\w+)\}/gu, (placeholder, name: string) => {
    const value = values[name]

    return value === undefined ? placeholder : String(value)
  })
}

/**
 * Возвращает перевод по ключу.
 *
 * ОТСУТСТВУЮЩИЙ ПЕРЕВОД ВОЗВРАЩАЕТ РУССКИЙ ТЕКСТ, А НЕ КЛЮЧ И НЕ ПУСТУЮ
 * СТРОКУ. Пустое место на месте предупреждения о риске — это исчезнувшее
 * предупреждение; строка `unlock.failed` на экране пугает пользователя
 * и ничего ему не сообщает. Текст на другом языке хотя бы читается.
 *
 * Типы делают такой случай почти невозможным: английский словарь обязан
 * содержать те же ключи. Запасной вариант остаётся на случай, когда
 * словарь собран не типами — например, придёт из данных.
 */
export function translate(
  language: Language,
  key: TranslationKey,
  values?: TranslationValues,
): string {
  const dictionary = DICTIONARIES[language]
  const fallback = DICTIONARIES.ru

  return interpolate(dictionary[key] ?? fallback[key], values)
}
