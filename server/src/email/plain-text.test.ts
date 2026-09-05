import { describe, expect, it } from 'vitest'

import { htmlToPlainText, isBlankHtml, wrapPlainTextAsHtml } from './plain-text.ts'

describe('htmlToPlainText', () => {
  it('strips tags and keeps paragraphs', () => {
    expect(htmlToPlainText('<h1>Hello</h1><p>World</p>')).toBe('Hello\n\nWorld')
  })

  it('treats HTML without text as blank', () => {
    expect(isBlankHtml('<p><br></p>')).toBe(true)
    expect(isBlankHtml('<p>Hi</p>')).toBe(false)
  })

  it('wraps plain text in a paragraph', () => {
    expect(wrapPlainTextAsHtml('Hello\nthere')).toBe('<p>Hello<br>there</p>')
  })
})
