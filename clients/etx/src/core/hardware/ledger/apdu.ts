import { HardwareDeviceError, USER_REJECTED_ON_DEVICE } from './errors'

/** Класс команд приложения Ethereum. */
export const CLA = 0xe0

/** Коды команд. */
export const INS = {
  GetAddress: 0x02,
  SignTransaction: 0x04,
  GetAppConfiguration: 0x06,
  SignPersonalMessage: 0x08,
  SignTypedDataHashed: 0x0c,
} as const

/** Первая часть многочастной команды. */
export const P1_FIRST = 0x00

/** Продолжение многочастной команды. */
export const P1_MORE = 0x80

/** Показать значение на экране устройства и ждать подтверждения. */
export const P1_CONFIRM = 0x01

/** Второй параметр, когда он не несёт смысла. */
export const P2_NONE = 0x00

/**
 * Наибольший размер данных одной команды.
 *
 * Ограничение протокола APDU: длина поля данных кодируется одним
 * байтом. Всё, что длиннее, обязано делиться на части.
 */
export const MAX_DATA_LENGTH = 255

/** Длина слова состояния в конце ответа. */
const STATUS_LENGTH = 2

/** Успешное завершение. */
const STATUS_OK = 0x9000

/**
 * Слова состояния, у которых есть внятное объяснение.
 *
 * ОБЪЯСНЕНИЕ ВАЖНЕЕ КОДА. «Ошибка 0x6985» не говорит человеку ничего,
 * тогда как «вы отклонили операцию на устройстве» описывает ровно то,
 * что произошло, и подсказывает, что делать дальше. Неизвестный код
 * показывается числом: выдумывать ему толкование недопустимо.
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
 * Собирает команду APDU.
 *
 * Заголовок из пяти байтов: класс, код команды, два параметра и длина
 * данных. Такова структура ISO 7816, которой следует устройство.
 */
export function buildApdu(
  instruction: number,
  p1: number,
  p2: number,
  data: Uint8Array,
): Uint8Array {
  if (data.length > MAX_DATA_LENGTH) {
    /* Молча обрезать данные значило бы отправить на подпись не то,
       что показано пользователю. */
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
 * Отделяет полезные данные ответа от слова состояния.
 *
 * ЛЮБОЙ КОД, КРОМЕ УСПЕХА, — ЭТО ОТКАЗ. Продолжить работу с данными
 * неуспешного ответа нельзя: там либо пусто, либо часть предыдущего
 * обмена.
 *
 * @throws HardwareDeviceError
 */
export function readResponse(response: Uint8Array): Uint8Array {
  if (response.length < STATUS_LENGTH) {
    throw new HardwareDeviceError('the device returned a response that is too short')
  }

  /* Копия, а не окно в исходный буфер: ответ живёт дольше самого
     обмена, и разделяемая память привела бы к чтению чужих данных. */
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
