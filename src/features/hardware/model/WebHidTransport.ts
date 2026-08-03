import { HardwareDeviceError, type IApduTransport } from '@/core'

/**
 * Размер пакета обмена.
 *
 * Задан устройством: отчёты HID у Ledger всегда шестидесятичетырёхбайтовые,
 * недостающее дополняется нулями.
 */
const PACKET_SIZE = 64

/** Признак пакета обмена командами. */
const TAG_APDU = 0x05

/**
 * Номер канала.
 *
 * Устройство не различает каналы, но требует, чтобы номер в ответе
 * совпадал с номером в запросе. Значение выбрано произвольно
 * и постоянно.
 */
const CHANNEL = 0x0101

/** Заголовок первого пакета: канал, признак, номер, длина команды. */
const FIRST_HEADER_SIZE = 7

/** Заголовок продолжающего пакета: канал, признак, номер. */
const NEXT_HEADER_SIZE = 5

/** Ожидание ответа устройства. */
const RESPONSE_TIMEOUT_MS = 90_000

/** Идентификатор производителя Ledger. Нужен фильтру выбора устройства. */
export const LEDGER_VENDOR_ID = 0x2c97

/*
  ОПИСАНИЕ WEBHID ЗАДАНО ЗДЕСЬ, А НЕ ВЗЯТО ПАКЕТОМ ТИПОВ.

  Интерфейс поддержан не всеми браузерами и в стандартную библиотеку
  описаний TypeScript не входит. Отдельная зависимость ради четырёх
  методов в кошельке не окупается: каждая добавленная зависимость —
  ещё один путь к seed-фразе. Описано ровно то, чем пользуемся;
  всё прочее в этих типах отсутствует намеренно.
*/

interface IHidInputReportEvent extends Event {
  readonly data: DataView
}

interface IHidDevice extends EventTarget {
  readonly opened: boolean
  open(): Promise<void>
  close(): Promise<void>
  sendReport(reportId: number, data: Uint8Array): Promise<void>
}

interface IHid {
  requestDevice(options: {
    filters: readonly { vendorId: number }[]
  }): Promise<readonly IHidDevice[]>
}

/** Доступ к устройствам, если браузер его предоставляет. */
function getHid(): IHid | null {
  const hid = (navigator as Navigator & { hid?: IHid }).hid

  return hid ?? null
}

/**
 * Соединение с устройством по WebHID.
 *
 * ЗДЕСЬ ТОЛЬКО ПЕРЕВОЗКА. Команды составляет и разбирает ядро; этот
 * класс делит их на пакеты, отправляет и собирает ответ обратно.
 * Разделение не декоративное: протокол так проверяется тестами без
 * устройства, а браузерный интерфейс не проникает в ядро.
 *
 * ОЖИДАНИЕ ДОЛГОЕ НАМЕРЕННО. Между отправкой команды и ответом человек
 * читает данные на экране устройства и нажимает кнопки. Полторы минуты —
 * не запас на медленную связь, а время на осмысленное решение;
 * короткое ожидание превращало бы внимательность в ошибку связи.
 */
export class WebHidTransport implements IApduTransport {
  readonly #device: IHidDevice

  private constructor(device: IHidDevice) {
    this.#device = device
  }

  /**
   * Просит пользователя выбрать устройство и открывает его.
   *
   * ВЫБОР ДЕЛАЕТ БРАУЗЕР, А НЕ МЫ. Страница не может ни перечислить
   * устройства, ни открыть их без явного действия человека в окне
   * браузера — и это правильно: доступ к устройству подписи выдаётся
   * поимённо и осознанно.
   */
  static async connect(): Promise<WebHidTransport> {
    const hid = getHid()

    if (hid === null) {
      throw new HardwareDeviceError(
        'this browser cannot talk to USB devices: use Chrome, Edge or another Chromium-based browser',
      )
    }

    const [device] = await hid.requestDevice({ filters: [{ vendorId: LEDGER_VENDOR_ID }] })

    if (device === undefined) {
      throw new HardwareDeviceError('no device was chosen')
    }

    if (!device.opened) {
      await device.open()
    }

    return new WebHidTransport(device)
  }

