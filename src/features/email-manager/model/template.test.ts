import { describe, expect, it } from 'vitest'

import { EMAIL_HTML_TEMPLATE, MOCK_FROM } from './template'

describe('email template', () => {
  it('держит зашитый макет ETWallet', () => {
    expect(EMAIL_HTML_TEMPLATE).toContain('ETWallet')
    expect(EMAIL_HTML_TEMPLATE).toContain('[Your headline goes here]')
    expect(EMAIL_HTML_TEMPLATE).toContain('[Call to action]')
    expect(EMAIL_HTML_TEMPLATE).toContain('href="https://www.etwallet.com"')
    expect(EMAIL_HTML_TEMPLATE).toContain('background-color:#0d0b18')
  })

  it('отправляет с зашитого адреса поддержки', () => {
    expect(MOCK_FROM).toBe('support@etwalletx.com')
  })
})
