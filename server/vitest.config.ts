import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    /* Среда Node: сервис не знает о DOM и не должен от него зависеть. */
    environment: 'node',
    include: ['src/**/*.test.ts'],
    /* Тесты поднимают приложение через `inject`, без сети: режим `test`
       глушит журнал, иначе вывод тонет в служебных строках. */
    env: { NODE_ENV: 'test' },
  },
})
