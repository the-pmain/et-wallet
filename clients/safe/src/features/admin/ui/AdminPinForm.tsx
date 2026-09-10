import { Delete, Shield } from 'lucide-react'
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { cn } from '@/shared/lib/utils'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Label,
} from '@/shared/ui'

const PIN_LENGTH = 4

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

interface AdminPinFormProps {
  readonly title?: string
  readonly description?: string
  readonly error: string | null
  readonly isBusy: boolean
  readonly onInteract?: () => void
  readonly onSubmit: (pin: string) => void
}

/**
 * First cabinet screen: PIN only.
 *
 * The server checks the value. The form does not know the correct code.
 */
export function AdminPinForm({
  title = 'Admin',
  description = 'Enter the PIN to manage users and wallet balances.',
  error,
  isBusy,
  onInteract,
  onSubmit,
}: AdminPinFormProps) {
  const pinId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const pinRef = useRef('')
  const [pin, setPin] = useState('')

  useLayoutEffect(() => {
    if (error !== null) {
      pinRef.current = ''
      setPin('')
    }
  }, [error])

  const setDigits = (next: string) => {
    const digits = next.replace(/\D/gu, '').slice(0, PIN_LENGTH)

    if (error !== null) {
      onInteract?.()
    }

    pinRef.current = digits
    setPin(digits)

    if (digits.length === PIN_LENGTH && !isBusy) {
      onSubmit(digits)
    }
  }

  const pressDigit = (digit: string) => {
    setDigits(pinRef.current + digit)
    inputRef.current?.focus()
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-[20.5rem] gap-3 py-4">
        <CardHeader className="gap-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Shield className="size-4" aria-hidden />
          </div>
          <div className="flex flex-col gap-1">
            <CardTitle as="h1">{title}</CardTitle>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col items-center gap-2.5">
              <div className="flex flex-col items-center gap-1.5">
                <Label htmlFor={pinId}>PIN</Label>
                <div className="flex items-center gap-2.5" aria-hidden>
                  {Array.from({ length: PIN_LENGTH }, (_, index) => (
                    <span
                      key={index}
                      className={cn(
                        'size-2.5 rounded-full border-2 transition-colors',
                        index < pin.length
                          ? 'border-primary bg-primary'
                          : 'border-muted-foreground/35 bg-transparent',
                      )}
                    />
                  ))}
                </div>
              </div>
              <input
                ref={inputRef}
                id={pinId}
                className="sr-only"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                maxLength={PIN_LENGTH}
                value={pin}
                disabled={isBusy}
                aria-invalid={error !== null}
                onChange={(event) => {
                  setDigits(event.target.value)
                }}
              />
              <p className="sr-only" aria-live="polite">
                {pin.length} of {PIN_LENGTH} digits entered
              </p>

              <div className="grid w-full grid-cols-3 gap-1.5" role="group" aria-label="PIN keypad">
                {DIGITS.map((digit) => (
                  <Key key={digit} disabled={isBusy} onPress={() => pressDigit(digit)}>
                    {digit}
                  </Key>
                ))}
                <Key
                  muted
                  disabled={isBusy}
                  ariaLabel="Clear"
                  onPress={() => {
                    setDigits('')
                    inputRef.current?.focus()
                  }}
                >
                  Clear
                </Key>
                <Key disabled={isBusy} onPress={() => pressDigit('0')}>
                  0
                </Key>
                <Key
                  muted
                  disabled={isBusy}
                  ariaLabel="Backspace"
                  onPress={() => {
                    setDigits(pinRef.current.slice(0, -1))
                    inputRef.current?.focus()
                  }}
                >
                  <Delete className="size-5" strokeWidth={1.75} aria-hidden />
                </Key>
              </div>
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
            {isBusy && error === null ? (
              <p className="text-center text-sm text-muted-foreground">Checking…</p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Key({
  children,
  ariaLabel,
  muted = false,
  disabled,
  onPress,
}: {
  readonly children: ReactNode
  readonly ariaLabel?: string
  readonly muted?: boolean
  readonly disabled: boolean
  readonly onPress: () => void
}) {
  return (
    <Button
      type="button"
      variant="outline"
      aria-label={ariaLabel}
      disabled={disabled}
      className={cn(
        'h-12 rounded-lg text-lg font-semibold',
        muted && 'text-sm font-medium text-muted-foreground',
      )}
      onClick={onPress}
    >
      {children}
    </Button>
  )
}
