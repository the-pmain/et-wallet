import type { IAdminEmailMessage } from '@/features/admin'

export interface IEmailConversation {
  readonly id: string
  readonly counterparty: string
  readonly messages: readonly IAdminEmailMessage[]
  readonly lastMessageAt: string
  readonly lastSubject: string
  readonly sentCount: number
  readonly receivedCount: number
}

/** URL-safe id for a counterparty address. */
export function conversationIdForEmail(email: string): string {
  return encodeURIComponent(email.trim().toLowerCase())
}

/** Counterparty address from a stored message. */
export function counterpartyForMessage(message: IAdminEmailMessage): string {
  return message.direction === 'sent' ? message.to : message.from
}

/** Groups flat messages into conversations sorted by latest activity. */
export function groupMessagesIntoConversations(
  messages: readonly IAdminEmailMessage[],
): readonly IEmailConversation[] {
  const buckets = new Map<string, IAdminEmailMessage[]>()

  for (const message of messages) {
    const counterparty = counterpartyForMessage(message).trim().toLowerCase()
    const existing = buckets.get(counterparty) ?? []
    existing.push(message)
    buckets.set(counterparty, existing)
  }

  const conversations: IEmailConversation[] = []

  for (const [counterparty, thread] of buckets) {
    const sorted = [...thread].sort(
      (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
    )
    const latest = sorted[0]

    if (latest === undefined) {
      continue
    }

    conversations.push({
      id: conversationIdForEmail(counterparty),
      counterparty,
      messages: [...thread].sort(
        (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
      ),
      lastMessageAt: latest.createdAt,
      lastSubject: latest.subject,
      sentCount: thread.filter((entry) => entry.direction === 'sent').length,
      receivedCount: thread.filter((entry) => entry.direction === 'received').length,
    })
  }

  return conversations.sort(
    (left, right) => Date.parse(right.lastMessageAt) - Date.parse(left.lastMessageAt),
  )
}

export function conversationMatchesQuery(
  conversation: IEmailConversation,
  needle: string,
): boolean {
  if (needle === '') {
    return true
  }

  if (conversation.counterparty.includes(needle)) {
    return true
  }

  return conversation.messages.some(
    (message) =>
      message.subject.toLowerCase().includes(needle) ||
      (message.text ?? '').toLowerCase().includes(needle),
  )
}

export function findConversationById(
  conversations: readonly IEmailConversation[],
  id: string,
): IEmailConversation | null {
  let decoded = id

  try {
    decoded = decodeURIComponent(id)
  } catch {
    decoded = id
  }

  const needle = decoded.trim().toLowerCase()

  return (
    conversations.find((entry) => entry.id === id || entry.counterparty === needle) ?? null
  )
}
