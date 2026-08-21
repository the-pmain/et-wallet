/**
 * Грубый текст письма из HTML, если кабинет не прислал `text`.
 *
 * Cloudflare принимает html без text, но почтовые клиенты без HTML
 * тогда показывают пустое тело. Снимаем теги, а не пытаемся
 * воссоздать вёрстку.
 */

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?\s*>/giu, '\n')
    .replace(/<\s*\/p\s*>/giu, '\n\n')
    .replace(/<\s*\/div\s*>/giu, '\n')
    .replace(/<\s*\/h[1-6]\s*>/giu, '\n\n')
    .replace(/<\s*li\s*>/giu, '• ')
    .replace(/<\s*\/li\s*>/giu, '\n')
    .replace(/<[^>]+>/gu, '')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/\n{3,}/gu, '\n\n')
    .replace(/[^\S\n]+/gu, ' ')
    .trim()
}

export function wrapPlainTextAsHtml(text: string): string {
  const escaped = text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')

  return `<p>${escaped.replace(/\n/gu, '<br>')}</p>`
}

export function isBlankHtml(html: string): boolean {
  return htmlToPlainText(html) === ''
}
