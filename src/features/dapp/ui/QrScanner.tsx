import { CameraOff, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Alert, AlertDescription, AlertTitle, Button } from '@/shared/ui'

import { isPairingUri } from '../lib/pairing-uri'

/**
 * Как часто разбирается кадр.
 *
 * Разбор кадра занимает единицы миллисекунд, но выполняется в основном
 * потоке. Четыре раза в секунду достаточно, чтобы навести камеру
 * без ощущения задержки, и не заставляет телефон греться.
 */
const FRAME_INTERVAL_MS = 250

/**
 * Разбирает изображение и возвращает прочитанный текст.
 *
 * Вынесен в свойство ради проверок: подключить камеру в тестовой среде
 * нечем, а поведение при удачном и неудачном чтении проверить
 * обязательно.
 */
export type QrDecoder = (image: ImageData) => string | null

interface QrScannerProps {
  /** Прочитанная ссылка подключения. Вызывается один раз. */
  readonly onScanned: (uri: string) => void

  /** Пользователь закрыл видоискатель. */
  readonly onCancel: () => void

  /** Разбор кадра. По умолчанию загружается отдельным модулем. */
  readonly decode?: QrDecoder
}

/**
 * Что мешает читать штрих-код.
 *
 * Отсутствия камеры здесь нет: это свойство среды, известное до
 * первой отрисовки, а не событие. Держать его в состоянии значило бы
 * отрисовать видоискатель и тут же заменить его сообщением.
 */
type ScannerFault = 'denied' | 'not-a-link'

/**
 * Видоискатель для ссылки подключения.
 *
 * КАМЕРА ВЫКЛЮЧАЕТСЯ ПРИ ЗАКРЫТИИ И ПОСЛЕ УДАЧНОГО ЧТЕНИЯ. Оставленный
 * включённым поток — это живая картинка комнаты, идущая в открытой
 * вкладке; браузер показывает значок записи, но полагаться на то, что
 * его заметят, нельзя.
 *
 * КАДРЫ НИКУДА НЕ УХОДЯТ. Разбор выполняется здесь же, в странице;
 * ни один кадр не передаётся ни на какой сервер. Это сказано
 * пользователю прямо: разрешение на камеру дают неохотно и правильно
 * делают.
 *
 * ПРОЧИТАННОЕ ПРОВЕРЯЕТСЯ ДО ПЕРЕДАЧИ ДАЛЬШЕ. Штрих-код может
 * содержать что угодно; посторонний текст называется посторонним,
 * а не игнорируется молча — молчащая камера неотличима от сломанной.
 */
export function QrScanner({ onScanned, onCancel, decode }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [fault, setFault] = useState<ScannerFault | null>(null)

  /* Доступность камеры известна сразу и не меняется за время жизни
     видоискателя. */
  const hasCamera = navigator.mediaDevices !== undefined

  /* Повторный вызов обработчика после первого удачного чтения
     запустил бы подключение дважды. */
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
        /* Задняя камера: штрих-код показывают на другом экране, и
           передняя направлена не туда. Требование мягкое — на
           устройстве с одной камерой возьмётся она. */
        stream = await media.getUserMedia({ video: { facingMode: 'environment' } })
      } catch {
        /* Отказ в разрешении и отсутствие камеры внешне неразличимы,
           и оба означают одно: читать нечем. Различать их догадками
           значило бы иногда сообщать неверное. */
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
          /* Отказ автозапуска не мешает разбору: кадры доступны и
             без показа. Молча продолжаем. */
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
            {/* Звук не запрашивается и не нужен: у видоискателя одна
                задача. `muted` обязателен — без него браузер не даёт
                воспроизвести поток без действия пользователя. */}
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
 * Готовит разбор кадра.
 *
 * БИБЛИОТЕКА ЗАГРУЖАЕТСЯ ТОЛЬКО ЗДЕСЬ. Она нужна одному экрану
 * из десятка, и её присутствие в основном наборе замедлило бы вход
 * в кошелёк всем, включая тех, кто подключений не использует.
 */
async function createFrameReader(
  decode: QrDecoder | undefined,
): Promise<(video: HTMLVideoElement) => string | null> {
  const decoder = decode ?? (await loadDecoder())

  /* Полотно создаётся один раз: пересоздание на каждый кадр выделяло бы
     несколько мегабайт в секунду. */
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

/** Загружает разбор штрих-кода отдельным модулем. */
async function loadDecoder(): Promise<QrDecoder> {
  const { default: jsQR } = await import('jsqr')

  return (image) => jsQR(image.data, image.width, image.height)?.data ?? null
}
