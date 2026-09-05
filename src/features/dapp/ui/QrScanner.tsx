import { CameraOff, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Alert, AlertDescription, AlertTitle, Button } from '@/shared/ui'

import { isPairingUri } from '../lib/pairing-uri'

/**
 * How often a frame is decoded.
 *
 * Decode takes a few milliseconds but runs on the main thread.
 * Four times a second is enough to aim the camera without lag and
 * does not heat the phone.
 */
const FRAME_INTERVAL_MS = 250

/**
 * Decode an image and return the read text.
 *
 * Lifted into a prop for tests: there is no camera in the test
 * environment, and success and failure paths must still be checked.
 */
export type QrDecoder = (image: ImageData) => string | null

interface QrScannerProps {
  readonly onScanned: (uri: string) => void

  readonly onCancel: () => void

  readonly decode?: QrDecoder
}

/**
 * What prevents reading the barcode.
 *
 * Missing camera is not here: that is an environment fact known
 * before the first paint, not an event. Holding it in state would
 * render the viewfinder and immediately replace it with a message.
 */
type ScannerFault = 'denied' | 'not-a-link'

/**
 * Viewfinder for a pairing URI.
 *
 * THE CAMERA TURNS OFF ON CLOSE AND AFTER A SUCCESSFUL READ. A stream
 * left on is a live picture of the room in an open tab; the browser
 * shows a recording icon, but counting on it being noticed is not
 * allowed.
 *
 * FRAMES GO NOWHERE. Decode runs here, in the page; no frame is sent
 * to any server. That is said to the user plainly: camera permission
 * is given reluctantly, and rightly so.
 *
 * WHAT WAS READ IS CHECKED BEFORE IT IS PASSED ON. A barcode can
 * hold anything; foreign text is named foreign, not ignored silently
 * — a silent camera is indistinguishable from a broken one.
 */
export function QrScanner({ onScanned, onCancel, decode }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [fault, setFault] = useState<ScannerFault | null>(null)

  /* Camera availability is known immediately and does not change
     during the viewfinder's life. */
  const hasCamera = navigator.mediaDevices !== undefined

  /* Calling the handler again after the first successful read
     would start the connection twice. */
  const isDoneRef = useRef(false)

  const stopCamera = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop()
    }

    streamRef.current = null
  }, [])

  useEffect(() => {
    const media = navigator.mediaDevices

    if (media === undefined) {
      return
    }

    let timer: ReturnType<typeof setInterval> | null = null
    let cancelled = false

    async function start(): Promise<void> {
      let stream: MediaStream

      try {
        /* Rear camera: the barcode is shown on another screen, and
           the front one points the wrong way. The request is soft —
           a device with one camera will use that one. */
        stream = await media.getUserMedia({ video: { facingMode: 'environment' } })
      } catch {
        /* Permission denial and a missing camera look the same, and
           both mean one thing: there is nothing to read with.
           Guessing between them would sometimes report the wrong
           cause. */
        if (!cancelled) {
          setFault('denied')
        }

        return
      }

      if (cancelled) {
        for (const track of stream.getTracks()) {
          track.stop()
        }

        return
      }

      streamRef.current = stream

      const video = videoRef.current

      if (video !== null) {
        video.srcObject = stream
        await video.play().catch(() => {
          /* Autoplay refusal does not block decode: frames are
             available without display. Continue silently. */
        })
      }

      const readFrame = await createFrameReader(decode)

      timer = setInterval(() => {
        const current = videoRef.current

        if (current === null || isDoneRef.current) {
          return
        }

        const text = readFrame(current)

        if (text === null) {
          return
        }

        if (!isPairingUri(text)) {
          setFault('not-a-link')

          return
        }

        isDoneRef.current = true
        stopCamera()
        onScanned(text.trim())
      }, FRAME_INTERVAL_MS)
    }

    void start()

    return () => {
      cancelled = true

      if (timer !== null) {
        clearInterval(timer)
      }

      stopCamera()
    }
  }, [decode, onScanned, stopCamera])

  return (
    <div className="flex flex-col gap-3">
      {!hasCamera || fault === 'denied' ? (
        <Alert variant="warning">
          <CameraOff />
          <AlertTitle>The camera is not available</AlertTitle>
          <AlertDescription>
            Either the browser was not given access to it, or there is no camera. Paste the
            connection link into the field instead — it works the same way.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="relative overflow-hidden rounded-xl border bg-black">
            {/* Audio is not requested and not needed: the viewfinder
                has one job. `muted` is required — without it the
                browser will not play the stream without a user
                gesture. */}
            <video
              ref={videoRef}
              className="aspect-square w-full object-cover"
              muted
              playsInline
              aria-label="Camera viewfinder"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Point the camera at the code shown by the application. The image is processed on this
            device and is not sent anywhere.
          </p>
        </>
      )}

      {fault === 'not-a-link' ? (
        <Alert variant="warning">
          <AlertDescription>
            That code is not a connection link. Applications show a link that starts with "wc:";
            anything else does not belong here.
          </AlertDescription>
        </Alert>
      ) : null}

      <Button variant="outline" onClick={onCancel}>
        <X className="size-4" aria-hidden />
        Close the camera
      </Button>
    </div>
  )
}

/**
 * Prepare frame decode.
 *
 * THE LIBRARY LOADS ONLY HERE. It is needed on one screen of ten,
 * and having it in the main bundle would slow wallet entry for
 * everyone, including people who never use connections.
 */
async function createFrameReader(
  decode: QrDecoder | undefined,
): Promise<(video: HTMLVideoElement) => string | null> {
  const decoder = decode ?? (await loadDecoder())

  /* The canvas is created once: recreating it every frame would
     allocate several megabytes a second. */
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })

  return (video) => {
    if (context === null || video.videoWidth === 0) {
      return null
    }

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    context.drawImage(video, 0, 0, canvas.width, canvas.height)

    return decoder(context.getImageData(0, 0, canvas.width, canvas.height))
  }
}

async function loadDecoder(): Promise<QrDecoder> {
  const { default: jsQR } = await import('jsqr')

  return (image) => jsQR(image.data, image.width, image.height)?.data ?? null
}
