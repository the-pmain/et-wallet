import { parseRemoteSending, type IRemoteSending } from './RemoteUserDirectory'

/** Why a frame was pushed into the `sendings` stream. */
export const SENDING_SSE_TYPE = {
  Create: 'create',
  Update: 'update',
} as const

export type SendingSseType = (typeof SENDING_SSE_TYPE)[keyof typeof SENDING_SSE_TYPE]

/** `event: sendings` frame. Same fields as a transfer record, plus `type_send`. */
export interface ISendingSseEvent extends IRemoteSending {
  readonly type_send: SendingSseType
}

function isSendingSseType(value: unknown): value is SendingSseType {
  return value === SENDING_SSE_TYPE.Create || value === SENDING_SSE_TYPE.Update
}

/**
 * Parse SSE frame `data`. Broken JSON and a frame without `type_send`
 * are dropped: the cabinet list must not grow from keepalive.
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
