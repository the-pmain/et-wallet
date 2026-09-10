import type { Unsubscribe } from '@/core'

/**
 * Событие, о котором вкладки обязаны знать друг от друга.
 *
 * СПИСОК НАМЕРЕННО КОРОТКИЙ. Через канал между вкладками не передаётся
 * ничего, кроме факта события: ни ключей, ни адресов, ни сумм. Канал
 * доступен любому коду того же источника, включая внедрённый через XSS,
 * и всё, что в него попадает, следует считать раскрытым.
 */
export const WALLET_BROADCAST = {
  /**
   * Кошелёк стёрт с устройства.
   *
   * Единственное событие, которое обязано пересекать границу вкладки:
   * оно уничтожает общий ресурс. Блокировка, смена сети и прочее —
   * решения одной вкладки, и навязывать их остальным незачем.
   */
  Erased: 'wallet-erased',
} as const

export type WalletBroadcastEvent = (typeof WALLET_BROADCAST)[keyof typeof WALLET_BROADCAST]

/**
 * Оповещение между вкладками одного кошелька.
 *
 * ЗАЧЕМ ЭТО НУЖНО. Вкладки делят хранилище, но не память: у каждой
 * собственный ключ шифрования и собственный снимок состояния. Вкладка,
 * пережившая стирание кошелька в соседней, продолжала показывать
 * балансы и предлагать отправку — ключи-то у неё в памяти. Владелец
 * видел работающий кошелёк, которого на диске уже нет; хуже того,
 * человек, стерший кошелёк перед передачей устройства, оставлял
 * открытую дверь.
 *
 * ПОЧЕМУ `BroadcastChannel`, А НЕ СОБЫТИЕ ХРАНИЛИЩА. События `storage`
 * порождает только `localStorage`, который в проекте запрещён;
 * IndexedDB об изменениях не оповещает вовсе. Опрос базы означал бы
 * постоянную работу ради события, случающегося раз в жизни кошелька.
 *
 * ОТСУТСТВИЕ КАНАЛА НЕ ОШИБКА. В средах без `BroadcastChannel`
 * оповещение просто не работает: кошелёк остаётся таким же, каким был
 * до этой возможности. Ронять приложение из-за отсутствия удобства
 * нельзя.
 */
export class WalletBroadcast {
  readonly #channel: BroadcastChannel | null

  constructor(name = 'etwallet') {
    this.#channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(name)
  }

  /** Сообщает остальным вкладкам о событии. */
  post(event: WalletBroadcastEvent): void {
    this.#channel?.postMessage(event)
  }

  /**
   * Подписывает на события соседних вкладок.
   *
   * Собственные сообщения обратно не приходят — так устроен
   * `BroadcastChannel`, и отдельной защиты от петли не требуется.
   */
  subscribe(handler: (event: WalletBroadcastEvent) => void): Unsubscribe {
    const channel = this.#channel

    if (channel === null) {
      return () => undefined
    }

    const listener = (message: MessageEvent<unknown>): void => {
      /* Проверяется значение, а не тип: в канал того же источника
         писать может любой код, включая внедрённый. Неизвестное
         сообщение игнорируется. */
      if (message.data === WALLET_BROADCAST.Erased) {
        handler(WALLET_BROADCAST.Erased)
      }
    }

    channel.addEventListener('message', listener)

    return () => {
      channel.removeEventListener('message', listener)
    }
  }

  /** Закрывает канал. Вызывается при размонтировании приложения. */
  close(): void {
    this.#channel?.close()
  }
}
