/**
 * Branded HTML shell and preset templates for Email manager.
 */

export const MOCK_FROM = 'support@etwalletx.com'

export const EMAIL_TEMPLATE_ID = {
  Branded: 'branded',
  Welcome: 'welcome',
  Security: 'security',
  Plain: 'plain',
} as const

export type EmailTemplateId = (typeof EMAIL_TEMPLATE_ID)[keyof typeof EMAIL_TEMPLATE_ID]

export interface IEmailTemplateFields {
  readonly subject: string
  readonly headline: string
  readonly body: string
  readonly ctaLabel: string
  readonly ctaUrl: string
  readonly cardDetail: string
  readonly plainText: string
}

export interface IEmailTemplateDefinition {
  readonly id: EmailTemplateId
  readonly label: string
  readonly defaults: IEmailTemplateFields
}

const PLACEHOLDER_HEADLINE = '[Your headline goes here]'
const PLACEHOLDER_BODY =
  '[This is placeholder body text. Explain what this email is about, why the recipient is getting it, and what you\'d like them to do next. Keep it short — two to three sentences reads best.]'
const PLACEHOLDER_CTA = '[Call to action]'
const PLACEHOLDER_CARD =
  '[Optional supporting detail, e.g. transaction summary, account info, or reference number can go in this card.]'

export const EMAIL_HTML_TEMPLATE = `<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ETWallet</title>
</head>
<body style="margin:0; padding:0; background-color:#0d0b18;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0d0b18;">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%; background-color:#15111f; border-radius:16px; overflow:hidden; border:1px solid #2a2440;">
        <tr>
          <td align="center" style="padding:36px 24px 24px 24px;">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" valign="middle" style="width:52px; height:52px; background-color:#5b21b6; border-radius:14px;">
                  <span style="font-family: Arial, Helvetica, sans-serif; font-size:19px; font-weight:bold; color:#ffffff; letter-spacing:0.5px;">ET</span>
                </td>
              </tr>
            </table>
            <div style="font-family: Arial, Helvetica, sans-serif; font-size:18px; font-weight:bold; color:#ffffff; margin-top:12px;">
              ETWallet
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:0 24px;">
            <div style="border-top:1px solid #2a2440; line-height:0; font-size:0;"> </div>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:32px 32px 8px 32px;">
            <div style="font-family: Arial, Helvetica, sans-serif; font-size:24px; font-weight:bold; color:#ffffff; line-height:32px;">
              ${PLACEHOLDER_HEADLINE}
            </div>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:8px 40px 28px 40px;">
            <div style="font-family: Arial, Helvetica, sans-serif; font-size:14.5px; color:#a8a3bd; line-height:22px;">
              ${PLACEHOLDER_BODY}
            </div>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:0 32px 36px 32px;">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" style="border-radius:10px; background-color:#6d28d9;">
                  <a href="https://www.etwallet.com" target="_blank" style="display:inline-block; padding:14px 40px; font-family: Arial, Helvetica, sans-serif; font-size:15px; font-weight:bold; color:#ffffff; text-decoration:none; border-radius:10px;">
                    ${PLACEHOLDER_CTA}
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 32px 32px 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#1c1730; border-radius:12px; border:1px solid #2a2440;">
              <tr>
                <td style="padding:18px 20px;">
                  <div style="font-family: Arial, Helvetica, sans-serif; font-size:13px; color:#a8a3bd; line-height:20px;">
                    ${PLACEHOLDER_CARD}
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 24px;">
            <div style="border-top:1px solid #2a2440; line-height:0; font-size:0;"> </div>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:0 32px 36px 32px;">
            <div style="font-family: Arial, Helvetica, sans-serif; font-size:11.5px; color:#6b6580; line-height:18px;">
              ETWallet · Secure self-custody wallet
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>

</body>
</html>
`

