import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'

import { registerCatalogRoutes } from './api/catalog.routes.ts'
import { registerNotificationRoutes } from './api/notifications.routes.ts'
import { registerSettingsRoutes } from './api/settings.routes.ts'
import { registerUserRoutes } from './api/users.routes.ts'
import { registerVersionRoutes } from './api/version.routes.ts'
import { CatalogService } from './catalog/CatalogService.ts'
import { RUNTIME_MODE, type IServerConfig } from './config.ts'
import { ApiError } from './lib/errors.ts'
import { isApiUrl } from './lib/ui.ts'
import { registerSecretGuard } from './plugins/secret-guard.ts'
import { registerSecurity } from './plugins/security.ts'
import { registerUi, sendWalletIndex } from './plugins/ui.ts'
import { MemorySettingsRepository } from './settings/MemorySettingsRepository.ts'
import type { ISettingsRepository } from './settings/contracts.ts'
import { MemoryUsersRepository } from './users/MemoryUsersRepository.ts'
import { USERS_STORE_KIND, type IUsersRepository, type UsersStoreKind } from './users/contracts.ts'

/**
 * Зависимости приложения.
 *
 * Внедряются, а не создаются внутри: тест обязан уметь подставить
 * свой каталог и своё хранилище, не поднимая ни сети, ни базы.
 */
export interface IAppDependencies {
  readonly config: IServerConfig
  readonly catalog?: CatalogService
  readonly settings?: ISettingsRepository
  readonly users?: IUsersRepository
  readonly usersKind?: UsersStoreKind
}

/**
 * Поля запроса, попадающие в журнал.
 *
 * ПЕРЕЧЕНЬ РАЗРЕШАЮЩИЙ, А НЕ ЗАПРЕЩАЮЩИЙ. Список того, что скрывать,
 * приходится пополнять при каждом новом поле, и однажды кто-нибудь
 * забудет. Список того, что записывать, при появлении нового поля
 * просто не растёт.
 *
 * ТЕЛА ЗАПРОСОВ НЕ ЖУРНАЛИРУЮТСЯ ВООБЩЕ. Единственное тело в сервисе —
 * шифротекст настроек; журнал, полный чужих шифротекстов, ничем
 * не помогает и остаётся мишенью.
 */
function requestSerializer(request: {
  readonly method: string
  readonly url: string
  readonly routeOptions?: { readonly url?: string | undefined }
}) {
  return {
    method: request.method,
    /* Записывается шаблон маршрута, а не конкретный адрес: путь
       синхронизации содержит идентификатор, а он — ключ-предъявитель.
       Идентификатор в журнале равносилен розданному ключу. */
    route: request.routeOptions?.url ?? request.url.split('?')[0],
  }
}

/**
 * Собирает приложение.
 *
 * ПОРЯДОК РЕГИСТРАЦИИ ЗНАЧИМ. Защитная обвязка и охранник входящих
 * данных встают до маршрутов: иначе запрос успел бы дойти до обработчика
 * раньше проверки.
 */
export async function buildApp(dependencies: IAppDependencies): Promise<FastifyInstance> {
  const { config } = dependencies

  const app = Fastify({
    logger: {
      level: config.mode === RUNTIME_MODE.Test ? 'silent' : 'info',
      serializers: { req: requestSerializer },
    },
    bodyLimit: config.maxBodyBytes,
    ajv: {
      customOptions: {
        /* Fastify по умолчанию ВЫРЕЗАЕТ поля, не описанные схемой,
           и продолжает обработку. Для этого сервиса такое поведение
           недопустимо: клиент, отправивший лишнее поле, получил бы
           ответ «принято» и решил, что сервис его понял. Запрос,
           не соответствующий схеме, обязан быть отвергнут целиком. */
        removeAdditional: false,

        /* Приведение типов так же молча меняет смысл: строка «0»
           превратилась бы в число, а номер версии записи — величина,
           от которой зависит, будут ли затёрты чужие изменения. */
        coerceTypes: false,
      },
    },
    /* Идентификатор запроса не выводится из адреса клиента: он попадает
       в ответ, а адрес пользователя в ответе — это сведения о нём,
       разосланные всем, кто ответ увидит. */
    genReqId: () => crypto.randomUUID(),
    trustProxy: config.mode === RUNTIME_MODE.Production,
  })

  await registerSecurity(app, config)
  registerSecretGuard(app)

  /* Каталог проверяется в конструкторе: сервис с испорченным каталогом
     обязан не подняться, а не начать раздавать неверные адреса. */
  const catalog = dependencies.catalog ?? new CatalogService()
  const settings = dependencies.settings ?? new MemorySettingsRepository()
  const users = dependencies.users ?? new MemoryUsersRepository()
  const usersKind = dependencies.usersKind ?? USERS_STORE_KIND.Memory

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ApiError) {
      void reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message },
      })

      return
    }

    /* Отказ проверки схемы — ошибка клиента, и её причину сказать можно:
       она относится к форме запроса, а не к устройству сервиса. */
    if (error.validation !== undefined) {
      void reply.status(400).send({
        error: { code: 'invalid_request', message: 'Запрос не соответствует схеме.' },
      })

      return
    }

    /* Всё остальное наружу не выходит. Сообщение неожиданной ошибки
       содержит пути файлов и имена внутренних модулей: это помогает
       нападающему и ничем не помогает пользователю. */
    request.log.error({ err: error }, 'Необработанная ошибка')

    void reply.status(500).send({
      error: { code: 'internal_error', message: 'Внутренняя ошибка сервиса.' },
    })
  })

  app.get('/v1/health', () => ({ status: 'ok', users: usersKind }))

  registerCatalogRoutes(app, catalog, config)
  registerNotificationRoutes(app, catalog)
  registerVersionRoutes(app, catalog)
  registerSettingsRoutes(app, settings, config)
  registerUserRoutes(app, users)

  if (config.staticRoot !== null) {
    await registerUi(app, config.staticRoot)
  }

  app.setNotFoundHandler((request, reply) => {
    if (
      config.staticRoot !== null &&
      request.method === 'GET' &&
      !isApiUrl(request.url)
    ) {
      void sendWalletIndex(config.staticRoot, request, reply)

      return
    }

    void reply.status(404).send({
      error: { code: 'not_found', message: 'Маршрут не существует.' },
    })
  })

  /* Экземпляр Fastify — thenable: ожидание его завершает регистрацию
     плагинов. Явное `await` делает это видимым, а не полагается на то,
     что возврат из async-функции сделает то же самое неявно. */
  return await app
}
