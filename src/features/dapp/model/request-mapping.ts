import {
  DAPP_REQUEST_KIND,
  toAddress,
  type Address,
  type ChainId,
  type HexString,
  type IDappMetadata,
  type IDappRequest,
  type IDappTransaction,
  type ITypedData,
} from '@/core'

/** Сырое обращение, пришедшее от транспорта. */
export interface IRawRequest {
  readonly topic: string
  readonly id: number
  readonly chainId: ChainId | null
  readonly method: string
  readonly params: unknown
  readonly dapp: IDappMetadata
}

/**
 * Переводит обращение приложения в запрос, понятный кошельку.
 *
 * ВОЗВРАЩАЕТ `null` ДЛЯ ВСЕГО, ЧЕГО НЕ РАЗБИРАЕТ. Это не защитное
 * программирование, а суть: показать пользователю запрос, содержимое
 * которого мы не поняли, нельзя — он подтвердит непонятное. Ответом
 * на такой запрос будет отказ.
 *
 * ПОРЯДОК АРГУМЕНТОВ У МЕТОДОВ ПОДПИСИ РАЗНЫЙ, И ЭТО НЕ ОПЕЧАТКА.
 * `personal_sign` присылает сначала сообщение, затем адрес; `eth_sign`
 * и `eth_signTypedData_v4` — наоборот. Перепутать их значит принять
 * адрес за сообщение и показать пользователю бессмыслицу.
 */
export function toDappRequest(raw: IRawRequest): IDappRequest | null {
  if (raw.chainId === null) {
    return null
  }

  const params = Array.isArray(raw.params) ? (raw.params as readonly unknown[]) : []
  const payload = toPayload(raw.method, params)

  if (payload === null) {
    return null
  }

  return {
    id: `${raw.topic}|${String(raw.id)}`,
    sessionId: raw.topic,
    dapp: raw.dapp,
    chainId: raw.chainId,
    payload,
  }
}

/** Разбирает содержимое по имени метода. */
function toPayload(method: string, params: readonly unknown[]): IDappRequest['payload'] | null {
  switch (method) {
    case 'personal_sign': {
      /* Сначала сообщение, затем адрес. */
      const message = readMessage(params[0])
      const address = readAddress(params[1])

      return message === null || address === null
        ? null
        : { kind: DAPP_REQUEST_KIND.SignMessage, address, message }
    }

    case 'eth_sign': {
      /* Сначала адрес, затем сообщение — порядок обратный. */
      const address = readAddress(params[0])
      const message = readMessage(params[1])

      return message === null || address === null
        ? null
        : { kind: DAPP_REQUEST_KIND.SignMessage, address, message }
    }

    case 'eth_signTypedData':
    case 'eth_signTypedData_v4': {
      const address = readAddress(params[0])
      const typedData = readTypedData(params[1])

      return address === null || typedData === null
        ? null
        : { kind: DAPP_REQUEST_KIND.SignTypedData, address, typedData }
    }

    case 'eth_sendTransaction':
    case 'eth_signTransaction': {
      const transaction = readTransaction(params[0])

      return transaction === null
        ? null
        : {
            kind:
              method === 'eth_sendTransaction'
                ? DAPP_REQUEST_KIND.SendTransaction
                : DAPP_REQUEST_KIND.SignTransaction,
            transaction,
          }
    }

    default:
      return null
  }
}

/**
 * Читает сообщение.
 *
 * Приложения присылают его либо текстом, либо шестнадцатеричной
 * строкой. Второе переводится в текст: показывать пользователю байты
 * там, где есть читаемая фраза, — значит не показывать ничего.
 * Нечитаемое остаётся шестнадцатеричным, и об этом предупредит разбор
 * рисков.
 */
function readMessage(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  if (!/^0x[0-9a-fA-F]*$/u.test(value)) {
    return value
  }

  const bytes = new Uint8Array((value.length - 2) / 2)

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(2 + index * 2, 4 + index * 2), 16)
  }

  try {
    /* Строгий режим: испорченная последовательность оставляет строку
       шестнадцатеричной, а не подменяет байты знаками вопроса. */
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return value
  }
}

/** Читает адрес, отвергая всё, что адресом не является. */
function readAddress(value: unknown): Address | null {
  if (typeof value !== 'string') {
    return null
  }

  try {
    return toAddress(value)
  } catch {
    return null
  }
}

/** Читает структуру EIP-712, присланную объектом либо строкой JSON. */
function readTypedData(value: unknown): ITypedData | null {
  const source: unknown = typeof value === 'string' ? safeParseJson(value) : value

  if (typeof source !== 'object' || source === null) {
    return null
  }

  const record = source as Record<string, unknown>
  const domain = record['domain']
  const types = record['types']
  const primaryType = record['primaryType']
  const message = record['message']

  if (
    typeof primaryType !== 'string' ||
    typeof types !== 'object' ||
    types === null ||
    typeof message !== 'object' ||
    message === null
  ) {
    return null
  }

  /* Домен необязателен по стандарту: его отсутствие — не ошибка разбора,
     а повод для замечания, которое выдаст оценка рисков. */
  const safeDomain = typeof domain === 'object' && domain !== null ? domain : {}

  return {
    domain: safeDomain,
    types: types as ITypedData['types'],
    primaryType,
    message: message as ITypedData['message'],
  }
}

/** Разбирает JSON, не бросая исключения. */
function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

/**
 * Читает транзакцию, присланную приложением.
 *
 * Отсутствие отправителя — отказ, а не подстановка активного аккаунта:
 * подписать транзакцию, о владельце которой приложение умолчало,
 * значит решить за пользователя, с какого адреса уйдут средства.
 */
function readTransaction(value: unknown): IDappTransaction | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const record = value as Record<string, unknown>
  const from = readAddress(record['from'])

  if (from === null) {
    return null
  }

  return {
    from,
    to: readAddress(record['to']),
    /* Отсутствие суммы означает ноль: перевод без явного значения —
       это вызов контракта, а не подстановка неизвестной величины. */
    value: readQuantity(record['value']) ?? 0n,
    data: readHex(record['data']),
    gasLimit: readQuantity(record['gas']) ?? readQuantity(record['gasLimit']),
  }
}

/** Читает количество, присланное числом либо шестнадцатеричной строкой. */
function readQuantity(value: unknown): bigint | null {
  if (typeof value === 'bigint') {
    return value
  }

  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return BigInt(value)
  }

  if (typeof value === 'string' && /^(0x[0-9a-fA-F]+|\d+)$/u.test(value)) {
    return BigInt(value)
  }

  return null
}

/** Читает шестнадцатеричные данные. */
function readHex(value: unknown): HexString | null {
  return typeof value === 'string' && /^0x[0-9a-fA-F]*$/u.test(value) ? (value as HexString) : null
}
