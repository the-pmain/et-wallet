import { Plus, Search, ShieldAlert } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'

import {
  TokenImpersonationError,
  isValidAddress,
  toAddress,
  type Address,
  type ITokenMetadata,
} from '@/core'
import { UntrustedText } from '@/features/security'
import { Alert, AlertDescription, AlertTitle, Button, Input, Label } from '@/shared/ui'

import { TokenAvatar } from './TokenAvatar'

interface ImportTokenFormProps {
  readonly onPreview: (address: Address) => Promise<ITokenMetadata>
  readonly onAdd: (
    address: Address,
    symbolOverride?: string,
    allowImpersonation?: boolean,
  ) => Promise<void>
}

/**
 * Импорт токена по адресу контракта.
 *
 * СНАЧАЛА ПОКАЗ, ПОТОМ ДОБАВЛЕНИЕ. Пользователь обязан увидеть, что
 * сообщает контракт, до того как токен попадёт в список: адрес сам по
 * себе ничего не говорит, а подставленное вслепую имя может оказаться
 * подделкой известного.
 *
 * ЧИСЛО ЗНАКОВ НЕ РЕДАКТИРУЕТСЯ. Оно читается из контракта и определяет
 * порядок величины показанной суммы. Поле для ручного ввода здесь было бы
 * приглашением ошибиться на двенадцать порядков.
 *
 * СИМВОЛ РЕДАКТИРУЕТСЯ. Это подпись на экране, и пользователь вправе
 * назвать токен так, как ему удобно, — например, чтобы отличить подделку
 * от настоящего.
 */
export function ImportTokenForm({ onPreview, onAdd }: ImportTokenFormProps) {
  const fieldId = useId()

  const [address, setAddress] = useState('')
  const [symbol, setSymbol] = useState('')
  const [preview, setPreview] = useState<ITokenMetadata | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [impersonation, setImpersonation] = useState<TokenImpersonationError | null>(null)
  const [isBusy, setBusy] = useState(false)

  const trimmed = address.trim()
  const isAddressValid = trimmed !== '' && isValidAddress(trimmed)

  function reset(nextAddress: string): void {
    setAddress(nextAddress)
    setPreview(null)
    setError(null)
    /* Согласие сбрасывается вместе с адресом: оно давалось
       на конкретный контракт, а не на форму вообще. */
    setImpersonation(null)
    setSymbol('')
  }

  async function loadPreview(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      const metadata = await onPreview(toAddress(trimmed))

      setPreview(metadata)
      setSymbol(metadata.symbol)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  async function confirm(allowImpersonation = false): Promise<void> {
    setBusy(true)
    setError(null)

    try {
      await onAdd(toAddress(trimmed), symbol.trim(), allowImpersonation)
      reset('')
    } catch (caught) {
      if (caught instanceof TokenImpersonationError) {
        setImpersonation(caught)
      } else {
        setError(caught instanceof Error ? caught.message : String(caught))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        void loadPreview(event)
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${fieldId}-address`}>Contract address</Label>
        <div className="flex gap-2">
          <Input
            id={`${fieldId}-address`}
            value={address}
            placeholder="0x"
            autoComplete="off"
            onChange={(event) => {
              reset(event.target.value)
            }}
          />
          <Button type="submit" variant="outline" disabled={isBusy || !isAddressValid}>
            <Search className="size-4" aria-hidden />
            {isBusy ? 'Reading…' : 'Check'}
          </Button>
        </div>
      </div>

      {error === null ? null : (
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {preview === null ? null : (
        <div className="flex flex-col gap-3 rounded-xl border p-3">
          <div className="flex items-center gap-3">
            <TokenAvatar address={trimmed} symbol={preview.symbol} />

            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">
                <UntrustedText value={preview.name} />
              </span>
              <span className="text-xs text-muted-foreground">
                <UntrustedText value={preview.symbol} /> · {String(preview.decimals)} decimals
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${fieldId}-symbol`}>Symbol shown in the wallet</Label>
            <Input
              id={`${fieldId}-symbol`}
              value={symbol}
              autoComplete="off"
              onChange={(event) => {
                setSymbol(event.target.value)
              }}
            />
          </div>

          <Alert variant="warning">
            <ShieldAlert />
            <AlertDescription>
              The name, the symbol and the number of decimals were reported by the contract itself.
              Anyone can issue a token bearing the symbol of a well-known project — check the
              contract address against a source you trust.
            </AlertDescription>
          </Alert>

          {impersonation === null ? (
            <Button
              type="button"
              disabled={isBusy}
              onClick={() => {
                void confirm()
              }}
            >
              <Plus className="size-4" aria-hidden />
              Add the token
            </Button>
          ) : (
            /* ОТКАЗ ПОКАЗЫВАЕТСЯ ВМЕСТО КНОПКИ, А НЕ РЯДОМ С НЕЙ.
               Кнопка «добавить», оставшаяся на месте, нажимается
               по привычке — раньше, чем прочитано предупреждение. */
            <Alert variant="danger">
              <ShieldAlert />
              <AlertTitle>The contract impersonates a known token</AlertTitle>
              <AlertDescription className="flex flex-col gap-3">
                <span>{impersonation.message}</span>

                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={isBusy}
                  onClick={() => {
                    void confirm(true)
                  }}
                >
                  Add anyway
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}
    </form>
  )
}
