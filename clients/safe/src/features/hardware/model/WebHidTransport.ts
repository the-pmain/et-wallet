import { HardwareDeviceError, type IApduTransport } from '@/core'

/**
 * Exchange packet size.
 *
 * Set by the device: Ledger HID reports are always sixty-four
 * bytes; the rest is padded with zeros.
 */
const PACKET_SIZE = 64

const TAG_APDU = 0x05

/**
 * Channel number.
 *
 * The device does not distinguish channels, but requires the
 * number in the reply to match the request. The value is chosen
 * arbitrarily and held constant.
 */
const CHANNEL = 0x0101

const FIRST_HEADER_SIZE = 7

const NEXT_HEADER_SIZE = 5

const RESPONSE_TIMEOUT_MS = 90_000

/** Ledger vendor id. Needed by the device-picker filter. */
export const LEDGER_VENDOR_ID = 0x2c97

/*
  THE WEBHID DESCRIPTION IS WRITTEN HERE, NOT TAKEN FROM A TYPES
  PACKAGE.

  The interface is not supported by every browser and is not in
  the standard TypeScript library. A separate dependency for four
  methods is not worth it in a wallet: each added dependency is
  another path to the seed phrase. Only what we use is described;
  everything else is left out of these types on purpose.
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

function getHid(): IHid | null {
  const hid = (navigator as Navigator & { hid?: IHid }).hid

  return hid ?? null
}

/**
 * Connection to a device over WebHID.
 *
 * TRANSPORT ONLY. The core builds and parses commands; this class
 * splits them into packets, sends them, and assembles the reply.
 * The split is not decorative: the protocol can then be tested
 * without a device, and the browser interface does not leak into
 * the core.
 *
 * THE WAIT IS LONG ON PURPOSE. Between sending a command and the
 * reply, the person reads data on the device screen and presses
 * buttons. A minute and a half is not slack for a slow link — it
 * is time for a considered decision; a short wait would turn
 * carefulness into a connection error.
 */
export class WebHidTransport implements IApduTransport {
  readonly #device: IHidDevice

  private constructor(device: IHidDevice) {
    this.#device = device
  }

  /**
   * Ask the user to pick a device and open it.
   *
   * THE BROWSER MAKES THE CHOICE, NOT US. The page cannot list
   * devices or open them without an explicit human action in a
   * browser prompt — and that is correct: access to a signing
   * device is granted by name and on purpose.
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

  /** Close the connection. The device stays available for a new one. */
  async close(): Promise<void> {
    if (this.#device.opened) {
      await this.#device.close()
    }
  }

  async exchange(command: Uint8Array): Promise<Uint8Array> {
    const response = this.#awaitResponse()

    for (const packet of splitIntoPackets(command)) {
      /* Report id is zero: the device has one interface. */
      await this.#device.sendReport(0, packet)
    }

    return await response
  }

  /**
   * Assemble the reply from packets.
   *
   * The listener is attached BEFORE the command is sent: the
   * device answers quickly, and a listener attached after send
   * would miss the first packet.
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
 * Split a command into exchange packets.
 *
 * The first packet carries the declared command length; the rest
 * carry only a sequence number. The device checks the number:
 * packets that arrive out of order are rejected.
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
 * Assemble a reply from packets.
 *
 * LENGTH IS TAKEN FROM THE FIRST PACKET, not from how many arrived:
 * the last packet is padded with zeros, and there is no other way
 * to tell padding from data.
 */
export class ResponseAssembler {
  #expected: number | null = null
  #body: number[] = []
  #index = 0

  push(packet: Uint8Array): Uint8Array | null {
    const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength)

    if (view.getUint16(0, false) !== CHANNEL || packet[2] !== TAG_APDU) {
      /* Foreign packet: the device may have sent a message of
         another kind. Skipped silently — aborting the exchange
         over it would be wrong. */
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
