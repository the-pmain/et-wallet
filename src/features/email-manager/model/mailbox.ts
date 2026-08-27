export const MAILBOX_PAGE_SIZE = 20

export function peerFromConversationId(conversationId: string | undefined): string | null {
  if (conversationId === undefined || conversationId.trim() === '') {
    return null
  }

  try {
    return decodeURIComponent(conversationId).trim().toLowerCase()
  } catch {
    return conversationId.trim().toLowerCase()
  }
}
