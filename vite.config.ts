/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { cspPlugin } from './build/csp-plugin'
import { ROBOTS_TAG_VALUE, securityHeadersPlugin } from './build/security-headers-plugin'
import packageJson from './package.json' with { type: 'json' }

/** Dev-server port. Fixed so the app URL is predictable. */
const DEV_SERVER_PORT = 3000

/**
 * Preview port for the built app.
 *
 * SET FROM THE ENVIRONMENT, NOT HARD-CODED. Preview is a helper: it
 * serves static files and is not bound to any particular port. No
 * sign-in callbacks, webhooks, or allow-lists point at it.
 *
 * The port used to be unset, and `vite preview` took its default 4173.
 * When another process already held that port, the whole launch failed
 * — even though any free port would have worked.
 *
 * Playwright checks never read this: they pass their own port on the
 * command line, which outranks the value in the config.
 */
const PREVIEW_PORT =
  process.env.PORT === undefined || process.env.PORT === ''
    ? null
    : Number.parseInt(process.env.PORT, 10)

export default defineConfig({
  plugins: [react(), tailwindcss(), cspPlugin(), securityHeadersPlugin()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  define: {
    /* App version is inlined at build time so the UI never reads package.json. */
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },

  server: {
    port: DEV_SERVER_PORT,
    strictPort: true,
    headers: {
      'X-Robots-Tag': ROBOTS_TAG_VALUE,
    },
    proxy: {
      /* Wallet create/import and POST /v1/users/auth in dev. */
      '/v1': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        timeout: 0,
        configure(proxy) {
          proxy.on('proxyRes', (proxyRes, req) => {
            const path = (req.url ?? '').split('?')[0]
            if (path === '/v1/sendings') {
              proxyRes.headers['cache-control'] = 'no-store, no-transform'
              proxyRes.headers['x-accel-buffering'] = 'no'
            }
          })
        },
      },
    },
  },

  preview: {
    /* Strict only when a port is assigned from outside: quietly sliding
       to a neighbour after an explicit assignment would serve the app
       at an address nobody expects. With no assignment, Vite's default
       remains. */
    ...(PREVIEW_PORT === null ? {} : { port: PREVIEW_PORT, strictPort: true }),
    headers: {
      'X-Robots-Tag': ROBOTS_TAG_VALUE,
    },
  },

  build: {
    target: 'es2022',
    /* Source maps are off in production: they make wallet code easier
       to analyse and grow the artefact. Build with `--sourcemap` to debug. */
    sourcemap: false,
  },

  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/**/index.ts', 'src/vite-env.d.ts'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'wallet',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./src/test/setup.ts'],
          css: false,
          include: ['src/**/*.test.{ts,tsx}', 'build/**/*.test.ts'],
          /*
            Per-test limit is 20 seconds.

            The default (5 seconds) matched the Testing Library wait
            threshold in `src/test/setup.ts`. When they were equal, the
            test aborted at the same moment the element wait had not
            yet expired, and instead of a clear "element not found" we
            got a useless "test timed out". The overall limit must be
            well above any single wait.
          */
          testTimeout: 20_000,
        },
      },
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['server/src/**/*.test.ts'],
          env: { NODE_ENV: 'test' },
        },
      },
    ],
  },
})
