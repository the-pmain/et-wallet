import { Alert, AlertDescription } from '@/shared/ui'

/** Shown when Cloudflare inbound mailbox setup is incomplete. */
export function EmailStorageAlert({ message }: { readonly message: string }) {
  return (
    <Alert variant="warning">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}
