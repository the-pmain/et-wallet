/**
 * Сравнение версий вида `МАЖОР.МИНОР.ПАТЧ`.
 *
 * ПОЧЕМУ БЕЗ БИБЛИОТЕКИ. Полный semver включает предвыпускные метки
 * и метаданные сборки с нетривиальными правилами упорядочивания.
 * Версии приложения устроены проще, и десять строк, покрытых тестами,
 * понятнее зависимости, поведение которой в крайних случаях приходится
 * принимать на веру. Если понадобятся предвыпуски — брать библиотеку,
 * а не дописывать правила сюда.
 *
 * СРАВНЕНИЕ ЧИСЛОВОЕ, А НЕ СТРОКОВОЕ. Строковое сравнение ставит
 * `0.10.0` ниже `0.9.0`, и приложение объявляет свежую версию
 * устаревшей — либо, что хуже, устаревшую поддерживаемой.
 */

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/u

/** Разобранная версия. */
interface IVersionParts {
  readonly major: number
  readonly minor: number
  readonly patch: number
}

/** Соответствует ли строка виду `МАЖОР.МИНОР.ПАТЧ`. */
export function isValidVersion(value: string): boolean {
  return VERSION_PATTERN.test(value)
}

/**
 * Разбирает версию.
 *
 * @throws Error если строка не соответствует виду `МАЖОР.МИНОР.ПАТЧ`.
 */
export function parseVersion(value: string): IVersionParts {
  const match = VERSION_PATTERN.exec(value)

  if (match === null) {
    throw new Error(`Версия должна иметь вид МАЖОР.МИНОР.ПАТЧ, получено: ${value}`)
  }

  /* Группы существуют по построению выражения, но проверка индексов
     включена настройкой компилятора и обходить её приведением типа
     значило бы отключить ровно ту защиту, ради которой она включена. */
  const [, major = '0', minor = '0', patch = '0'] = match

  return { major: Number(major), minor: Number(minor), patch: Number(patch) }
}

/**
 * Сравнивает две версии.
 *
 * @returns Отрицательное число, если `left` ниже `right`, ноль при
 *          равенстве, положительное, если `left` выше.
 * @throws Error если любая из строк составлена неверно.
 */
export function compareVersions(left: string, right: string): number {
  const first = parseVersion(left)
  const second = parseVersion(right)

  if (first.major !== second.major) {
    return first.major - second.major
  }

  if (first.minor !== second.minor) {
    return first.minor - second.minor
  }

  return first.patch - second.patch
}
