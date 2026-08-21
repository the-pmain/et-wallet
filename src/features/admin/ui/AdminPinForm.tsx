import { Shield } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'

import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@/shared/ui'

interface AdminPinFormProps {
  readonly title?: string
  readonly description?: string
  readonly error: string | null
  readonly isBusy: boolean
  readonly onSubmit: (pin: string) => void
}

/**
 * Первый экран кабинета: только PIN.
 *
 * Значение сверяет сервер. Форма не знает правильного кода.
 */
export function AdminPinForm({
  title = 'Admin',
  description = 'Enter the PIN to manage users and wallet balances.',
  error,
  isBusy,
  onSubmit,
}: AdminPinFormProps) {
  const pinId = useId()
  const [pin, setPin] = useState('')
  const canSubmit = pin.trim() !== '' && !isBusy

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()

    if (!canSubmit) {
      return
    }

    onSubmit(pin.trim())
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="gap-3">
          <div className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Shield aria-hidden />
          </div>
          <CardTitle as="h1">{title}</CardTitle>
          <p className="text-sm text-muted-foreground">{description}</p>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor={pinId}>PIN</Label>
              <Input
                id={pinId}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                value={pin}
                disabled={isBusy}
                aria-invalid={error !== null}
                onChange={(event) => {
                  setPin(event.target.value)
                }}
              />
            </div>
            {error === 'wrong' ? (
              <Alert variant="warning">
                <AlertDescription>That PIN is not accepted.</AlertDescription>
              </Alert>
            ) : null}
            {error === 'unavailable' ? (
              <Alert variant="warning">
                <AlertDescription>The admin service is unavailable.</AlertDescription>
              </Alert>
            ) : null}
            <Button type="submit" disabled={!canSubmit}>
              {isBusy ? 'Checking…' : 'Unlock'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
