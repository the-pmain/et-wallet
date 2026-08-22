import { Alert, AlertDescription } from '@/shared/ui'

/** Shown when Cloudflare Email Sending is not configured on the server. */
export function EmailConfiguredAlert() {
  return (
    <Alert variant="warning">
      <AlertDescription>
        Email sending is not configured. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN on
        the server. A Global API Key (cfk_) also needs CLOUDFLARE_EMAIL. Then restart.
      </AlertDescription>
    </Alert>
  )
}
