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

export interface IRawRequest {
  readonly topic: string
  readonly id: number
  readonly chainId: ChainId | null
  readonly method: string
  readonly params: unknown
  readonly dapp: IDappMetadata
}

/**
 * Turn an app call into a request the wallet understands.
 *
 * RETURNS `null` FOR ANYTHING IT DOES NOT PARSE. That is not defensive
 * programming, it is the point: showing a request whose contents we
 * did not understand is not allowed — the user would confirm the
 * unknown. The answer to such a request is a rejection.
 *
 * SIGN METHODS TAKE ARGUMENTS IN DIFFERENT ORDER, AND THAT IS NOT A
 * TYPO. `personal_sign` sends the message first, then the address;
 * `eth_signTypedData_v4` is the reverse. Mixing them up would treat
 * the address as a message and show the user nonsense.
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

function toPayload(method: string, params: readonly unknown[]): IDappRequest['payload'] | null {
  switch (method) {
    case 'personal_sign': {
      /* Message first, then address. */
      const message = readMessage(params[0])
      const address = readAddress(params[1])

      return message === null || address === null
        ? null
        : { kind: DAPP_REQUEST_KIND.SignMessage, address, message }
    }

    /* `eth_sign` IS UNSUPPORTED ON PURPOSE, not forgotten.
       The method is meant to sign an arbitrary 32-byte value without
       a prefix — so an app can send a transaction hash and get a
       signature under it without showing the user anything.
       MetaMask disabled it by default and then removed it; other
       wallets followed. The app is sent a rejection. */

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
 * Read the message.
 *
 * Apps send it as text or as a hex string. The latter is decoded:
 * showing the user bytes where a readable phrase exists is showing
 * nothing. Unreadable stays hex, and risk analysis will warn.
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
    /* Fatal mode: a broken sequence leaves the string as hex instead
       of replacing bytes with question marks. */
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return value
  }
}

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

  /* Domain is optional in the spec: its absence is not a parse error,
     but a finding that risk analysis will raise. */
  const safeDomain = typeof domain === 'object' && domain !== null ? domain : {}

  return {
    domain: safeDomain,
    types: types as ITypedData['types'],
    primaryType,
    message: message as ITypedData['message'],
  }
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

/**
 * Read a transaction sent by the app.
 *
 * A missing sender is a rejection, not a fill-in of the active
 * account: signing a transaction whose owner the app omitted is
 * deciding for the user which address the funds leave from.
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
    /* A missing amount means zero: a transfer without an explicit
       value is a contract call, not a fill-in of an unknown figure. */
    value: readQuantity(record['value']) ?? 0n,
    data: readHex(record['data']),
    gasLimit: readQuantity(record['gas']) ?? readQuantity(record['gasLimit']),
  }
}

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

function readHex(value: unknown): HexString | null {
  return typeof value === 'string' && /^0x[0-9a-fA-F]*$/u.test(value) ? (value as HexString) : null
}
