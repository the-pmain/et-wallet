/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { cspPlugin } from './build/csp-plugin'
import { securityHeadersPlugin } from './build/security-headers-plugin'
import packageJson from './package.json' with { type: 'json' }

/** Порт dev-сервера. Фиксирован, чтобы адрес приложения был предсказуем. */
const DEV_SERVER_PORT = 3000

/**
 * Порт предпросмотра собранного приложения.
 *
 * ЗАДАЁТСЯ ОКРУЖЕНИЕМ, А НЕ ЖЁСТКО. Предпросмотр — вспомогательная
 * вещь: он раздаёт статические файлы и ни к какому конкретному порту
 * не привязан. Ни обратных вызовов входа, ни вебхуков, ни списков
 * разрешённых источников на него не заведено.
 *
 * Раньше порт не задавался вовсе, и `vite preview` брал своё
 * умолчание 4173. Занятый другим процессом, он ронял запуск целиком —
 * при том что подошёл бы любой свободный.
 *
 * Проверки Playwright сюда не заглядывают: они передают свой порт
 * ключом командной строки, а он старше значения из настроек.
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
    /* Версия приложения попадает в бандл на этапе сборки, чтобы UI не читал package.json. */
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },

  server: {
    port: DEV_SERVER_PORT,
    strictPort: true,
    proxy: {
      /* Wallet create/import and the mock POST /v1/users in dev. */
      '/v1': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },

  preview: {
    /* Строгость только тогда, когда порт назначен снаружи: тихо уехать
       на соседний порт после явного назначения — значит отдать
       приложение по адресу, которого никто не ждёт. Без назначения
       остаётся поведение Vite по умолчанию. */
    ...(PREVIEW_PORT === null ? {} : { port: PREVIEW_PORT, strictPort: true }),
  },

  build: {
    target: 'es2022',
    /* Source maps отключены в production: они упрощают анализ кода кошелька
       и увеличивают размер артефакта. Для отладки собирайте с `--sourcemap`. */
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
            Предел времени на тест — 20 секунд.

            Значение по умолчанию (5 секунд) совпадало с порогом ожидания
            Testing Library, заданным в `src/test/setup.ts`. При таком равенстве
            тест обрывался ровно тогда, когда ожидание элемента ещё не истекло,
            и вместо понятного «элемент не найден» приходил бесполезный
            «тест превысил время». Общий предел обязан быть заметно больше
            предела отдельного ожидания.
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
