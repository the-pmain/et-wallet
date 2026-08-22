import type { IAdminEmailMessage } from '@/features/admin'

/** Branded ETWallet HTML shell used by template sends. */
export function messageIsBrandedTemplate(message: IAdminEmailMessage): boolean {
  const html = message.html?.trim() ?? ''

  if (html === '') {
    return looksLikeTemplateTextDump(message.text?.trim() ?? '')
  }

  return (
    html.includes('background-color:#15111f') &&
    html.includes('background-color:#0d0b18') &&
    html.includes('ETWallet') &&
    html.includes('role="presentation"')
  )
}

/** Prefer the rendered HTML frame for template sends and html-only mail. */
export function shouldShowHtmlPreview(message: IAdminEmailMessage): boolean {
  if (!messageHasHtmlPreview(message)) {
    return false
  }

  if (messageIsBrandedTemplate(message)) {
    return true
  }

  return messagePreviewText(message) === ''
}

/** Plain-text body for non-template messages. */
export function messageDisplayText(message: IAdminEmailMessage): string | null {
  if (shouldShowHtmlPreview(message)) {
    return null
  }

  const preview = messagePreviewText(message)

  return preview === '' ? null : preview
}

/** Plain-text preview for a stored message. */
export function messagePreviewText(message: IAdminEmailMessage): string {
  if (message.text !== null && message.text.trim() !== '') {
    return message.text.trim()
  }

  if (message.html !== null && message.html.trim() !== '') {
    return stripHtml(message.html)
  }

  return ''
}

/** Whether the message has HTML worth rendering in a preview frame. */
export function messageHasHtmlPreview(message: IAdminEmailMessage): boolean {
  return message.html !== null && message.html.trim() !== '' && looksLikeHtml(message.html)
}

function looksLikeTemplateTextDump(text: string): boolean {
  return (
    text.includes('[Your headline goes here]') ||
    text.includes('[Call to action]') ||
    (text.startsWith('ETWallet') && text.includes('[This is placeholder body text'))
  )
}

function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/giu, ' ')
    .replace(/<script[\s\S]*?<\/script>/giu, ' ')
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<\/p>/giu, '\n\n')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+\n/gu, '\n')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

function looksLikeHtml(value: string): boolean {
  return /<html[\s>]/iu.test(value) || /<body[\s>]/iu.test(value) || /<table[\s>]/iu.test(value)
}
