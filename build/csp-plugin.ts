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
 * `connect-src` РАЗРЕШАЕТ ЛЮБОЙ HTTPS, И СУЗИТЬ ЕГО НЕЛЬЗЯ. Пользователь
 * вправе указать собственный RPC-узел — адрес, который на этапе сборки
 * неизвестен. Перечень, составленный из встроенных сетей, отменил бы
 * эту возможность, а она и есть главная защита приватности запросов.
 * Ограничение снимаемо только заголовком от хостинга, формируемым
 * с учётом пользовательских адресов; для meta-тега оно недостижимо.
 */
const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-src 'none'",
  /*
    Воркеров у приложения нет. Разрешение `blob:` позволяло бы запустить
    в воркере код, собранный из строки, — обход `script-src 'self'`,
    ради которого политика и существует.
  */
  "worker-src 'none'",
  /* Приложение не встраивает ничего и ничего не проигрывает. Директивы
     закрыты явно: `default-src` покрывает не все типы ресурсов. */
  "child-src 'none'",
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
        return [
          {
            tag: 'meta',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content: PRODUCTION_CSP,
            },
            injectTo: 'head-prepend' as const,
          },
        ]
      },
    },
  }
}
