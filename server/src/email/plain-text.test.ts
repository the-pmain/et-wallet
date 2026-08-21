import { describe, expect, it } from 'vitest'

import { htmlToPlainText, isBlankHtml, wrapPlainTextAsHtml } from './plain-text.ts'

describe('htmlToPlainText', () => {
  it('снимает теги и сохраняет абзацы', () => {
    expect(htmlToPlainText('<h1>Hello</h1><p>World</p>')).toBe('Hello\n\nWorld')
  })

  it('считает пустым HTML без текста', () => {
    expect(isBlankHtml('<p><br></p>')).toBe(true)
    expect(isBlankHtml('<p>Hi</p>')).toBe(false)
  })

  it('оборачивает обычный текст в абзац', () => {
    expect(wrapPlainTextAsHtml('Hello\nthere')).toBe('<p>Hello<br>there</p>')
  })
})
