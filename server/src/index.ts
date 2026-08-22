import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildApp } from './app.ts'
import { loadConfig } from './config.ts'
import { createEmailsStore } from './emails/createEmailsStore.ts'
import { createUsersStore } from './users/createUsersStore.ts'

loadLocalEnv()

/**
 * Точка входа Node-процесса.
 *
 * Это тот же репозиторий, что и интерфейс кошелька: `npm start` из корня
 * поднимает Fastify, а он раздаёт `/v1` и собранный UI из `dist/`.
 *
 * ОШИБКА НАСТРОЙКИ ИЛИ КАТАЛОГА ОСТАНАВЛИВАЕТ ЗАПУСК. Сервис, поднявшийся
 * с испорченным каталогом, раздаёт неверные адреса контрактов всем
 * пользователям сразу; отказ при старте видит тот, кто разворачивает
 * сервис, и видит немедленно.
 */
async function main(): Promise<void> {
  const config = loadConfig()
  const usersStore = createUsersStore(config)
  const emailsStore = await createEmailsStore(config)
  const app = await buildApp({
    config,
    users: usersStore.users,
    usersKind: usersStore.kind,
    emails: emailsStore.emails,
    emailsStorageWarning: emailsStore.storageWarning,
  })

  app.addHook('onClose', async () => {
    await usersStore.close()
    await emailsStore.close()
  })

  /* Остановка по сигналу закрывает соединения, а не обрывает их:
     запрос, начатый до сигнала, обязан завершиться. */
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      app.log.info({ signal }, 'Остановка сервиса')

      void app.close().then(
        () => {
          process.exit(0)
        },
        (error: unknown) => {
          app.log.error({ err: error }, 'Ошибка при остановке')
          process.exit(1)
        },
      )
    })
  }

  await app.listen({ host: config.host, port: config.port })

  if (config.staticRoot !== null) {
    app.log.info({ staticRoot: config.staticRoot }, 'Интерфейс кошелька')
  }
}

main().catch((error: unknown) => {
  /* Журнал ещё не поднят: писать некуда, кроме потока ошибок. */
  console.error('Сервис не запустился:', error)
  process.exit(1)
})

/**
 * Читает корневой `.env`, затем `server/.env`, не затирая уже заданные
 * переменные.
 *
 * Vite забирает из `.env` только `VITE_*`. Остальное — для этого процесса.
 * `server/.env` оставлен, чтобы локальные секреты не пришлось переносить
 * в тот же файл, что и клиентские ключи.
 */
function loadLocalEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url))

  applyEnvFile(join(here, '../../.env'))
  applyEnvFile(join(here, '../.env'))
}

function applyEnvFile(path: string): void {
  if (!existsSync(path)) {
    return
  }

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const trimmed = line.trim()

    if (trimmed === '' || trimmed.startsWith('#')) {
      continue
    }

    const separator = trimmed.indexOf('=')

    if (separator <= 0) {
      continue
    }

    const key = trimmed.slice(0, separator).trim()
    let value = trimmed.slice(separator + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}
