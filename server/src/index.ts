import { buildApp } from './app.ts'
import { loadConfig } from './config.ts'

/**
 * Точка входа.
 *
 * ОШИБКА НАСТРОЙКИ ИЛИ КАТАЛОГА ОСТАНАВЛИВАЕТ ЗАПУСК. Сервис, поднявшийся
 * с испорченным каталогом, раздаёт неверные адреса контрактов всем
 * пользователям сразу; отказ при старте видит тот, кто разворачивает
 * сервис, и видит немедленно.
 */
async function main(): Promise<void> {
  const config = loadConfig()
  const app = await buildApp({ config })

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
}

main().catch((error: unknown) => {
  /* Журнал ещё не поднят: писать некуда, кроме потока ошибок. */
  console.error('Сервис не запустился:', error)
  process.exit(1)
})
