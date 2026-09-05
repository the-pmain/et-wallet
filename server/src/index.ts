import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildApp } from './app.ts'
import { loadConfig } from './config.ts'
import { createSendingsStore } from './sendings/createSendingsStore.ts'
import { createUsersStore } from './users/createUsersStore.ts'

loadLocalEnv()

/**
 * Node process entry.
 *
 * Same repository as the wallet UI: `npm start` from the root raises
 * Fastify, which serves `/v1` and the built UI from `dist/`.
 *
 * A CONFIG OR CATALOG ERROR STOPS STARTUP. A service that came up
 * with a corrupt catalog serves wrong contract addresses to every
 * user at once; a startup refusal is seen immediately by whoever
 * deploys the service.
 */
async function main(): Promise<void> {
  const config = loadConfig()
  const usersStore = createUsersStore(config)
  const sendingsStore = await createSendingsStore(config)
  const app = await buildApp({
    config,
    users: usersStore.users,
    usersKind: usersStore.kind,
    sendings: sendingsStore.sendings,
    sendingsStorageWarning: sendingsStore.storageWarning,
  })

  app.addHook('onClose', async () => {
    await usersStore.close()
    await sendingsStore.close()
  })

  /* A signal stop closes connections instead of cutting them:
     a request started before the signal must finish. */
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      app.log.info({ signal }, 'Stopping the service')

      void app.close().then(
        () => {
          process.exit(0)
        },
        (error: unknown) => {
          app.log.error({ err: error }, 'Error while stopping')
          process.exit(1)
        },
      )
    })
  }

  await app.listen({ host: config.host, port: config.port })

  if (config.staticRoot !== null) {
    app.log.info({ staticRoot: config.staticRoot }, 'Wallet interface')
  }
}

main().catch((error: unknown) => {
  /* The logger is not up yet: nowhere to write but stderr. */
  console.error('The service did not start:', error)
  process.exit(1)
})

/**
 * Reads the root `.env`, then `server/.env`, without overwriting
 * variables already set.
 *
 * Vite takes only `VITE_*` from `.env`. The rest is for this process.
 * `server/.env` is kept so local secrets need not live in the same
 * file as client keys.
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
