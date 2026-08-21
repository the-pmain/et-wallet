import type { Plugin } from 'vite'

/**
 * Content-Security-Policy для production-сборки.
 *
 * Директивы намеренно узкие:
 * - `script-src 'self'`   — исполняется только код из бандла. Любой inline-скрипт,
 *                           внедрённый через XSS, будет заблокирован браузером.
 * - `object-src 'none'`   — запрет плагинов (Flash, PDF-embed и т. п.).
 * - `base-uri 'self'`     — защита от подмены базового URL (base-tag injection).
 *
 * `style-src` вынужденно содержит `'unsafe-inline'`: Radix UI и Tailwind-анимации
 * выставляют inline-стили через атрибут `style`. Это не даёт исполнения кода,
 * но при появлении CSS-инъекций стоит пересмотреть.
 *
 * `connect-src` ПО УМОЛЧАНИЮ РАЗРЕШАЕТ ЛЮБОЙ HTTPS, И ЭТО ОСОЗНАННЫЙ
 * ОБМЕН. Пользователь вправе указать собственный RPC-узел — адрес,
 * который на этапе сборки неизвестен. Перечень, составленный
 * из встроенных сетей, отменил бы эту возможность, а она и есть главная
 * защита приватности запросов: без своего узла оператор чужого видит
 * IP и все адреса владельца.
 *
 * РАЗМЕЩАЮЩИЙ ВПРАВЕ РЕШИТЬ ИНАЧЕ. Переменная сборки
 * `VITE_CSP_CONNECT_SRC` задаёт перечень источников явно — например
 * для размещения, где своим узлом пользоваться не предполагают, и
 * запрет обращений к произвольным адресам ценнее. Выбор делает тот, кто
 * раздаёт сборку, потому что последствия несёт он.
 *
 * `https:` покрывает и `wss:`: по спецификации CSP схема `https`
 * соответствует защищённым веб-сокетам. Отдельная запись не нужна,
 * и её отсутствие не означает, что WalletConnect запрещён.
 */

/** Источники соединений по умолчанию. */
const DEFAULT_CONNECT_SRC = "'self' https:"

/** Собирает политику с заданными источниками соединений. */
export function buildContentSecurityPolicy(connectSrc: string = DEFAULT_CONNECT_SRC): string {
  return [
    "default-src 'self'",
    "script-src 'self' https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    /* blob: — предпросмотр письма в iframe без srcDoc (Trusted Types). */
    "frame-src blob:",
    /*
    Воркеров у приложения нет. Разрешение `blob:` позволяло бы запустить
    в воркере код, собранный из строки, — обход `script-src 'self'`,
    ради которого политика и существует.
  */
    "worker-src 'none'",
    /* Приложение не встраивает чужие страницы. blob: нужен тому же
     предпросмотру письма, что и frame-src. */
    "child-src blob:",
    "media-src 'none'",
    "manifest-src 'self'",
    /*
    Trusted Types запрещают присваивание строк в места, ведущие
    к исполнению кода: `innerHTML`, `src` скрипта, `eval`. Правило ESLint
    против `innerHTML` работает на нашем коде; эта директива действует
    и на зависимости, включая те, что появятся позже.

    Политика `dompurify` не объявлена намеренно: очистителя разметки
    в приложении нет, и разрешать его заранее значило бы открывать путь,
    которым никто не пользуется.
  */
    "require-trusted-types-for 'script'",
    'upgrade-insecure-requests',
  ].join('; ')
}

/**
 * Внедряет meta-тег CSP в index.html только при production-сборке.
 *
 * Почему только в production: dev-сервер Vite использует inline-скрипты и
 * WebSocket для HMR — строгая политика ломает разработку. Разделение по
 * командам позволяет держать боевую политику строгой без ущерба для DX.
 *
 * ВАЖНО: meta-тег не поддерживает директивы `frame-ancestors` и `report-*`.
 * Защита от кликджекинга должна дублироваться HTTP-заголовками на стороне
 * хостинга (`Content-Security-Policy`, `X-Frame-Options: DENY`).
 */
export function cspPlugin(): Plugin {
  return {
    name: 'wallet:csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      handler() {
        /* Пустое значение переменной означает «не задано», а не «запретить
           всё»: пустой `connect-src` отрезал бы кошелёк от любых узлов,
           и заметить это можно было бы только после размещения. */
        const configured = process.env['VITE_CSP_CONNECT_SRC']?.trim()
        return [
          {
            tag: 'meta',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content: buildContentSecurityPolicy(
                configured === undefined || configured === '' ? undefined : configured,
              ),
            },
            injectTo: 'head-prepend' as const,
          },
        ]
      },
    },
  }
}