export const EMAIL_TEMPLATES: readonly IEmailTemplateDefinition[] = [
  {
    id: EMAIL_TEMPLATE_ID.Branded,
    label: 'Branded',
    defaults: {
      subject: 'ETWallet',
      headline: 'Your ETWallet update',
      body: 'We wanted to share a quick update about your wallet. Open ETWallet to review the latest activity on your account.',
      ctaLabel: 'Open ETWallet',
      ctaUrl: 'https://www.etwallet.com',
      cardDetail: 'Need help? Reply to this email and our team will follow up.',
      plainText: '',
    },
  },
  {
    id: EMAIL_TEMPLATE_ID.Welcome,
    label: 'Welcome',
    defaults: {
      subject: 'Welcome to ETWallet',
      headline: 'Welcome to ETWallet',
      body: 'Your wallet is ready. You stay in control of your keys, assets, and approvals — ETWallet never holds your funds.',
      ctaLabel: 'Finish setup',
      ctaUrl: 'https://www.etwallet.com',
      cardDetail: 'Tip: back up your recovery phrase before sending your first transaction.',
      plainText: '',
    },
  },
  {
    id: EMAIL_TEMPLATE_ID.Security,
    label: 'Security',
    defaults: {
      subject: 'Security notice from ETWallet',
      headline: 'Review a recent sign-in',
      body: 'We noticed activity on your ETWallet account. If this was you, no action is needed. If not, secure your wallet immediately.',
      ctaLabel: 'Review activity',
      ctaUrl: 'https://www.etwallet.com',
      cardDetail: 'ETWallet support will never ask for your seed phrase or private keys.',
      plainText: '',
    },
  },
  {
    id: EMAIL_TEMPLATE_ID.Plain,
    label: 'Custom',
    defaults: {
      subject: '',
      headline: '',
      body: '',
      ctaLabel: '',
      ctaUrl: '',
      cardDetail: '',
      plainText: '',
    },
  },
]

export function templateDefinition(id: EmailTemplateId): IEmailTemplateDefinition {
  const found = EMAIL_TEMPLATES.find((entry) => entry.id === id)

  if (found === undefined) {
    return EMAIL_TEMPLATES[0]!
  }

  return found
}

export function isEmailTemplateId(value: string): value is EmailTemplateId {
  return (Object.values(EMAIL_TEMPLATE_ID) as readonly string[]).includes(value)
}

/** Fills the branded HTML shell with user-editable fields. */
export function renderBrandedHtml(fields: IEmailTemplateFields): string {
  return EMAIL_HTML_TEMPLATE.replaceAll(PLACEHOLDER_HEADLINE, escapeHtml(fields.headline))
    .replaceAll(PLACEHOLDER_BODY, escapeHtml(fields.body))
    .replaceAll(PLACEHOLDER_CTA, escapeHtml(fields.ctaLabel))
    .replaceAll(PLACEHOLDER_CARD, escapeHtml(fields.cardDetail))
    .replace('href="https://www.etwallet.com"', `href="${escapeAttribute(fields.ctaUrl)}"`)
}

/** Builds the payload sent to POST /v1/admin/email/send. */
export function buildEmailPayload(
  templateId: EmailTemplateId,
  fields: IEmailTemplateFields,
): { readonly subject: string; readonly html: string; readonly text: string } | null {
  const subject = fields.subject.trim()

  if (subject === '') {
    return null
  }

  if (templateId === EMAIL_TEMPLATE_ID.Plain) {
    const text = fields.plainText.trim()

    if (text === '') {
      return null
    }

    return { subject, html: wrapPlainTextHtml(text), text }
  }

  const headline = fields.headline.trim()
  const body = fields.body.trim()
  const ctaLabel = fields.ctaLabel.trim()

  if (headline === '' || body === '' || ctaLabel === '') {
    return null
  }

  const html = renderBrandedHtml(fields)
  const text = [
    'ETWallet',
    '',
    headline,
    '',
    body,
    '',
    ctaLabel,
    fields.ctaUrl.trim(),
    '',
    fields.cardDetail.trim(),
  ]
    .filter((line, index, all) => line !== '' || (index > 0 && all[index - 1] !== ''))
    .join('\n')

  return { subject, html, text }
}

function wrapPlainTextHtml(text: string): string {
  const escaped = escapeHtml(text).replaceAll('\n', '<br>')

  return `<html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111;">${escaped}</body></html>`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("'", '&#39;')
}

/** Legacy exports used by older tests. */
export const MOCK_SUBJECT = EMAIL_TEMPLATES[0]!.defaults.subject
export const MOCK_TEXT = 'ETWallet\n\nYour ETWallet update\n\nWe wanted to share a quick update about your wallet.'
export const MOCK_TO = MOCK_FROM
