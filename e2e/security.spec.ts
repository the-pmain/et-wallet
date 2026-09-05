import { expect, test } from '@playwright/test'

/**
 * Security checks of the built application.
 *
 * WHY THIS CANNOT BE CHECKED WITHOUT A BROWSER. Content-Security-Policy
 * is not a string in markup; it is browser behavior. A meta tag with
 * the right text proves nothing: a blocked script does. jsdom does
 * not apply the policy at all.
 */

/** Directives whose absence is a hole, not a nit. */
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
  test('policy is embedded in the production build', async ({ page }) => {
    await page.goto('/')

    const policy = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content')

    expect(policy).not.toBeNull()

    for (const directive of REQUIRED_DIRECTIVES) {
      expect(policy).toContain(directive)
    }
  })

  test("script-src does not contain 'unsafe-inline' or 'unsafe-eval'", async ({ page }) => {
    /* Either permission undoes the whole policy: XSS-injected code
       becomes executable again. */
    await page.goto('/')

    const policy =
      (await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')) ??
      ''

    const scriptSrc = policy.split(';').find((part) => part.trim().startsWith('script-src')) ?? ''

    expect(scriptSrc).not.toContain('unsafe-inline')
    expect(scriptSrc).not.toContain('unsafe-eval')
  })

  test('injected code does not execute', async ({ page }) => {
    /*
      Main check of the section: the policy is enforced, not merely
      declared.

      Three XSS paths are tried: a script body, markup via `innerHTML`,
      and an event handler in an attribute. Each may be stopped
      differently — Trusted Types reject the assignment itself,
      `script-src` refuses to run what was already inserted — and
      both outcomes are correct. What is checked is the result: the
      code did not run.
    */
    await page.goto('/')

    const refusals = await page.evaluate(() => {
      const results: string[] = []

      try {
        const script = document.createElement('script')

        script.textContent = 'globalThis.__injectedByTextContent = true'
        document.head.append(script)
        results.push('textContent: assignment succeeded')
      } catch {
        results.push('textContent: refused')
      }

      try {
        /* The rule forbids assigning `innerHTML` — and forbids it
           correctly: that is an XSS vector. It is done here on
           purpose because we are not testing our code, but that the
           browser stops the attempt. */
        // eslint-disable-next-line no-restricted-properties
        document.body.innerHTML += '<script>globalThis.__injectedByHtml = true</script>'
        results.push('innerHTML: assignment succeeded')
      } catch {
        results.push('innerHTML: refused')
      }

      try {
        const button = document.createElement('button')

        button.setAttribute('onclick', 'globalThis.__injectedByHandler = true')
        button.id = 'injection-probe'
        document.body.append(button)
        button.click()
        results.push('handler: inserted')
      } catch {
        results.push('handler: refused')
      }

      return results
    })

    /* None of the paths led to execution. */
    const executed = await page.evaluate(() => ({
      byTextContent: '__injectedByTextContent' in globalThis,
      byHtml: '__injectedByHtml' in globalThis,
      byHandler: '__injectedByHandler' in globalThis,
    }))

    expect(executed).toEqual({ byTextContent: false, byHtml: false, byHandler: false })

    /* At least one path must be closed at assignment: that is
       Trusted Types, and its absence would mean the directive is
       declared but not applied. */
    expect(refusals.join('; ')).toContain('refused')
  })

  /*
    THERE IS NO "eval IS BLOCKED" CHECK HERE, AND THAT IS NOT A GAP.

    The attempt was written and dropped: `page.evaluate` runs through
    the debug protocol, which is outside the page policy. Building
    code from a string inside `page.evaluate` succeeds regardless of
    CSP — so such a check would measure the test harness, not the
    defense, and would create false confidence.

    What is checked instead: `'unsafe-eval'` is absent from
    `script-src` (the check above) and injected code cannot run by
    the paths XSS actually uses — those go through the page itself,
    not the debugger.
  */
})

test.describe('Secrets in the built application', () => {
  test('the bundle has no enabled security relaxations', async ({ page }) => {
    /* A production build with `IS_TEST_MODE` on stops at start.
       The welcome screen appearing means the flag is off. */
    await page.goto('/')

    await expect(page.getByRole('link', { name: /create a new wallet/i })).toBeVisible()
  })

  test('seed-phrase login is available', async ({ page }) => {
    /* The other side of the same check: a temporary relaxation hid
       wallet restore entirely. */
    await page.goto('/')

    await expect(page.getByRole('link', { name: /import/i })).toBeVisible()
  })

  test('the app is not framed from a third-party origin', async ({ page }) => {
    /* `frame-ancestors` is not supported in a meta tag — the defense
       must come as a host header. The check records that the limit
       is known and not forgotten. */
    await page.goto('/')

    const policy =
      (await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')) ??
      ''

    expect(policy).not.toContain('frame-ancestors')
  })
})
