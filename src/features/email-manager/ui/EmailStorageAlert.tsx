import { Alert, AlertDescription } from '@/shared/ui'

/** Shown when Supabase is configured but `public.emails` was not created yet. */
export function EmailStorageAlert({ message }: { readonly message: string }) {
  return (
    <Alert variant="warning">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}
