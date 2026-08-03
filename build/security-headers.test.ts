import { describe, expect, it } from 'vitest'

import { buildContentSecurityPolicy } from './csp-plugin'
import {
  buildNetlifyHeaders,
  buildNginxSnippet,
  buildSecurityHeaders,
} from './security-headers-plugin'

/** Значение заголовка по имени. */
function header(name: string, connectSrc?: string): string {
  return buildSecurityHeaders(connectSrc).find((entry) => entry.name === name)?.value ?? ''
}

describe('Политика соединений', () => {
  it('по умолчанию разрешает любой HTTPS', () => {
    /* Пользователь вправе указать свой узел, а его адрес на этапе
       сборки неизвестен. Перечень встроенных сетей отменил бы главную
       защиту приватности запросов. */
    expect(buildContentSecurityPolicy()).toContain("connect-src 'self' https:")
  })

  it('размещающий может задать перечень источников явно', () => {
    /* Размещение, где своим узлом пользоваться не предполагают, вправе
       запретить обращения к произвольным адресам. */
    const policy = buildContentSecurityPolicy("'self' https://eth.example")

    expect(policy).toContain("connect-src 'self' https://eth.example")
    expect(policy).not.toContain('connect-src ;')
  })

  it('перечень источников доходит и до заголовков', () => {
    /* Метатег и заголовок обязаны говорить одно и то же: иначе
       политика на боевом размещении окажется иной, чем проверенная. */
    expect(header('Content-Security-Policy', "'self' https://eth.example")).toContain(
      'https://eth.example',
    )
  })
})

describe('Заголовки размещения', () => {
  it('запрещают встраивание в чужую страницу', () => {
    /* Метатег `frame-ancestors` игнорирует: без заголовка кошелёк
       можно поместить в невидимый кадр поверх чужой страницы,
       и подпись будет сделана по чужой кнопке. */
    expect(header('Content-Security-Policy')).toContain("frame-ancestors 'none'")
    expect(header('X-Frame-Options')).toBe('DENY')
  })

  it('оставляют доступ к камере и устройствам HID', () => {
    /* Камера читает ссылку подключения, HID разговаривает с аппаратным
       кошельком. Закрой их политика — обе возможности перестали бы
       работать молча. */
    const policy = header('Permissions-Policy')

    expect(policy).toContain('camera=(self)')
    expect(policy).toContain('hid=(self)')
  })

  it('закрывают то, чем кошелёк не пользуется', () => {
    const policy = header('Permissions-Policy')

    expect(policy).toContain('geolocation=()')
    expect(policy).toContain('microphone=()')
    expect(policy).toContain('payment=()')
  })

  it('требуют HTTPS надолго и для поддоменов', () => {
    /* Перехват первого обращения по HTTP подменяет страницу целиком,
       а страница и есть кошелёк. */
    const policy = header('Strict-Transport-Security')

    expect(policy).toContain('includeSubDomains')
    expect(policy).toContain('preload')
    expect(Number(/max-age=(\d+)/u.exec(policy)?.[1] ?? '0')).toBeGreaterThanOrEqual(31_536_000)
  })

  it('не передают адрес страницы чужим серверам', () => {
    expect(header('Referrer-Policy')).toBe('no-referrer')
  })

  it('запрещают угадывание типа содержимого', () => {
    expect(header('X-Content-Type-Options')).toBe('nosniff')
  })
})

describe('Файлы настройки размещения', () => {
  it('в `_headers` попадают все заголовки', () => {
    const file = buildNetlifyHeaders()

    for (const entry of buildSecurityHeaders()) {
      expect(file).toContain(`${entry.name}: ${entry.value}`)
    }
  })

  it('точка входа не хранится в кэше, а файлы сборки хранятся вечно', () => {
    /* Сохранённый надолго `index.html` оставил бы человека на прежней
       сборке — включая ту, из которой исправлена уязвимость. */
    const file = buildNetlifyHeaders()

    expect(file).toContain('/assets/*\n  Cache-Control: public, max-age=31536000, immutable')
    expect(file).toContain('/index.html\n  Cache-Control: no-cache')
  })

  it('в настройке nginx каждый заголовок помечен `always`', () => {
    /* Без этого слова заголовок не ставится на ответах с кодом ошибки,
       а страница ошибки — тоже страница. */
    const file = buildNginxSnippet()

    for (const line of file.split('\n').filter((entry) => entry.startsWith('add_header'))) {
      expect(line.endsWith('always;')).toBe(true)
    }
  })

  it('оба файла описывают одну и ту же политику', () => {
    /* Два списка, написанные руками, расходятся при первом изменении,
       и расхождение молчаливое. */
    const policy = header('Content-Security-Policy')

    expect(buildNetlifyHeaders()).toContain(policy)
    expect(buildNginxSnippet()).toContain(policy)
  })
})