  /** Закрывает соединение. Устройство остаётся доступным для нового. */
  async close(): Promise<void> {
    if (this.#device.opened) {
      await this.#device.close()
    }
  }

  async exchange(command: Uint8Array): Promise<Uint8Array> {
    const response = this.#awaitResponse()

    for (const packet of splitIntoPackets(command)) {
      /* Номер отчёта нулевой: у устройства один интерфейс. */
      await this.#device.sendReport(0, packet)
    }

    return await response
  }

  /**
   * Собирает ответ из пакетов.
   *
   * Подписка ставится ДО отправки команды: устройство отвечает быстро,
   * и подписка после отправки успевала бы пропустить первый пакет.
   */
  #awaitResponse(): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const assembler = new ResponseAssembler()

      const finish = (): void => {
        this.#device.removeEventListener('inputreport', onReport)
        clearTimeout(timer)
      }

      const onReport = (event: Event): void => {
        const { data } = event as IHidInputReportEvent
        let complete: Uint8Array | null

        try {
          complete = assembler.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
        } catch (error) {
          finish()
          reject(error instanceof Error ? error : new Error(String(error)))

          return
        }

        if (complete !== null) {
          finish()
          resolve(complete)
        }
      }

      const timer = setTimeout(() => {
        finish()
        reject(
          new HardwareDeviceError(
            'the device did not answer: check that it is unlocked and the Ethereum application is open',
          ),
        )
      }, RESPONSE_TIMEOUT_MS)

      this.#device.addEventListener('inputreport', onReport)
    })
  }
}

/**
 * Делит команду на пакеты обмена.
 *
 * Первый пакет несёт объявленную длину команды, остальные — только
 * порядковый номер. Номер проверяется устройством: пакеты, пришедшие
 * не по порядку, оно отвергает.
 */
export function splitIntoPackets(command: Uint8Array): readonly Uint8Array[] {
  const packets: Uint8Array[] = []
  let offset = 0
  let index = 0

  while (offset < command.length || index === 0) {
    const packet = new Uint8Array(PACKET_SIZE)
    const view = new DataView(packet.buffer)

    view.setUint16(0, CHANNEL, false)
    packet[2] = TAG_APDU
    view.setUint16(3, index, false)

    const headerSize = index === 0 ? FIRST_HEADER_SIZE : NEXT_HEADER_SIZE

    if (index === 0) {
      view.setUint16(NEXT_HEADER_SIZE, command.length, false)
    }

    const room = PACKET_SIZE - headerSize
    const chunk = command.subarray(offset, offset + room)

    packet.set(chunk, headerSize)
    packets.push(packet)

    offset += chunk.length
    index += 1
  }

  return packets
}

/**
 * Складывает ответ из пакетов.
 *
 * ДЛИНА БЕРЁТСЯ ИЗ ПЕРВОГО ПАКЕТА, а не по числу пришедших: последний
 * пакет дополнен нулями, и отличить дополнение от данных иначе нечем.
 */
export class ResponseAssembler {
  #expected: number | null = null
  #body: number[] = []
  #index = 0

  /** Возвращает собранный ответ либо `null`, если он ещё не полон. */
  push(packet: Uint8Array): Uint8Array | null {
    const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength)

    if (view.getUint16(0, false) !== CHANNEL || packet[2] !== TAG_APDU) {
      /* Чужой пакет: устройство могло прислать сообщение другого рода.
         Пропускается молча — прерывать обмен из-за него неправильно. */
      return null
    }

    if (view.getUint16(3, false) !== this.#index) {
      throw new HardwareDeviceError('the device sent packets out of order')
    }

    if (this.#index === 0) {
      this.#expected = view.getUint16(NEXT_HEADER_SIZE, false)
      this.#body = [...packet.subarray(FIRST_HEADER_SIZE)]
    } else {
      this.#body.push(...packet.subarray(NEXT_HEADER_SIZE))
    }

    this.#index += 1

    const expected = this.#expected ?? 0

    return this.#body.length >= expected ? Uint8Array.from(this.#body.slice(0, expected)) : null
  }
}
