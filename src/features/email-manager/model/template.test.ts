import { describe, expect, it } from 'vitest'

import {
  buildEmailPayload,
  EMAIL_HTML_TEMPLATE,
  EMAIL_TEMPLATE_ID,
  EMAIL_TEMPLATES,
  MOCK_FROM,
  renderBrandedHtml,
  templateDefinition,
} from './template'

describe('email template', () => {
  it('держит брендированный макет ETWallet', () => {
    const html = renderBrandedHtml(templateDefinition(EMAIL_TEMPLATE_ID.Branded).defaults)

    expect(html).toContain('ETWallet')
    expect(html).toContain('Your ETWallet update')
    expect(html).toContain('Open ETWallet')
    expect(html).toContain('href="https://www.etwallet.com"')
    expect(html).toContain('background-color:#0d0b18')
    expect(EMAIL_HTML_TEMPLATE).toContain('[Your headline goes here]')
  })

  it('отправляет с зашитого адреса поддержки', () => {
    expect(MOCK_FROM).toBe('support@etwalletx.com')
  })

  it('собирает plain-text письмо', () => {
    const payload = buildEmailPayload(EMAIL_TEMPLATE_ID.Plain, {
      ...templateDefinition(EMAIL_TEMPLATE_ID.Plain).defaults,
      subject: 'Quick note',
      plainText: 'Hello there',
    })

    expect(payload).toEqual({
      subject: 'Quick note',
      text: 'Hello there',
      html: expect.stringContaining('Hello there'),
    })
  })

  it('собирает welcome-шаблон', () => {
    const defaults = templateDefinition(EMAIL_TEMPLATE_ID.Welcome).defaults
    const payload = buildEmailPayload(EMAIL_TEMPLATE_ID.Welcome, defaults)

    expect(payload?.subject).toBe('Welcome to ETWallet')
    expect(payload?.html).toContain('Welcome to ETWallet')
    expect(payload?.text).toContain('Finish setup')
  })

  it('экспортирует четыре пресета', () => {
    expect(EMAIL_TEMPLATES.map((entry) => entry.id)).toEqual([
      'branded',
      'welcome',
      'security',
      'plain',
    ])
  })
})
