import { HardwareDeviceError, USER_REJECTED_ON_DEVICE } from './errors'

export const CLA = 0xe0

export const INS = {
  GetAddress: 0x02,
  SignTransaction: 0x04,
  GetAppConfiguration: 0x06,
  SignPersonalMessage: 0x08,
  SignTypedDataHashed: 0x0c,
} as const

/** First chunk of a multi-part command. */
export const P1_FIRST = 0x00

/** Continuation of a multi-part command. */
export const P1_MORE = 0x80

/** Show the value on the device screen and wait for confirmation. */
export const P1_CONFIRM = 0x01

/** Second parameter when it carries no meaning. */
export const P2_NONE = 0x00

/**
 * Largest data size of a single command.
 *
 * An APDU protocol limit: the data-field length is encoded in one
 * byte. Anything longer must be split into chunks.
 */
export const MAX_DATA_LENGTH = 255

const STATUS_LENGTH = 2

const STATUS_OK = 0x9000

/**
 * Status words that have a clear explanation.
 *
 * THE EXPLANATION MATTERS MORE THAN THE CODE. "Error 0x6985" tells
 * a person nothing, while "you rejected the operation on the device"
 * describes exactly what happened and what to do next. An unknown
 * code is shown as a number: inventing a meaning for it is not
 * allowed.
 */
const STATUS_MEANINGS: ReadonlyMap<number, string> = new Map([
  [0x6985, USER_REJECTED_ON_DEVICE],
  [0x5515, 'the device is locked: unlock it with your PIN'],
  [0x6511, 'the Ethereum application is not open on the device'],
  [0x6b0c, 'the Ethereum application is not open on the device'],
  [0x6a80, 'the device refused the data: it may be an older firmware version'],
  [0x6d00, 'the device does not support this command in the open application'],
  [0x6e00, 'the open application on the device is not the Ethereum one'],
  [0x6f00, 'the device reported an internal error'],
  [
    0x6807,
    'the device cannot show this transaction in full: enable "blind signing" in the Ethereum application, or use an application that sends readable data',
  ],
])

/**
 * Builds an APDU command.
 *
 * A five-byte header: class, instruction, two parameters, and data
 * length. That is the ISO 7816 structure the device follows.
 */
export function buildApdu(
  instruction: number,
  p1: number,
  p2: number,
  data: Uint8Array,
): Uint8Array {
  if (data.length > MAX_DATA_LENGTH) {
    /* Silently truncating the data would send something other than
       what was shown to the user to be signed. */
    throw new HardwareDeviceError(
      `the command data is longer than the protocol allows: ${data.length.toString()} bytes`,
    )
  }

  const command = new Uint8Array(5 + data.length)

  command[0] = CLA
  command[1] = instruction
  command[2] = p1
  command[3] = p2
  command[4] = data.length
  command.set(data, 5)

  return command
}

/**
 * Splits response payload from the status word.
 *
 * ANY CODE OTHER THAN SUCCESS IS A REFUSAL. Work must not continue
 * with the data of a failed reply: it is either empty or leftover
 * from a previous exchange.
 *
 * @throws HardwareDeviceError
 */
export function readResponse(response: Uint8Array): Uint8Array {
  if (response.length < STATUS_LENGTH) {
    throw new HardwareDeviceError('the device returned a response that is too short')
  }

  /* A copy, not a window into the original buffer: the reply outlives
     the exchange itself, and shared memory would read foreign data. */
  const body = response.slice(0, response.length - STATUS_LENGTH)
  const status = ((response[response.length - 2] ?? 0) << 8) | (response[response.length - 1] ?? 0)

  if (status === STATUS_OK) {
    return body
  }

  const meaning = STATUS_MEANINGS.get(status)

  throw new HardwareDeviceError(
    meaning ?? `the device returned status 0x${status.toString(16).padStart(4, '0')}`,
    { isUserRejection: meaning === USER_REJECTED_ON_DEVICE },
  )
}
