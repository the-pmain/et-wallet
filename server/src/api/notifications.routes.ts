import type { FastifyInstance } from 'fastify'

import type { CatalogService } from '../catalog/CatalogService.ts'

/**
 * Системные уведомления.
 *
 * ЭТОТ МАРШРУТ ГОВОРИТ С ПОЛЬЗОВАТЕЛЕМ ОТ ИМЕНИ ЕГО КОШЕЛЬКА. Текст,
 * пришедший отсюда, показывается внутри окна кошелька и неотличим для
 * человека от собственных сообщений приложения. Отсюда ограничения,
 * встроенные в проверку каталога: только текст, никаких ссылок,
 * ограниченная длина.
 *
 * ОТВЕТ НЕ ЗАВИСИТ ОТ ТОГО, КТО СПРАШИВАЕТ. Ни адреса кошелька,
 * ни идентификатора установки маршрут не принимает: адресное
 * уведомление означало бы, что сервис знает, кому пишет.
 */
export function registerNotificationRoutes(app: FastifyInstance, catalog: CatalogService): void {
  app.get('/v1/notifications', (_request, reply) => {
    /* Кэш короче каталожного: уведомление о происшествии обязано
       доходить быстро, иначе оно бесполезно. */
    void reply.header('cache-control', 'public, max-age=60')

    return { notifications: catalog.listNotifications(new Date()) }
  })
}
