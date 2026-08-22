import type { FastifyInstance } from 'fastify'

import { findSecretKind } from '../lib/secret-patterns.ts'

/**
 * Охранник входящих данных.
 *
 * ЧТО ОН ДЕЛАЕТ. Отвергает запрос, в теле которого встречается
 * что-либо похожее на приватный ключ или мнемоническую фразу, — до того,
 * как тело будет разобрано, записано в журнал либо сохранено.
 *
 * ЗАЧЕМ, ЕСЛИ НИ ОДИН МАРШРУТ ТАКОГО НЕ ПРИНИМАЕТ. Затем, что
 * «ни один маршрут» — утверждение о сегодняшнем коде. Маршрут,
 * добавленный позже, может принять поле, о котором никто не подумал.
 * Охранник переводит обещание «сервис не получает секретов» из намерения
 * в поведение, не зависящее от внимательности каждого следующего
 * изменения.
 *
 * ЧЕГО ОН НЕ ДЕЛАЕТ. Не спасает пользователя: секрет, ушедший в сеть,
 * уже скомпрометирован — его видели прокси и терминатор TLS. Охранник
 * сокращает ущерб и делает ошибку заметной сразу.
 *
 * СОДЕРЖИМОЕ ОТВЕРГНУТОГО ЗАПРОСА НЕ ЖУРНАЛИРУЕТСЯ. Запись о том, что
 * приватный ключ пришёл, полезна; запись самого ключа превратила бы
 * защиту в утечку.
 */
const EMAIL_SEND_ROUTE = '/v1/admin/email/send'
const EMAIL_INBOUND_ROUTE = '/v1/webhooks/email-inbound'

export function registerSecretGuard(app: FastifyInstance): void {
  app.addHook('preValidation', (request, reply, done) => {
    /* Письмо — связный текст. Правило «двенадцать коротких слов»
       ловит обычный английский абзац, а хеш транзакции совпадает
       с шаблоном приватного ключа. Кабинет и так за PIN. */
    if (
      request.routeOptions.url === EMAIL_SEND_ROUTE ||
      request.routeOptions.url === EMAIL_INBOUND_ROUTE
    ) {
      done()

      return
    }

    const { body } = request

    if (body === undefined || body === null) {
      done()

      return
    }

    const payload = typeof body === 'string' ? body : JSON.stringify(body)
    const kind = findSecretKind(payload)

    if (kind === null) {
      done()

      return
    }

    request.log.warn(
      { route: request.routeOptions.url, kind },
      'Запрос отвергнут: тело содержит данные, которых у сервиса быть не может',
    )

    void reply.status(400).send({
      error: {
        code: 'secret_material_rejected',
        message:
          'Тело запроса содержит данные, похожие на приватный ключ либо seed-фразу. ' +
          'Этот сервис их не принимает ни при каких обстоятельствах. ' +
          'Считайте отправленное значение скомпрометированным и замените его.',
      },
    })
  })
}
