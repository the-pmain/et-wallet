import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isPairingUri } from '../lib/pairing-uri'

import { QrScanner } from './QrScanner'

const PAIRING_URI = `wc:${'a'.repeat(64)}@2?relay-protocol=irn&symKey=${'b'.repeat(64)}`

class FakeTrack {
  stopped = false

  stop(): void {
    this.stopped = true
  }
}

class FakeStream {
  readonly track = new FakeTrack()

  getTracks(): FakeTrack[] {
    return [this.track]
  }
}

let stream: FakeStream | null
let getUserMedia: ReturnType<typeof vi.fn>

function installCamera(): void {
  stream = new FakeStream()
  getUserMedia = vi.fn(() => Promise.resolve(stream))

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  })
}

function removeCamera(): void {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  installCamera()

  /* Frames are not drawn in tests: the canvas returns an empty
     context. Decode is injected via a prop, so the image does not
     matter — only that it is available. */
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

describe('Reading a pairing URI', () => {
  it('the scanned URI is passed to the caller', async () => {
    const onScanned = vi.fn()

    render(<QrScanner onScanned={onScanned} onCancel={vi.fn()} decode={() => PAIRING_URI} />)

    await waitFor(() => {
      expect(onScanned).toHaveBeenCalledWith(PAIRING_URI)
    })
  })

  it('the camera turns off immediately after a read', async () => {
    /* A stream left on is a live picture of the room in an open tab. */
    const onScanned = vi.fn()

    render(<QrScanner onScanned={onScanned} onCancel={vi.fn()} decode={() => PAIRING_URI} />)

    await waitFor(() => {
      expect(stream?.track.stopped).toBe(true)
    })
  })

  it('the camera turns off when the viewfinder closes', async () => {
    const { unmount } = render(
      <QrScanner onScanned={vi.fn()} onCancel={vi.fn()} decode={() => null} />,
    )

    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalled()
    })

    unmount()

    expect(stream?.track.stopped).toBe(true)
  })

  it('the URI is passed once no matter how many frames are read', async () => {
    /* A second call would start the connection again. */
    const onScanned = vi.fn()

    render(<QrScanner onScanned={onScanned} onCancel={vi.fn()} decode={() => PAIRING_URI} />)

    await waitFor(() => {
      expect(onScanned).toHaveBeenCalled()
    })

    await vi.advanceTimersByTimeAsync(2_000)

    expect(onScanned).toHaveBeenCalledTimes(1)
  })
})

describe('Foreign code and an unavailable camera', () => {
  it('foreign code is named foreign, not ignored', async () => {
    /* A silent camera is indistinguishable from a broken one: the
       person will wave the phone until they give up. */
    const onScanned = vi.fn()

    render(
      <QrScanner onScanned={onScanned} onCancel={vi.fn()} decode={() => 'https://example.com'} />,
    )

    expect(await screen.findByText(/not a connection link/i)).toBeInTheDocument()
    expect(onScanned).not.toHaveBeenCalled()
  })

  it('camera denial is explained and offers pasting the URI', async () => {
    getUserMedia.mockRejectedValue(new Error('Permission denied'))

    render(<QrScanner onScanned={vi.fn()} onCancel={vi.fn()} decode={() => null} />)

    expect(await screen.findByText(/camera is not available/i)).toBeInTheDocument()
    expect(screen.getByText(/Paste the connection link/i)).toBeInTheDocument()
  })

  it('without a camera the viewfinder is not shown', () => {
    removeCamera()

    render(<QrScanner onScanned={vi.fn()} onCancel={vi.fn()} decode={() => null} />)

    expect(screen.getByText(/camera is not available/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Camera viewfinder')).not.toBeInTheDocument()
  })

  it('says that frames stay on the device', async () => {
    /* Camera permission is given reluctantly, and rightly so.
       Silence here is as bad as refusing the method. */
    render(<QrScanner onScanned={vi.fn()} onCancel={vi.fn()} decode={() => null} />)

    expect(await screen.findByText(/is not sent anywhere/i)).toBeInTheDocument()
  })

  it('the viewfinder closes with the button', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onCancel = vi.fn()

    render(<QrScanner onScanned={vi.fn()} onCancel={onCancel} decode={() => null} />)

    await user.click(screen.getByRole('button', { name: /close the camera/i }))

    expect(onCancel).toHaveBeenCalled()
  })
})

describe('Checking what was read', () => {
  it('a pairing URI is accepted', () => {
    expect(isPairingUri(PAIRING_URI)).toBe(true)
  })

  it('a site URL containing the URI is not accepted', () => {
    /* A substring search would accept this. The scheme is checked
       from the start of the string for that reason. */
    expect(isPairingUri(`https://evil.example/${PAIRING_URI}`)).toBe(false)
  })

  it('a scheme with no contents is not accepted', () => {
    expect(isPairingUri('wc:')).toBe(false)
  })

  it('a wall of text is not accepted', () => {
    /* A barcode holds several thousand characters, and a stranger
       must not fill the input with them. */
    expect(isPairingUri(`wc:${'a'.repeat(5_000)}`)).toBe(false)
  })

  it('surrounding spaces do not matter', () => {
    expect(isPairingUri(`  ${PAIRING_URI}  `)).toBe(true)
  })
})
