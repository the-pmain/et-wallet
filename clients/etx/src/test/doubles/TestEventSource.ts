/**
 * EventSource для jsdom: настоящего потока нет, проверяется адрес
 * и закрытие. Экземпляры копятся, чтобы тест экрана отправки и кабинета
 * видел подключение без сети. `emit` подставляет кадр именованного события.
 */
export class TestEventSource {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2

  static instances: TestEventSource[] = []

  static reset(): void {
    TestEventSource.instances = []
  }

  readonly url: string
  readonly withCredentials = false
  closed = false
  readyState = TestEventSource.OPEN
  onopen: ((this: EventSource, event: Event) => void) | null = null
  onmessage: ((this: EventSource, event: MessageEvent) => void) | null = null
  onerror: ((this: EventSource, event: Event) => void) | null = null

  readonly #listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()

  constructor(url: string | URL) {
    this.url = typeof url === 'string' ? url : url.href
    TestEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const bucket = this.#listeners.get(type) ?? new Set()
    bucket.add(listener)
    this.#listeners.set(type, bucket)
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.#listeners.get(type)?.delete(listener)
  }

  dispatchEvent(_event: Event): boolean {
    return false
  }

  emit(type: string, data: string): void {
    const event = new MessageEvent(type, { data })

    for (const listener of this.#listeners.get(type) ?? []) {
      if (typeof listener === 'function') {
        listener(event)

        continue
      }

      listener.handleEvent(event)
    }

    if (type === 'message') {
      this.onmessage?.call(this as unknown as EventSource, event)
    }
  }

  close(): void {
    this.closed = true
    this.readyState = TestEventSource.CLOSED
  }
}
