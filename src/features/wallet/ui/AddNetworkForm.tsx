import { Plus, ShieldAlert } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'

import { NetworkImpersonationError, toChainId, type IAddNetworkParams } from '@/core'
import { Alert, AlertDescription, AlertTitle, Button, Checkbox, Input, Label } from '@/shared/ui'

interface AddNetworkFormProps {
  readonly onAdd: (params: IAddNetworkParams) => Promise<void>
}

/** Поля формы. Хранятся строками: пользователь вводит текст. */
interface IFormState {
  readonly name: string
  readonly chainId: string
  readonly rpcUrl: string
  readonly symbol: string
  readonly decimals: string
  readonly explorerUrl: string
  readonly isTestnet: boolean
}

const EMPTY_FORM: IFormState = {
  name: '',
  chainId: '',
  rpcUrl: '',
  symbol: '',
  decimals: '18',
  explorerUrl: '',
  isTestnet: false,
}

/**
 * Добавление пользовательской сети.
 *
 * ДОБАВЛЕНИЕ СЕТИ — ОСНОВНОЙ ВЕКТОР ПОДМЕНЫ. Сеть определяет, куда уходят
 * средства и какой узел сообщает кошельку баланс и цену газа. Поэтому
 * форма не просто собирает поля, а последовательно предъявляет риски:
 * узел проверяется обращением, совпадение имени со встроенной сетью
 * требует отдельного согласия, а обозреватель помечается как ссылка,
 * заданная тем, кто добавил сеть.
 *
 * ОТКАЗ ПОКАЗЫВАЕТСЯ ДОСЛОВНО. «Узел обслуживает другую сеть»,
 * «адрес недоступен» и «имя совпадает со встроенной» требуют разных
 * действий пользователя, и обобщение лишило бы его возможности понять,
 * что исправлять.
 */
export function AddNetworkForm({ onAdd }: AddNetworkFormProps) {
  const fieldId = useId()

  const [form, setForm] = useState<IFormState>(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const [impersonation, setImpersonation] = useState<NetworkImpersonationError | null>(null)
  const [isBusy, setBusy] = useState(false)

  function update<TKey extends keyof IFormState>(key: TKey, value: IFormState[TKey]): void {
    setForm((current) => ({ ...current, [key]: value }))
    setError(null)
    /* Согласие сбрасывается при любой правке: оно давалось на конкретную
       пару «имя — идентификатор», а не на форму вообще. */
    setImpersonation(null)
  }

  async function submit(event: FormEvent, allowImpersonation: boolean): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      await onAdd(buildParams(form, allowImpersonation))
      setForm(EMPTY_FORM)
      setImpersonation(null)
    } catch (caught) {
      if (caught instanceof NetworkImpersonationError) {
        setImpersonation(caught)
      } else {
        setError(caught instanceof Error ? caught.message : String(caught))
      }
    } finally {
      setBusy(false)
    }
  }

  const isComplete =
    form.name.trim() !== '' && form.chainId.trim() !== '' && form.rpcUrl.trim() !== ''

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        void submit(event, false)
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id={`${fieldId}-name`}
          label="Название сети"
          value={form.name}
          placeholder="My Network"
          onChange={(value) => {
            update('name', value)
          }}
        />

        <Field
          id={`${fieldId}-chain`}
          label="Идентификатор сети"
          value={form.chainId}
          placeholder="1"
          inputMode="numeric"
          onChange={(value) => {
            update('chainId', value)
          }}
        />
      </div>

      <Field
        id={`${fieldId}-rpc`}
        label="RPC-адрес"
        value={form.rpcUrl}
        placeholder="https://"
        onChange={(value) => {
          update('rpcUrl', value)
        }}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id={`${fieldId}-symbol`}
          label="Символ валюты"
          value={form.symbol}
          placeholder="ETH"
          onChange={(value) => {
            update('symbol', value)
          }}
        />

        <Field
          id={`${fieldId}-decimals`}
          label="Знаков после запятой"
          value={form.decimals}
          inputMode="numeric"
          onChange={(value) => {
            update('decimals', value)
          }}
        />
      </div>

      <Field
        id={`${fieldId}-explorer`}
        label="Обозреватель блоков (необязательно)"
        value={form.explorerUrl}
        placeholder="https://"
        onChange={(value) => {
          update('explorerUrl', value)
        }}
      />

      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={form.isTestnet}
          onChange={(event) => {
            update('isTestnet', event.target.checked)
          }}
        />
        Тестовая сеть
      </label>

      {error === null ? null : (
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {impersonation === null ? null : (
        <Alert variant="danger">
          <ShieldAlert />
          <AlertTitle>Сеть выдаёт себя за существующую</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span>{impersonation.message}</span>
            <span>
              Если это подмена, добавленная сеть будет выглядеть в кошельке как настоящая, а
              переводы уйдут в чужую цепь. Добавляйте только если точно понимаете, что делаете.
            </span>

            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={isBusy}
              onClick={(event) => {
                void submit(event, true)
              }}
            >
              Всё равно добавить
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Alert variant="warning">
        <AlertDescription>
          Узел сети сообщает кошельку баланс, цену газа и результаты вызовов, а обозреватель — это
          ссылка, по которой вы будете переходить из кошелька. И то и другое задаёт тот, кто
          добавляет сеть. Добавляйте только проверенные значения.
        </AlertDescription>
      </Alert>

      <Button type="submit" disabled={isBusy || !isComplete}>
        <Plus className="size-4" aria-hidden />
        {isBusy ? 'Проверка узла…' : 'Добавить сеть'}
      </Button>
    </form>
  )
}

interface FieldProps {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly placeholder?: string
  readonly inputMode?: 'numeric'
  readonly onChange: (value: string) => void
}

function Field({ id, label, value, placeholder, inputMode, onChange }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete="off"
        onChange={(event) => {
          onChange(event.target.value)
        }}
      />
    </div>
  )
}

/**
 * Превращает поля формы в параметры добавления.
 *
 * Число знаков по умолчанию восемнадцать — так устроено большинство
 * сетей EVM. Но значение остаётся редактируемым: сеть с иным числом
 * знаков показывала бы баланс, отличающийся на порядки.
 */
function buildParams(form: IFormState, allowImpersonation: boolean): IAddNetworkParams {
  const decimals = Number.parseInt(form.decimals, 10)
  const explorer = form.explorerUrl.trim()

  return {
    chainId: toChainId(BigInt(form.chainId.trim())),
    name: form.name.trim(),
    nativeCurrency: {
      name: form.symbol.trim() || 'Native',
      symbol: form.symbol.trim() || '—',
      decimals: Number.isFinite(decimals) ? decimals : 18,
    },
    rpcUrls: [form.rpcUrl.trim()],
    blockExplorerUrls: explorer === '' ? [] : [explorer],
    isTestnet: form.isTestnet,
    allowImpersonation,
  }
}
