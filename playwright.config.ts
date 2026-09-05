import { defineConfig, devices } from '@playwright/test'

/**
 * Port where `vite preview` serves the built app.
 *
 * Different from the default `vite preview` port (4173): the suite must
 * still run when a preview tab is already open by hand. Sharing the port
 * would turn a forgotten tab into an unexplained failure of the whole set.
 */
const PORT = 4190

/**
 * End-to-end check setup.
 *
 * THE BUILT APP IS CHECKED, NOT THE DEV SERVER. That is the only way to
 * catch a class of defects that unit tests and jsdom cannot see:
 *
 * - wrong unused-code stripping. `"sideEffects"` in `package.json` lets
 *   the bundler drop modules; a mistake here shows up only in the build;
 * - chunk splitting. A screen whose chunk failed to load looks fine in
 *   jsdom: there `import()` resolves immediately and locally;
 * - CSP. The policy is injected only into the production build and only
 *   takes effect in a real browser. A meta tag in the markup proves
 *   nothing — a script the browser blocked does.
 *
 * RUN AS A SEPARATE COMMAND, NOT INSIDE `npm run verify`. End-to-end
 * checks need a build and a downloaded browser (~115 MB) — they cannot
 * live in a check that must pass in a minute with no network.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,

  /*
    Concurrent browsers are capped on purpose.

    Each check unlocks the wallet — two key derivations of 600,000
    PBKDF2 iterations, expensive BY DESIGN: that is what resists
    password guessing. A dozen of those at once saturates the CPU,
    and checks start failing on timeouts that have nothing to do
    with the wallet.
  */
  workers: 2,

  /*
    The wait is longer than the default for the same reason.
    Five seconds by default is for a paint; here key derivation
    sits between the click and the screen.
  */
  expect: { timeout: 20_000 },

  /* No retries: a rerun hides flakiness instead of showing it.
     For a wallet a flaky check is worse than a failing one —
     it trains people not to look at the result. */
  retries: 0,

  reporter: [['list']],

  use: {
    baseURL: `http://localhost:${String(PORT)}`,

    /*
      Browser language is pinned.

      The app picks its language from the browser, and Chromium
      defaults to English. Without a pin the suite would test the
      machine locale, not the wallet: the same checks on another
      machine would look for different labels. The same pin is
      used in the unit-test environment — see `src/test/setup.ts`.
    */
    locale: 'ru-RU',
    /* A trace is kept only for a failed check: it is heavy and
       holds the full page markup. */
    trace: 'retain-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    /* The build runs here: checking a previous build means
       checking code that is not the one being edited. */
    command: `npm run build && npm run preview -- --port ${String(PORT)} --strictPort`,
    url: `http://localhost:${String(PORT)}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
