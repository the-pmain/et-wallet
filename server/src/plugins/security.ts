import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import type { FastifyInstance } from 'fastify'

import { RUNTIME_MODE, type IServerConfig } from '../config.ts'
import { API_CONTENT_SECURITY_POLICY, isApiUrl } from '../lib/ui.ts'

/**
 * Защитная обвязка.
 *
 * ЗАГОЛОВКИ. JSON (`/v1`) не должен исполняться как страница:
 * `Content-Security-Policy` для этих ответов запрещает всё.
 * Страница кошелька, если она раздаётся с того же процесса, получает
 * отдельную политику в `plugins/ui.ts` — иначе бандл не запустится.
 *
 * ОГРАНИЧЕНИЕ ЧАСТОТЫ. Справочный сервис без ограничения ложится
 * от одного скрипта. Статика кошелька в лимит не входит: иначе
 * загрузка бандла сожгла бы квоту API.
 *
 * CORS. Для чтения каталога это не защита — данные и так публичны, —
 * а ограничение поверхности. Существенно другое: сервис не пользуется
 * cookie и заголовком авторизации, поэтому браузер не подставляет
 * к запросу никаких неявных полномочий, и подделка запроса
 * со стороннего сайта ничего не даёт.
 */
export async function registerSecurity(app: FastifyInstance, config: IServerConfig): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: false,
    /* По умолчанию `SAMEORIGIN`, то есть встраивание с того же источника
       разрешено. Ни JSON, ни кошелёк не должны показываться в рамке. */
    xFrameOptions: { action: 'deny' },
    crossOriginResourcePolicy: false,
  })

  app.addHook('onSend', async (request, reply) => {
    if (isApiUrl(request.url)) {
      void reply.header('content-security-policy', API_CONTENT_SECURITY_POLICY)
      void reply.header('cross-origin-resource-policy', 'cross-origin')
    }
  })

  await app.register(cors, {
    origin:
      config.allowedOrigins.length === 0 && config.mode !== RUNTIME_MODE.Production
        ? true
        : [...config.allowedOrigins],
    /* PATCH нужен кабинету администратора: смена баланса и `wallets`
       идёт методом частичного обновления, а не полной заменой записи. */
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Accept', 'Content-Type', 'x-admin-pin', 'x-email-manager-pin'],
    /* Полномочия не передаются: ни cookie, ни заголовка авторизации
       сервис не использует. Разрешить их значило бы дать браузеру
       подставлять к запросам то, о чём пользователь не знает. */
    credentials: false,
    maxAge: 600,
  })

  await app.register(rateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.windowMs,
    allowList: (request) => !isApiUrl(request.url),
    /* Ответ об ограничении не рассказывает, кто и сколько потратил:
       это сведения о других пользователях того же адреса. */
    errorResponseBuilder: () => ({
      error: {
        code: 'rate_limited',
        message: 'Слишком много запросов. Повторите позже.',
      },
    }),
  })
}
