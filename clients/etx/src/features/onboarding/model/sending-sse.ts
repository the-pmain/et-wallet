import { parseRemoteSending, type IRemoteSending } from './RemoteUserDirectory'

/** Почему кадр ушёл в поток `sendings`. */
export const SENDING_SSE_TYPE = {
  Create: 'create',
  Update: 'update',
} as const

export type SendingSseType = (typeof SENDING_SSE_TYPE)[keyof typeof SENDING_SSE_TYPE]

/**
 * Кадр `event: sendings`. Те же поля, что у записи перевода,
 * плюс `type_send`.
 */
export interface ISendingSseEvent extends IRemoteSending {
  readonly type_send: SendingSseType
}

function isSendingSseType(value: unknown): value is SendingSseType {
  return value === SENDING_SSE_TYPE.Create || value === SENDING_SSE_TYPE.Update
}

/**
 * Разбирает `data` кадра SSE. Битый JSON и кадр без `type_send`
 * отбрасываются: список кабинета не должен расти от keepalive.
 */
export function parseSendingSseEvent(data: string): ISendingSseEvent | null {
  let payload: unknown

  try {
    payload = JSON.parse(data) as unknown
  } catch {
    return null
  }

  if (payload === null || typeof payload !== 'object') {
    return null
  }

  const sending = parseRemoteSending(payload)

  if (sending === null) {
    return null
  }

  const typeSend = (payload as Record<string, unknown>)['type_send']

  if (!isSendingSseType(typeSend)) {
    return null
  }

  return {
    ...sending,
    type_send: typeSend,
  }
}
