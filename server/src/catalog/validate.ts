import { NOTIFICATION_SEVERITY } from '../api/contracts.ts'
import { hasValidChecksum } from '../lib/address.ts'
import { CatalogValidationError } from '../lib/errors.ts'
import { compareVersions, isValidVersion } from '../lib/version.ts'

import type {
  INetworkEntry,
  INotificationEntry,
  IReleaseCatalog,
  IRpcEntry,
  ITokenEntry,
} from './types.ts'

/**
 * Проверка каталога при загрузке.
 *
 * СЕРВИС С ИСПОРЧЕННЫМ КАТАЛОГОМ ОБЯЗАН НЕ ЗАПУСТИТЬСЯ. Отдавать
 * адрес контракта, набранный с опечаткой, хуже, чем не отдавать
 * ничего: пользователь отправит деньги по этому адресу, и перевод
 * необратим. Отказ при старте виден сразу тому, кто разворачивает
 * сервис; ошибка в выдаче не видна никому, пока не станет поздно.
 */

/** Предельные длины текстовых полей. */
const LIMIT = {
  Name: 64,
  Symbol: 16,
  NotificationTitle: 80,
  NotificationBody: 500,
  Advisory: 300,
} as const

/** Наибольшее допустимое число знаков токена. */
const MAX_DECIMALS = 36

/**
 * Признаки ссылки в тексте.
 *
 * Проверяются не только полные адреса: `example.com` без схемы браузер
 * и пользователь всё равно прочитают как ссылку.
 */
const LINK_PATTERNS: readonly RegExp[] = [
  /https?:\/\//iu,
  /\bwww\./iu,
  /[a-z0-9-]+\.(com|org|net|io|xyz|app|finance|money|link|ru)\b/iu,
]

/** Отвергает текст, содержащий что-либо похожее на ссылку. */
function assertNoLinks(where: string, text: string): void {
  for (const pattern of LINK_PATTERNS) {
    if (pattern.test(text)) {
      throw new CatalogValidationError(
        `${where}: текст содержит ссылку. Сообщение сервиса, показанное внутри кошелька, ` +
          'выглядит как сообщение самого кошелька, и ссылка в нём ведёт куда угодно.',
      )
    }
  }
}

/** Отвергает пустую строку и строку длиннее предела. */
function assertText(where: string, value: string, limit: number): void {
  if (value.trim() === '') {
    throw new CatalogValidationError(`${where}: пустое значение`)
  }

  if (value.length > limit) {
    throw new CatalogValidationError(
      `${where}: длина ${String(value.length)} превышает предел ${String(limit)}`,
    )
  }
}

/** Отвергает адрес, не являющийся `https`. */
function assertHttpsUrl(where: string, value: string): void {
  let parsed: URL

  try {
    parsed = new URL(value)
  } catch {
    throw new CatalogValidationError(`${where}: адрес неразбираем: ${value}`)
  }

  if (parsed.protocol !== 'https:') {
    throw new CatalogValidationError(
      `${where}: разрешён только https, получено ${parsed.protocol}//. ` +
        'Незашифрованное соединение позволяет подменить ответ узла по дороге.',
    )
  }
}

/** Отвергает строку, не являющуюся моментом времени ISO 8601. */
function assertTimestamp(where: string, value: string): number {
  const parsed = Date.parse(value)

  if (Number.isNaN(parsed)) {
    throw new CatalogValidationError(`${where}: непонятный момент времени: ${value}`)
  }

  return parsed
}

/** Проверяет каталог сетей и возвращает множество известных идентификаторов. */
export function validateNetworks(networks: readonly INetworkEntry[]): ReadonlySet<bigint> {
  if (networks.length === 0) {
    throw new CatalogValidationError('каталог сетей пуст')
  }

  const known = new Set<bigint>()

  for (const network of networks) {
    const where = `сеть ${network.name}`

    if (network.chainId <= 0n) {
      throw new CatalogValidationError(`${where}: идентификатор сети должен быть положительным`)
    }

    if (known.has(network.chainId)) {
      throw new CatalogValidationError(
        `${where}: идентификатор ${network.chainId.toString()} встречается дважды. ` +
          'Две сети с одним идентификатором неразличимы для кошелька.',
      )
    }

    known.add(network.chainId)

    assertText(where, network.name, LIMIT.Name)
    assertText(`${where}: символ валюты`, network.nativeCurrency.symbol, LIMIT.Symbol)
    assertText(`${where}: имя валюты`, network.nativeCurrency.name, LIMIT.Name)

    if (
      !Number.isInteger(network.nativeCurrency.decimals) ||
      network.nativeCurrency.decimals < 0 ||
      network.nativeCurrency.decimals > MAX_DECIMALS
    ) {
      throw new CatalogValidationError(`${where}: недопустимое число знаков валюты`)
    }

    for (const url of network.blockExplorerUrls) {
      assertHttpsUrl(`${where}: обозреватель`, url)
    }
  }

  return known
}

