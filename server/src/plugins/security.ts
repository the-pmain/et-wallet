import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import type { FastifyInstance } from 'fastify'

import { RUNTIME_MODE, type IServerConfig } from '../config.ts'

/**
 * Защитная обвязка.
 *
 * ЗАГОЛОВКИ. Сервис отдаёт только JSON и не должен исполняться
 * в браузере как страница: `Content-Security-Policy` запрещает всё,
 * `X-Frame-Options` — встраивание, `X-Content-Type-Options` — угадывание
 * типа. Ответ JSON, истолкованный браузером как HTML, — известный путь
 * к исполнению чужого кода.
 *
 * ОГРАНИЧЕНИЕ ЧАСТОТЫ. Справочный сервис без ограничения ложится
 * от одного скрипта. Отдельно и жёстче ограничивается синхронизация
 * настроек: у неё есть запись, а значит и стоимость.
 *
 * CORS. Для чтения каталога это не защита — данные и так публичны, —
 * а ограничение поверхности. Существенно другое: сервис не пользуется
 * cookie и заголовком авторизации, поэтому браузер не подставляет
 * к запросу никаких неявных полномочий, и подделка запроса
 * со стороннего сайта ничего не даёт.
 */
export async function registerSecurity(app: FastifyInstance, config: IServerConfig): Promise<void> {
  await app.register(helmet, {
    /* Сервис не отдаёт разметку. Политика запрещает всё: если ответ
       когда-нибудь окажется истолкован как страница, исполнять
       в ней будет нечего. */
    contentSecurityPolicy: {
      /* Директивы по умолчанию НЕ подмешиваются. Они рассчитаны
         на сайт: разрешают `script-src 'self'`, шрифты, изображения
         и `'unsafe-inline'` для стилей. Сервису, отдающему только JSON,
         не нужно ничего из этого, а разрешение, которого никто
         не запрашивал, — это разрешение, о котором никто не помнит. */
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    /* По умолчанию `SAMEORIGIN`, то есть встраивание с того же источника
       разрешено. Сервису нечего показывать в рамке ни при каких условиях. */
    xFrameOptions: { action: 'deny' },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })

  await app.register(cors, {
    origin:
      config.allowedOrigins.length === 0 && config.mode !== RUNTIME_MODE.Production
        ? true
        : [...config.allowedOrigins],
    methods: ['GET', 'PUT', 'DELETE', 'OPTIONS'],
    /* Полномочия не передаются: ни cookie, ни заголовка авторизации
       сервис не использует. Разрешить их значило бы дать браузеру
       подставлять к запросам то, о чём пользователь не знает. */
    credentials: false,
    maxAge: 600,
  })

  await app.register(rateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.windowMs,
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
