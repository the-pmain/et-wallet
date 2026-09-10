import { afterEach, describe, expect, it, vi } from 'vitest'

import { WALLET_BROADCAST, WalletBroadcast } from './WalletBroadcast'

/** Открытые каналы закрываются, иначе они переживают проверку. */
const opened: WalletBroadcast[] = []

function channel(name: string): WalletBroadcast {
  const created = new WalletBroadcast(name)

  opened.push(created)

  return created
}

afterEach(() => {
  for (const item of opened.splice(0)) {
    item.close()
  }

  vi.unstubAllGlobals()
})

/** Ждёт доставки: сообщения канала приходят следующим тактом. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10))
}

describe('Оповещение между вкладками', () => {
  it('сообщение доходит до другой вкладки', async () => {
    const sender = channel('test-delivery')
    const receiver = channel('test-delivery')

    const received: string[] = []

    receiver.subscribe((event) => {
      received.push(event)
    })

    sender.post(WALLET_BROADCAST.Erased)
    await settle()

    expect(received).toEqual([WALLET_BROADCAST.Erased])
  })

  it('собственное сообщение обратно не возвращается', async () => {
    /* Иначе вкладка, стирающая кошелёк, приняла бы собственное
       оповещение и обработала стирание дважды. */
    const sender = channel('test-self')
    const received: string[] = []

    sender.subscribe((event) => {
      received.push(event)
    })

    sender.post(WALLET_BROADCAST.Erased)
    await settle()

    expect(received).toEqual([])
  })

  it('чужой канал не слышен', async () => {
    const sender = channel('test-one')
    const receiver = channel('test-two')

    const received: string[] = []

    receiver.subscribe((event) => {
      received.push(event)
    })

    sender.post(WALLET_BROADCAST.Erased)
    await settle()

    expect(received).toEqual([])
  })

  it('незнакомое сообщение игнорируется', async () => {
    /* В канал того же источника писать может любой код, включая
       внедрённый через XSS. Обрабатывается значение, а не факт
       сообщения. */
    const receiver = channel('test-foreign')
    const received: string[] = []

    receiver.subscribe((event) => {
      received.push(event)
    })

    new BroadcastChannel('test-foreign').postMessage({ kind: 'unlock-everything' })
    await settle()

    expect(received).toEqual([])
  })

  it('отписка прекращает доставку', async () => {
    const sender = channel('test-unsubscribe')
    const receiver = channel('test-unsubscribe')

    const received: string[] = []
    const unsubscribe = receiver.subscribe((event) => {
      received.push(event)
    })

    unsubscribe()
    sender.post(WALLET_BROADCAST.Erased)
    await settle()

    expect(received).toEqual([])
  })

  it('среда без канала не роняет приложение', () => {
    /* Оповещение — удобство, а не условие работы. Там, где
       `BroadcastChannel` недоступен, кошелёк остаётся таким же, каким
       был до его появления. */
    vi.stubGlobal('BroadcastChannel', undefined)

    const created = new WalletBroadcast('test-missing')

    expect(() => {
      created.post(WALLET_BROADCAST.Erased)
      created.subscribe(() => undefined)()
      created.close()
    }).not.toThrow()
  })
})
