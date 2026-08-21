/**
 * Отправка писем через Cloudflare Email Sending.
 *
 * Секреты живут только на сервере. Клиент кабинета передаёт адреса
 * и текст; токен Cloudflare в браузер не попадает.
 */

/** Письмо, которое кабинет просит отправить. */
export interface IEmailMessage {
  readonly to: string
  readonly from: string
  readonly subject: string
  readonly html: string
  readonly text: string
}

/** Итог доставки, который Cloudflare вернул без служебных полей. */
export interface IEmailSendResult {
  readonly delivered: readonly string[]
  readonly queued: readonly string[]
  readonly permanentBounces: readonly string[]
}

/** Служба отправки. Тест подставляет свою реализацию без сети. */
export interface IEmailService {
  readonly isConfigured: boolean
  send(message: IEmailMessage): Promise<IEmailSendResult>
}
