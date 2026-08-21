/**
 * Сколько знаков после запятой показывается по умолчанию.
 *
 * Шесть, а не восемнадцать: полная точность нативной валюты нечитаема
 * и создаёт ложное ощущение, будто последние знаки чем-то важны.
 */
const DEFAULT_FRACTION_DIGITS = 6

/**
 * Приводит сумму в минимальных единицах к строке для показа.
 *
 * ВСЕ ВЫЧИСЛЕНИЯ НА `bigint`. Перевод в `number` при восемнадцати знаках
 * теряет точность уже на десятых долях токена: `Number.MAX_SAFE_INTEGER`
 * меньше, чем 0.01 ETH в wei.
 *
 * УСЕЧЕНИЕ, А НЕ ОКРУГЛЕНИЕ. Округление вверх показало бы больше средств,
 * чем есть, и пользователь попытался бы отправить недоступную сумму.
 * Показанное значение всегда не превышает настоящего.
 *
 * НЕНУЛЕВОЙ ОСТАТОК НИКОГДА НЕ ПРЕВРАЩАЕТСЯ В НОЛЬ. Сумма меньше
 * отображаемой точности выводится как `<0.000001`. Показанный ноль при
 * ненулевом балансе — это утверждение «средств нет», и оно ложно.
 */
export function formatTokenAmount(
  raw: bigint,
  decimals: number,
  fractionDigits: number = DEFAULT_FRACTION_DIGITS,
): string {
  if (raw < 0n) {
    return `-${formatTokenAmount(-raw, decimals, fractionDigits)}`
  }

  const scale = 10n ** BigInt(decimals)
  const whole = raw / scale
  const remainder = raw % scale

  if (remainder === 0n) {
    return whole.toString()
  }

  /* Дробная часть дополняется ведущими нулями до полной длины: остаток
     0.05 при восемнадцати знаках — это 5·10¹⁶, и без дополнения он был бы
     прочитан как 0.5. */
  const fraction = remainder.toString().padStart(decimals, '0').slice(0, fractionDigits)
  const trimmed = fraction.replace(/0+$/u, '')

  if (trimmed === '') {
    /* Остаток есть, но он не помещается в отображаемую точность. */
    return `<${formatSmallestVisible(whole, fractionDigits)}`
  }

  return `${whole.toString()}.${trimmed}`
}

/**
 * Полная запись суммы в единицах токена, без усечения.
 *
 * Для поля ввода: показать `2`, а не `2000000000000000000`, и не
 * подменять крошечный остаток на `<0.000001`. Обратная сторона
 * {@link parseAmount}.
 */
export function formatExactTokenAmount(raw: bigint, decimals: number): string {
  if (raw < 0n) {
    return `-${formatExactTokenAmount(-raw, decimals)}`
  }

  if (decimals === 0) {
    return raw.toString()
  }

  const scale = 10n ** BigInt(decimals)
  const whole = raw / scale
  const remainder = raw % scale

  if (remainder === 0n) {
    return whole.toString()
  }

  const fraction = remainder.toString().padStart(decimals, '0').replace(/0+$/u, '')

  return `${whole.toString()}.${fraction}`
}

/** Наименьшее значение, различимое при заданной точности. */
function formatSmallestVisible(whole: bigint, fractionDigits: number): string {
  const fraction = '0'.repeat(Math.max(fractionDigits - 1, 0))

  return `${whole.toString()}.${fraction}1`
}

/**
 * Усекает адрес для показа в узком месте интерфейса.
 *
 * РЕГИСТР СИМВОЛОВ СОХРАНЯЕТСЯ: он несёт контрольную сумму EIP-55.
 * Приведение к нижнему регистру «для красоты» лишило бы пользователя
 * единственной возможности заметить подменённый адрес.
 *
 * Показываются начало и конец. Середина адреса не помогает опознанию,
 * а подмена крайних символов заметна.
 */
export function shortenAddress(address: string, visibleChars = 6): string {
  if (address.length <= visibleChars * 2 + 1) {
    return address
  }

  return `${address.slice(0, visibleChars)}…${address.slice(-visibleChars)}`
}

/**
 * Подпись адреса: имя ENS, если оно подтверждено, иначе усечённый адрес.
 *
 * ЗАМЕНА ДОПУСТИМА НЕ ВЕЗДЕ. Имя короче и узнаваемее адреса, и в списке
 * аккаунтов оно полезнее. Но на экране подтверждения перевода замена
 * запрещена: подписывается адрес, и показать вместо него имя значит
 * показать не то, что подписывается, — основной класс атак на интерфейс
 * кошелька. Там имя выводится ДОПОЛНИТЕЛЬНО к полному адресу.
 *
 * В карту попадают только имена, прошедшие сверку прямым разрешением:
 * непроверенное имя из обратной записи задаёт кто угодно.
 */
export function addressLabel(address: string, ensNames: ReadonlyMap<string, string>): string {
  return ensNames.get(address.toLowerCase()) ?? shortenAddress(address)
}

/**
 * Имя узла из адреса RPC.
 *
 * ПОКАЗЫВАЕТСЯ ИМЕННО ХОСТ, А НЕ ПОЛНЫЙ АДРЕС. Путь адреса содержит ключ:
 * у Alchemy это ключ приложения, у собственного узла пользователя — ключ
 * его учётной записи. Выводить их на экран незачем: для опознания узла
 * достаточно имени, а ключ, показанный на экране, утекает при демонстрации
 * экрана и на скриншотах.
 *
 * Неразбираемая строка возвращается как есть: скрыть непонятное значение
 * хуже, чем показать — пользователь должен видеть, что именно записано.
 */
export function endpointHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Дата и время операции в местном формате. */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString()
}
