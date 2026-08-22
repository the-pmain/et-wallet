import { describe, expect, it } from 'vitest'

import {
  messageDisplayText,
  messageHasHtmlPreview,
  messageIsBrandedTemplate,
  messagePreviewText,
  shouldShowHtmlPreview,
} from './message-body'

describe('messagePreviewText', () => {
  it('prefers plain text', () => {
    expect(
      messagePreviewText({
        id: '1',
        createdAt: '2026-08-21T12:00:00.000Z',
        direction: 'received',
        from: 'a@example.com',
        to: 'b@example.com',
        subject: 'Hi',
        html: '<html><body><p>ignored</p></body></html>',
        text: 'Hello',
        status: 'received',
      }),
    ).toBe('Hello')
  })

  it('strips html when text is empty', () => {
    expect(
      messagePreviewText({
        id: '1',
        createdAt: '2026-08-21T12:00:00.000Z',
        direction: 'received',
        from: 'a@example.com',
        to: 'b@example.com',
        subject: 'Hi',
        html: '<html><body><p>Hello<br>world</p></body></html>',
        text: null,
        status: 'received',
      }),
    ).toContain('Hello')
  })
})

describe('messageHasHtmlPreview', () => {
  it('detects html documents', () => {
    expect(
      messageHasHtmlPreview({
        id: '1',
        createdAt: '2026-08-21T12:00:00.000Z',
        direction: 'sent',
        from: 'a@example.com',
        to: 'b@example.com',
        subject: 'Hi',
        html: '<html><body>Hi</body></html>',
        text: null,
        status: 'sent',
      }),
    ).toBe(true)
  })
})

describe('template messages', () => {
  const brandedHtml = `<html><body style="background-color:#0d0b18;">
    <table role="presentation"><tr><td style="background-color:#15111f;">ETWallet</td></tr></table>
  </body></html>`

  it('detects branded template html', () => {
    expect(
      messageIsBrandedTemplate({
        id: '1',
        createdAt: '2026-08-21T12:00:00.000Z',
        direction: 'sent',
        from: 'a@example.com',
        to: 'b@example.com',
        subject: 'ETWallet',
        html: brandedHtml,
        text: 'ETWallet\n\n[Your headline goes here]',
        status: 'queued',
      }),
    ).toBe(true)
  })

  it('shows html preview instead of placeholder text dump', () => {
    const message = {
      id: '1',
      createdAt: '2026-08-21T12:00:00.000Z',
      direction: 'sent' as const,
      from: 'a@example.com',
      to: 'b@example.com',
      subject: 'ETWallet',
      html: brandedHtml,
      text: 'ETWallet\n\n[Your headline goes here]\n\n[This is placeholder body text.]',
      status: 'queued',
    }

    expect(shouldShowHtmlPreview(message)).toBe(true)
    expect(messageDisplayText(message)).toBeNull()
  })

  it('keeps plain custom messages as text', () => {
    const message = {
      id: '1',
      createdAt: '2026-08-21T12:00:00.000Z',
      direction: 'sent' as const,
      from: 'a@example.com',
      to: 'b@example.com',
      subject: 'Quick note',
      html: '<html><body>Hello there</body></html>',
      text: 'Hello there',
      status: 'delivered',
    }

    expect(messageIsBrandedTemplate(message)).toBe(false)
    expect(shouldShowHtmlPreview(message)).toBe(false)
    expect(messageDisplayText(message)).toBe('Hello there')
  })
})
