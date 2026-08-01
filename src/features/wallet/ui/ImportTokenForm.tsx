import { Plus, Search, ShieldAlert } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'

import { isValidAddress, toAddress, type Address, type ITokenMetadata } from '@/core'
import { Alert, AlertDescription, Button, Input, Label } from '@/shared/ui'

import { TokenAvatar } from './TokenAvatar'

interface ImportTokenFormProps {
  readonly onPreview: (address: Address) => Promise<ITokenMetadata>
  readonly onAdd: (address: Address, symbolOverride?: string) => Promise<void>
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
  const [isBusy, setBusy] = useState(false)

  const trimmed = address.trim()
  const isAddressValid = trimmed !== '' && isValidAddress(trimmed)

  function reset(nextAddress: string): void {
    setAddress(nextAddress)
    setPreview(null)
    setError(null)
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

  async function confirm(): Promise<void> {
    setBusy(true)
    setError(null)

    try {
      await onAdd(toAddress(trimmed), symbol.trim())
      reset('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
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
        <Label htmlFor={`${fieldId}-address`}>Адрес контракта</Label>
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
            {isBusy ? 'Чтение…' : 'Проверить'}
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
              <span className="truncate text-sm font-medium">{preview.name}</span>
              <span className="text-xs text-muted-foreground">
                {preview.symbol} · {String(preview.decimals)} знаков
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${fieldId}-symbol`}>Обозначение в кошельке</Label>
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
              Имя, обозначение и число знаков сообщил сам контракт. Выпустить токен с обозначением
              известного проекта может кто угодно — сверьте адрес контракта с источником, которому
              доверяете.
            </AlertDescription>
          </Alert>

          <Button
            type="button"
            disabled={isBusy}
            onClick={() => {
              void confirm()
            }}
          >
            <Plus className="size-4" aria-hidden />
            Добавить токен
          </Button>
        </div>
      )}
    </form>
  )
}
