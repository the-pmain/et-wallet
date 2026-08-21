/**
 * Единственный HTML-шаблон письма. Содержимое зашито: форма полей нет,
 * предпросмотр и отправка используют этот документ как есть.
 */
export const EMAIL_HTML_TEMPLATE = `<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ETWallet</title>
</head>
<body style="margin:0; padding:0; background-color:#0d0b18;">

<!-- Outer wrapper -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0d0b18;">
  <tr>
    <td align="center" style="padding:40px 16px;">

      <!-- Email container -->
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%; background-color:#15111f; border-radius:16px; overflow:hidden; border:1px solid #2a2440;">

        <!-- Header / logo -->
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

        <!-- Divider -->
        <tr>
          <td style="padding:0 24px;">
            <div style="border-top:1px solid #2a2440; line-height:0; font-size:0;"> </div>
          </td>
        </tr>

        <!-- Headline -->
        <tr>
          <td align="center" style="padding:32px 32px 8px 32px;">
            <div style="font-family: Arial, Helvetica, sans-serif; font-size:24px; font-weight:bold; color:#ffffff; line-height:32px;">
              [Your headline goes here]
            </div>
          </td>
        </tr>

        <!-- Body copy -->
        <tr>
          <td align="center" style="padding:8px 40px 28px 40px;">
            <div style="font-family: Arial, Helvetica, sans-serif; font-size:14.5px; color:#a8a3bd; line-height:22px;">
              [This is placeholder body text. Explain what this email is about, why the recipient is getting it, and what you'd like them to do next. Keep it short — two to three sentences reads best.]
            </div>
          </td>
        </tr>

        <!-- CTA button -->
        <tr>
          <td align="center" style="padding:0 32px 36px 32px;">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" style="border-radius:10px; background-color:#6d28d9;">
                  <a href="https://www.etwallet.com" target="_blank" style="display:inline-block; padding:14px 40px; font-family: Arial, Helvetica, sans-serif; font-size:15px; font-weight:bold; color:#ffffff; text-decoration:none; border-radius:10px;">
                    [Call to action]
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Secondary info card (optional section) -->
        <tr>
          <td style="padding:0 32px 32px 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#1c1730; border-radius:12px; border:1px solid #2a2440;">
              <tr>
                <td style="padding:18px 20px;">
                  <div style="font-family: Arial, Helvetica, sans-serif; font-size:13px; color:#a8a3bd; line-height:20px;">
                    [Optional supporting detail, e.g. transaction summary, account info, or reference number can go in this card.]
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Divider -->
        <tr>
          <td style="padding:0 24px;">
            <div style="border-top:1px solid #2a2440; line-height:0; font-size:0;"> </div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td align="center" style="padding:28px 32px 12px 32px;">
            <a href="https://twitter.com/etwallet" style="text-decoration:none; margin:0 6px;">
              <span style="display:inline-block; width:26px; height:26px; line-height:26px; text-align:center; background-color:#2a2440; border-radius:7px; color:#ffffff; font-family: Arial, sans-serif; font-size:12px;">X</span>
            </a>
            <a href="https://linkedin.com/company/etwallet" style="text-decoration:none; margin:0 6px;">
              <span style="display:inline-block; width:26px; height:26px; line-height:26px; text-align:center; background-color:#2a2440; border-radius:7px; color:#ffffff; font-family: Arial, sans-serif; font-size:12px;">in</span>
            </a>
            <a href="https://t.me/etwallet" style="text-decoration:none; margin:0 6px;">
              <span style="display:inline-block; width:26px; height:26px; line-height:26px; text-align:center; background-color:#2a2440; border-radius:7px; color:#ffffff; font-family: Arial, sans-serif; font-size:12px;">TG</span>
            </a>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:0 32px 36px 32px;">
            <div style="font-family: Arial, Helvetica, sans-serif; font-size:11.5px; color:#6b6580; line-height:18px;">
              ETWallet · [Company Address, City, Country]<br>
              You're receiving this email because you have an ETWallet account.<br>
              <a href="#" style="color:#8b7fc9; text-decoration:underline;">Unsubscribe</a>
               · 
              <a href="#" style="color:#8b7fc9; text-decoration:underline;">Privacy Policy</a>
            </div>
          </td>
        </tr>

      </table>
      <!-- /Email container -->

    </td>
  </tr>
</table>
<!-- /Outer wrapper -->

</body>
</html>
`

export const MOCK_FROM = 'support@etwalletx.com'
export const MOCK_TO = 'support@etwalletx.com'
export const MOCK_SUBJECT = 'ETWallet'
export const MOCK_TEXT =
  'ETWallet\n\n[Your headline goes here]\n\n[This is placeholder body text.]\n\n[Call to action]\nhttps://www.etwallet.com'
