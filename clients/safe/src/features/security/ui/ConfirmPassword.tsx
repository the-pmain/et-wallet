import { KeyRound } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'

import { Alert, AlertDescription, Button, Input, Label } from '@/shared/ui'

interface ConfirmPasswordProps {
  /** What is being confirmed. Shown to the user. */
  readonly action: string

  readonly onVerify: (password: string) => Promise<boolean>

  readonly onConfirmed: () => void

  readonly onCancel: () => void
}

/**
 * Re-enter the password before a risky action.
 *
 * WHAT THIS PROTECTS AGAINST. Someone who already has an unlocked
 * wallet: an unattended device, a shared-computer session, an
 * extension that waited for unlock. The password is not a second
 * factor — it confirms the owner is present at the moment of the
 * action.
 *
 * THE PASSWORD IS NOT SAVED AND NOT PASSED ON. It goes into the
 * check and is removed from state immediately. A JavaScript string
 * cannot be wiped — it lives until garbage collection — but the
 * extra React-tree reference is dropped.
 *
 * THE ERROR MESSAGE DOES NOT DISTINGUISH CAUSES. "Wrong password"
 * and "storage is damaged" are information for someone guessing.
 */
export function ConfirmPassword({ action, onVerify, onConfirmed, onCancel }: ConfirmPasswordProps) {
  const passwordId = useId()

  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setBusy] = useState(false)

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      const isValid = await onVerify(password)

      /* The password is cleared regardless of outcome: on a refusal
         it especially must not stay in the component tree. */
      setPassword('')

      if (isValid) {
        onConfirmed()
      } else {
        setError('Wrong password.')
      }
    } catch {
      setError('The password could not be checked.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-4 rounded-xl border p-4"
      onSubmit={(event) => {
        void submit(event)
      }}
    >
      <div className="flex items-start gap-2">
        <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-sm">
          Confirm with your password: <span className="font-medium">{action}</span>
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={passwordId}>Password</Label>
        <Input
          id={passwordId}
          type="password"
          value={password}
          disabled={isBusy}
          autoFocus
          autoComplete="current-password"
          autoCapitalize="off"
          autoCorrect="off"
          aria-invalid={error !== null}
          onChange={(event) => {
            setPassword(event.target.value)
            setError(null)
          }}
        />
      </div>

      {error === null ? null : (
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          disabled={isBusy}
          onClick={onCancel}
        >
          Cancel
        </Button>

        <Button type="submit" className="flex-1" disabled={isBusy || password.length === 0}>
          {isBusy ? 'Checking…' : 'Confirm'}
        </Button>
      </div>
    </form>
  )
}
