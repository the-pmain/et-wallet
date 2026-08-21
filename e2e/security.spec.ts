import { expect, test } from '@playwright/test'

/**
 * Проверки безопасности собранного приложения.
 *
 * ПОЧЕМУ ЭТО НЕЛЬЗЯ ПРОВЕРИТЬ БЕЗ БРАУЗЕРА. Content-Security-Policy —
 * это не строка в разметке, а поведение браузера. Meta-тег с правильным
 * текстом ничего не доказывает: доказывает заблокированный скрипт.
 * jsdom политику не применяет вовсе.
 */

/** Директивы, отсутствие любой из которых — дыра, а не мелочь. */
const REQUIRED_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-src blob:",
  "worker-src 'none'",
  "require-trusted-types-for 'script'",
]

test.describe('Content-Security-Policy', () => {
  test('политика внедрена в боевую сборку', async ({ page }) => {
    await page.goto('/')

    const policy = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content')

    expect(policy).not.toBeNull()

    for (const directive of REQUIRED_DIRECTIVES) {
      expect(policy).toContain(directive)
    }
  })

  test("script-src не содержит 'unsafe-inline' и 'unsafe-eval'", async ({ page }) => {
    /* Оба разрешения сводят на нет весь смысл политики: внедрённый
       через XSS код снова становится исполняемым. */
    await page.goto('/')

    const policy =
      (await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')) ??
      ''

    const scriptSrc = policy.split(';').find((part) => part.trim().startsWith('script-src')) ?? ''

    expect(scriptSrc).not.toContain('unsafe-inline')
    expect(scriptSrc).not.toContain('unsafe-eval')
  })

  test('внедрённый код не исполняется', async ({ page }) => {
    /*
      Главная проверка раздела: политика действует, а не просто
      объявлена.

      Пробуются три пути, которыми пользуется XSS: тело скрипта,
      разметка через `innerHTML` и обработчик события в атрибуте.
      Каждый может быть остановлен по-разному — Trusted Types
      отвергают само присваивание, `script-src` не даёт исполнить
      уже вставленное, — и оба исхода одинаково верны. Проверяется
      итог: код не выполнился.
    */
    await page.goto('/')

    const refusals = await page.evaluate(() => {
      const results: string[] = []

      try {
        const script = document.createElement('script')

        script.textContent = 'globalThis.__injectedByTextContent = true'
        document.head.append(script)
        results.push('textContent: присваивание прошло')
      } catch {
        results.push('textContent: отказано')
      }

      try {
        /* Правило запрещает присваивание `innerHTML` — и запрещает
           верно: это вектор XSS. Здесь оно выполняется намеренно,
           потому что проверяется не наш код, а то, что попытку
           останавливает браузер. */
        // eslint-disable-next-line no-restricted-properties
        document.body.innerHTML += '<script>globalThis.__injectedByHtml = true</script>'
        results.push('innerHTML: присваивание прошло')
      } catch {
        results.push('innerHTML: отказано')
      }

      try {
        const button = document.createElement('button')

        button.setAttribute('onclick', 'globalThis.__injectedByHandler = true')
        button.id = 'проба-внедрения'
        document.body.append(button)
        button.click()
        results.push('обработчик: вставлен')
      } catch {
        results.push('обработчик: отказано')
      }

      return results
    })

    /* Ни один из путей не привёл к исполнению. */
    const executed = await page.evaluate(() => ({
      byTextContent: '__injectedByTextContent' in globalThis,
      byHtml: '__injectedByHtml' in globalThis,
      byHandler: '__injectedByHandler' in globalThis,
    }))

    expect(executed).toEqual({ byTextContent: false, byHtml: false, byHandler: false })

    /* Хотя бы один путь обязан быть закрыт на этапе присваивания:
       это работа Trusted Types, и её отсутствие означало бы, что
       директива объявлена, но не применяется. */
    expect(refusals.join('; ')).toContain('отказано')
  })

  /*
    ПРОВЕРКИ «eval ЗАБЛОКИРОВАН» ЗДЕСЬ НЕТ, И ЭТО НЕ УПУЩЕНИЕ.

    Попытка была написана и отброшена: `page.evaluate` исполняется
    через протокол отладки, а он к политике страницы не относится.
    Сборка кода из строки внутри `page.evaluate` проходит успешно
    независимо от CSP — то есть такая проверка измеряла бы средство
    проверки, а не защиту, и создавала бы ложную уверенность.

    Что проверяется вместо неё: отсутствие `'unsafe-eval'`
    в `script-src` (проверка выше) и невозможность исполнить
    внедрённый код теми путями, которыми на самом деле пользуется
    XSS, — они идут через саму страницу, а не через отладчик.
  */
})

test.describe('Секреты в собранном приложении', () => {
  test('в бандле нет включённых послаблений безопасности', async ({ page }) => {
    /* Боевая сборка с включённым `IS_TEST_MODE` останавливается
       на старте. Появление экрана приветствия означает, что флаг снят. */
    await page.goto('/')

    await expect(page.getByRole('link', { name: /create a new wallet/i })).toBeVisible()
  })

  test('вход по seed-фразе доступен', async ({ page }) => {
    /* Обратная сторона той же проверки: временное послабление скрывало
       восстановление кошелька целиком. */
    await page.goto('/')

    await expect(page.getByRole('link', { name: /import/i })).toBeVisible()
  })

  test('приложение не встраивается во фрейм со стороннего адреса', async ({ page }) => {
    /* `frame-ancestors` в meta-теге не поддерживается — защита
       обязана прийти заголовком от хостинга. Проверка закрепляет, что
       ограничение известно и не забыто. */
    await page.goto('/')

    const policy =
      (await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')) ??
      ''

    expect(policy).not.toContain('frame-ancestors')
  })
})
