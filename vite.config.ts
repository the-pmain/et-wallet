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
  },

  build: {
    target: 'es2022',
    /* Source maps отключены в production: они упрощают анализ кода кошелька
       и увеличивают размер артефакта. Для отладки собирайте с `--sourcemap`. */
    sourcemap: false,
  },

  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,

    /* Только тесты расширения. Справочный сервис — отдельный пакет
       со своей средой: его тесты работают в Node, а не в jsdom,
       и запускаются командой `npm run server:verify`. Без этого
       ограничения корневой прогон подхватывал и исходники сервиса,
       и его собранный вывод в `server/dist`. */
    /* Код сборки включён наравне с приложением: политика безопасности
       и заголовки размещения живут там, а ошибка в них не видна
       ни при разработке, ни в сквозных проверках — только на боевом
       размещении. */
    include: ['src/**/*.test.{ts,tsx}', 'build/**/*.test.ts'],

    /*
      Предел времени на тест — 20 секунд.

      Значение по умолчанию (5 секунд) совпадало с порогом ожидания
      Testing Library, заданным в `src/test/setup.ts`. При таком равенстве
      тест обрывался ровно тогда, когда ожидание элемента ещё не истекло,
      и вместо понятного «элемент не найден» приходил бесполезный
      «тест превысил время». Общий предел обязан быть заметно больше
      предела отдельного ожидания.

      Сценарии экрана настроек последовательно разблокируют кошелёк,
      выводят ключи, поднимают сервисы и заполняют форму: в сумме это
      секунды даже на исправной машине.
    */
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/**/index.ts', 'src/vite-env.d.ts'],
    },
  },
})