/** Проверяет каталог RPC-адресов. */
export function validateRpcEndpoints(
  endpoints: readonly IRpcEntry[],
  knownChains: ReadonlySet<bigint>,
): void {
  const seen = new Set<string>()

  for (const endpoint of endpoints) {
    const where = `RPC ${endpoint.url}`

    if (!knownChains.has(endpoint.chainId)) {
      throw new CatalogValidationError(
        `${where}: сеть ${endpoint.chainId.toString()} отсутствует в каталоге сетей`,
      )
    }

    assertHttpsUrl(where, endpoint.url)
    assertText(`${where}: оператор`, endpoint.operator, LIMIT.Name)

    const key = `${endpoint.chainId.toString()}:${endpoint.url}`

    if (seen.has(key)) {
      throw new CatalogValidationError(`${where}: адрес повторяется в той же сети`)
    }

    seen.add(key)
  }

  /* Сеть без единого узла превращает переключение на неё в неработающий
     кошелёк: обратиться будет некуда. */
  for (const chainId of knownChains) {
    if (!endpoints.some((endpoint) => endpoint.chainId === chainId)) {
      throw new CatalogValidationError(`сеть ${chainId.toString()} не имеет ни одного RPC-адреса`)
    }
  }
}

/** Проверяет каталог токенов. */
export function validateTokens(
  tokens: readonly ITokenEntry[],
  knownChains: ReadonlySet<bigint>,
): void {
  const seen = new Set<string>()

  for (const entry of tokens) {
    const where = `токен ${entry.symbol} (${entry.address})`

    if (!knownChains.has(entry.chainId)) {
      throw new CatalogValidationError(
        `${where}: сеть ${entry.chainId.toString()} отсутствует в каталоге сетей`,
      )
    }

    /* Контрольная сумма EIP-55 ловит опечатку в адресе при загрузке —
       до того, как ошибочный адрес разойдётся по кошелькам. */
    if (!hasValidChecksum(entry.address)) {
      throw new CatalogValidationError(
        `${where}: адрес записан без контрольной суммы EIP-55 либо с ошибкой в ней`,
      )
    }

    const key = `${entry.chainId.toString()}:${entry.address.toLowerCase()}`

    if (seen.has(key)) {
      throw new CatalogValidationError(`${where}: адрес повторяется в той же сети`)
    }

    seen.add(key)

    assertText(`${where}: символ`, entry.symbol, LIMIT.Symbol)
    assertText(`${where}: имя`, entry.name, LIMIT.Name)

    if (!Number.isInteger(entry.decimals) || entry.decimals < 0 || entry.decimals > MAX_DECIMALS) {
      throw new CatalogValidationError(`${where}: недопустимое число знаков`)
    }

    /* Запись без указания источника — это рекомендация без основания.
       Отдавать её пользователю значит выдавать чужое доверие за своё. */
    if (entry.provenance.length === 0) {
      throw new CatalogValidationError(`${where}: не указан ни один источник подтверждения`)
    }

    assertTimestamp(`${where}: дата сверки`, entry.verifiedAt)
  }
}

/** Проверяет каталог уведомлений. */
export function validateNotifications(notifications: readonly INotificationEntry[]): void {
  const seen = new Set<string>()
  const severities = new Set<string>(Object.values(NOTIFICATION_SEVERITY))

  for (const entry of notifications) {
    const where = `уведомление ${entry.id}`

    if (seen.has(entry.id)) {
      throw new CatalogValidationError(
        `${where}: идентификатор повторяется. Клиент по нему помнит, что уже показано.`,
      )
    }

    seen.add(entry.id)

    if (!severities.has(entry.severity)) {
      throw new CatalogValidationError(`${where}: неизвестная важность ${entry.severity}`)
    }

    assertText(`${where}: заголовок`, entry.title, LIMIT.NotificationTitle)
    assertText(`${where}: текст`, entry.body, LIMIT.NotificationBody)

    assertNoLinks(`${where}: заголовок`, entry.title)
    assertNoLinks(`${where}: текст`, entry.body)

    const published = assertTimestamp(`${where}: дата публикации`, entry.publishedAt)

    if (entry.expiresAt !== null) {
      const expires = assertTimestamp(`${where}: дата окончания`, entry.expiresAt)

      if (expires <= published) {
        throw new CatalogValidationError(
          `${where}: срок истекает раньше публикации — такое уведомление не будет показано никогда`,
        )
      }
    }
  }
}

/** Проверяет сведения о выпусках. */
export function validateReleases(releases: IReleaseCatalog): void {
  for (const [field, value] of [
    ['latest', releases.latest],
    ['minSupported', releases.minSupported],
  ] as const) {
    if (!isValidVersion(value)) {
      throw new CatalogValidationError(`выпуски: поле ${field} имеет вид «${value}»`)
    }
  }

  if (compareVersions(releases.minSupported, releases.latest) > 0) {
    throw new CatalogValidationError(
      'выпуски: минимально поддерживаемая версия выше последней — ' +
        'при таком каталоге неподдерживаемыми окажутся все, включая свежие установки',
    )
  }

  if (releases.advisory !== null) {
    assertText('выпуски: пояснение', releases.advisory, LIMIT.Advisory)
    assertNoLinks('выпуски: пояснение', releases.advisory)
  }
}
