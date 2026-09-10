import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isPairingUri } from '../lib/pairing-uri'

import { QrScanner } from './QrScanner'

/** Ссылка подключения такого вида, какой её выдаёт приложение. */
const PAIRING_URI = `wc:${'a'.repeat(64)}@2?relay-protocol=irn&symKey=${'b'.repeat(64)}`

/** Дорожка потока: важно, что её останавливают. */
class FakeTrack {
  stopped = false

  stop(): void {
    this.stopped = true
  }
}

/** Поток камеры-дублёра. */
class FakeStream {
  readonly track = new FakeTrack()

  getTracks(): FakeTrack[] {
    return [this.track]
  }
}

let stream: FakeStream | null
let getUserMedia: ReturnType<typeof vi.fn>

/** Ставит камеру-дублёр вместо настоящей. */
function installCamera(): void {
  stream = new FakeStream()
  getUserMedia = vi.fn(() => Promise.resolve(stream))

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  })
}

/** Убирает камеру целиком: так выглядит браузер без неё. */
function removeCamera(): void {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  installCamera()

  /* Кадры в тестовой среде не рисуются: полотно возвращает пустой
     контекст. Разбор подставляется свойством, поэтому изображение
     значения не имеет — важна только его доступность. */
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
  })) as unknown as HTMLCanvasElement['getContext']

  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
    configurable: true,
    value: 1,
  })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
    configurable: true,
    value: 1,
  })

  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Чтение ссылки подключения', () => {
  it('прочитанная ссылка уходит вызывающему', async () => {
    const onScanned = vi.fn()

    render(<QrScanner onScanned={onScanned} onCancel={vi.fn()} decode={() => PAIRING_URI} />)

    await waitFor(() => {
      expect(onScanned).toHaveBeenCalledWith(PAIRING_URI)
    })
  })

  it('камера выключается сразу после чтения', async () => {
    /* Оставленный поток — живая картинка комнаты в открытой вкладке. */
    const onScanned = vi.fn()

    render(<QrScanner onScanned={onScanned} onCancel={vi.fn()} decode={() => PAIRING_URI} />)

    await waitFor(() => {
      expect(stream?.track.stopped).toBe(true)
    })
  })

  it('камера выключается при закрытии видоискателя', async () => {
    const { unmount } = render(
      <QrScanner onScanned={vi.fn()} onCancel={vi.fn()} decode={() => null} />,
    )

    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalled()
    })

    unmount()

    expect(stream?.track.stopped).toBe(true)
  })

  it('ссылка передаётся один раз, сколько бы кадров ни прочиталось', async () => {
    /* Второй вызов запустил бы подключение повторно. */
    const onScanned = vi.fn()

    render(<QrScanner onScanned={onScanned} onCancel={vi.fn()} decode={() => PAIRING_URI} />)

    await waitFor(() => {
      expect(onScanned).toHaveBeenCalled()
    })

    await vi.advanceTimersByTimeAsync(2_000)

    expect(onScanned).toHaveBeenCalledTimes(1)
  })
})

describe('Посторонний код и недоступная камера', () => {
  it('посторонний код назван посторонним, а не проигнорирован', async () => {
    /* Молчащая камера неотличима от сломанной: человек будет водить
       телефоном, пока не бросит. */
    const onScanned = vi.fn()

    render(
      <QrScanner onScanned={onScanned} onCancel={vi.fn()} decode={() => 'https://example.com'} />,
    )

    expect(await screen.findByText(/not a connection link/i)).toBeInTheDocument()
    expect(onScanned).not.toHaveBeenCalled()
  })

  it('отказ в доступе к камере объяснён и предлагает вставку ссылки', async () => {
    getUserMedia.mockRejectedValue(new Error('Permission denied'))

    render(<QrScanner onScanned={vi.fn()} onCancel={vi.fn()} decode={() => null} />)

    expect(await screen.findByText(/camera is not available/i)).toBeInTheDocument()
    expect(screen.getByText(/Paste the connection link/i)).toBeInTheDocument()
  })

  it('без камеры видоискатель не показывается вовсе', () => {
    removeCamera()

    render(<QrScanner onScanned={vi.fn()} onCancel={vi.fn()} decode={() => null} />)

    expect(screen.getByText(/camera is not available/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Camera viewfinder')).not.toBeInTheDocument()
  })

  it('сказано, что кадры остаются на устройстве', async () => {
    /* Разрешение на камеру дают неохотно и правильно делают.
       Умолчание здесь стоит отказа от способа. */
    render(<QrScanner onScanned={vi.fn()} onCancel={vi.fn()} decode={() => null} />)

    expect(await screen.findByText(/is not sent anywhere/i)).toBeInTheDocument()
  })

  it('видоискатель закрывается кнопкой', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onCancel = vi.fn()

    render(<QrScanner onScanned={vi.fn()} onCancel={onCancel} decode={() => null} />)

    await user.click(screen.getByRole('button', { name: /close the camera/i }))

    expect(onCancel).toHaveBeenCalled()
  })
})

describe('Проверка прочитанного', () => {
  it('ссылка подключения принимается', () => {
    expect(isPairingUri(PAIRING_URI)).toBe(true)
  })

  it('адрес сайта со ссылкой внутри не принимается', () => {
    /* Поиск подстроки принял бы это. Схема проверяется с начала
       строки именно поэтому. */
    expect(isPairingUri(`https://evil.example/${PAIRING_URI}`)).toBe(false)
  })

  it('одна схема без содержимого не принимается', () => {
    expect(isPairingUri('wc:')).toBe(false)
  })

  it('полотно текста не принимается', () => {
    /* Штрих-код вмещает несколько тысяч символов, и занимать ими поле
       ввода посторонний не должен. */
    expect(isPairingUri(`wc:${'a'.repeat(5_000)}`)).toBe(false)
  })

  it('пробелы по краям не мешают', () => {
    expect(isPairingUri(`  ${PAIRING_URI}  `)).toBe(true)
  })
})
