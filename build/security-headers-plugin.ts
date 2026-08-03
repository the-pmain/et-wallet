import type { Plugin } from 'vite'

import { buildContentSecurityPolicy } from './csp-plugin'

/**
 * Заголовки безопасности для размещения.
 *
 * ЗАЧЕМ ОНИ, ЕСЛИ ЕСТЬ META-ТЕГ. Метатег не поддерживает `frame-ancestors`
 * и `report-*`: встраивание кошелька в чужую страницу им не запретить.
 * Страница кошелька в невидимом кадре поверх чужой — это подпись,
 * которую владелец сделал, целясь в другую кнопку.
 *
 * ЗАГОЛОВКИ ПОРОЖДАЮТСЯ ИЗ ТОГО ЖЕ ИСТОЧНИКА, ЧТО И МЕТАТЕГ. Два списка
 * директив, написанные руками, расходятся при первом же изменении,
 * и расхождение это молчаливое: сборка проходит, проверки проходят,
 * а политика на боевом размещении оказывается слабее объявленной.
 */

/**
 * Разрешения браузера.
 *
 * КАМЕРА И HID НУЖНЫ ПО ДЕЛУ, а не «на всякий случай»: первая читает
 * ссылку подключения со штрих-кода, второй разговаривает с аппаратным
 * кошельком. Размещение, оставившее настройки по умолчанию, отключило бы
 * обе возможности молча — они просто перестали бы работать без единого
 * сообщения.
 *
 * Всё остальное закрыто явно: перечислять только нужное безопаснее,
 * чем полагаться на умолчания браузера, которые меняются от версии
 * к версии.
 */
const PERMISSIONS_POLICY = [
  'camera=(self)',
  'hid=(self)',
  'accelerometer=()',
  'autoplay=()',
  'bluetooth=()',
  'display-capture=()',
  'geolocation=()',
  'gyroscope=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'serial=()',
  'usb=()',
  'xr-spatial-tracking=()',
].join(', ')

/** Заголовок безопасности: имя и значение. */
export interface ISecurityHeader {
  readonly name: string
  readonly value: string
}

/**
 * Заголовки, обязательные для размещения кошелька.
 *
 * @param connectSrc Источники соединений. По умолчанию — как в метатеге.
 */
export function buildSecurityHeaders(connectSrc?: string): readonly ISecurityHeader[] {
  return [
    {
      name: 'Content-Security-Policy',
      /* `frame-ancestors` добавляется только здесь: метатег эту
         директиву игнорирует, и объявлять её там значило бы создавать
         видимость защиты. */
      value: `${buildContentSecurityPolicy(connectSrc)}; frame-ancestors 'none'`,
    },
    /* Дублирует `frame-ancestors` для браузеров, которые её не знают.
       Стоит одной строки. */
    { name: 'X-Frame-Options', value: 'DENY' },
    { name: 'X-Content-Type-Options', value: 'nosniff' },
    /*
      Ни один адрес кошелька не должен уходить чужому серверу в заголовке
      перехода. Адресная строка содержит маршрут, а маршруты у нас
      не содержат адресов — но полагаться на это как на постоянное
      свойство нельзя.
    */
    { name: 'Referrer-Policy', value: 'no-referrer' },
    /*
      Два года и с поддоменами: перехват первого же обращения по HTTP
      позволяет подменить всю страницу, а страница и есть кошелёк.
      `preload` включает домен в список браузеров — там он защищён
      с самого первого посещения.
    */
    {
      name: 'Strict-Transport-Security',
      value: 'max-age=63072000; includeSubDomains; preload',
    },
    { name: 'Permissions-Policy', value: PERMISSIONS_POLICY },
    /* Окно, открытое кошельком либо открывшее его, не получает ссылки
       на его контекст. */
    { name: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { name: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  ]
}

/**
 * Правила хранения в кэше.
 *
 * ФАЙЛЫ СБОРКИ НЕИЗМЕНЯЕМЫ, ТОЧКА ВХОДА — НЕТ. Имена в `assets`
 * содержат отпечаток содержимого, поэтому их можно хранить сколько
 * угодно. `index.html` имени не меняет: сохрани его браузер надолго —
 * и человек остался бы на прежней сборке, включая ту, из которой
 * исправлена уязвимость.
 */
const CACHE_RULES: readonly { readonly path: string; readonly value: string }[] = [
  { path: '/assets/*', value: 'public, max-age=31536000, immutable' },
  { path: '/index.html', value: 'no-cache' },
  { path: '/', value: 'no-cache' },
]

/** Формирует файл `_headers` (Netlify, Cloudflare Pages). */
export function buildNetlifyHeaders(connectSrc?: string): string {
  const lines = ['/*']

  for (const header of buildSecurityHeaders(connectSrc)) {
    lines.push(`  ${header.name}: ${header.value}`)
  }

  for (const rule of CACHE_RULES) {
    lines.push('', rule.path, `  Cache-Control: ${rule.value}`)
  }

  return `${lines.join('\n')}\n`
}

/** Формирует фрагмент настройки nginx. */
export function buildNginxSnippet(connectSrc?: string): string {
  const lines = [
    '# Заголовки безопасности для ETWallet.',
    '#',
    '# Файл порождён сборкой из того же источника, что и метатег политики:',
    '# править его руками нельзя — правка потеряется при следующей сборке.',
    '#',
    '# Подключение: include этого файла внутри блока server.',
    '',
  ]

  for (const header of buildSecurityHeaders(connectSrc)) {
    /* `always` обязателен: без него заголовок не ставится на ответах
       с кодом ошибки, а страница ошибки — тоже страница. */
    lines.push(`add_header ${header.name} "${header.value}" always;`)
  }

  lines.push(
    '',
    'location /assets/ {',
    '  add_header Cache-Control "public, max-age=31536000, immutable" always;',
    '}',
    '',
    'location = /index.html {',
    '  add_header Cache-Control "no-cache" always;',
    '}',
  )

  return `${lines.join('\n')}\n`
}

/**
 * Кладёт файлы настройки размещения рядом со сборкой.
 *
 * Файлы попадают в `dist`, а не в репозиторий: они выведены из политики
 * и обязаны меняться вместе с ней. Файл в репозитории пришлось бы
 * обновлять руками, и он разошёлся бы с действующей политикой молча.
 */
export function securityHeadersPlugin(): Plugin {
  return {
    name: 'wallet:security-headers',
    apply: 'build',
    generateBundle() {
      const configured = process.env['VITE_CSP_CONNECT_SRC']?.trim()
      const connectSrc = configured === undefined || configured === '' ? undefined : configured

      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: buildNetlifyHeaders(connectSrc),
      })

      this.emitFile({
        type: 'asset',
        fileName: 'deploy/nginx-security.conf',
        source: buildNginxSnippet(connectSrc),
      })
    },
  }
}
