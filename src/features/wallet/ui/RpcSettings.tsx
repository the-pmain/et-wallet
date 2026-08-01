import { Activity, CheckCircle2, Plus, ShieldAlert, Trash2, XCircle } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { RPC_PROVIDER_ID, type IRpcEndpoint, type IRpcEndpointHealth } from '@/core'
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

import { endpointHost } from '../lib/format'

interface RpcSettingsProps {
  readonly endpoints: readonly IRpcEndpoint[]
  readonly activeEndpoint: IRpcEndpoint | null
  readonly onCheckHealth: () => Promise<readonly IRpcEndpointHealth[]>
  readonly onAdd: (url: string) => Promise<void>
  readonly onRemove: (url: string) => Promise<void>
}

/**
 * Управление RPC-узлами активной сети.
 *
 * ПОЛЬЗОВАТЕЛЬ ОБЯЗАН ВИДЕТЬ, К ЧЬЕМУ УЗЛУ ОБРАЩАЕТСЯ КОШЕЛЁК. Оператор
 * узла видит IP-адрес и каждый запрашиваемый адрес — этого достаточно,
 * чтобы связать личность с портфелем. Скрывать выбор оператора означало
 * бы скрывать, кому передаются эти данные.
 *
 * ПОКАЗЫВАЕТСЯ ХОСТ, А НЕ ПОЛНЫЙ АДРЕС: путь содержит ключ доступа.
 *
 * ДОБАВЛЕНИЕ АДРЕСА — ОПЕРАЦИЯ ДОВЕРИЯ, И ОБ ЭТОМ СКАЗАНО ПРЯМО. Узел
 * сообщает баланс, цену газа и результаты вызовов; узел, которому нельзя
 * доверять, покажет пользователю не то, что он подписывает.
 */
export function RpcSettings({
  endpoints,
  activeEndpoint,
  onCheckHealth,
  onAdd,
  onRemove,
}: RpcSettingsProps) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setBusy] = useState(false)
  const [health, setHealth] = useState<readonly IRpcEndpointHealth[]>([])

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      await onAdd(url.trim())
      setUrl('')
    } catch (cause) {
      /* Причина показывается как есть: «узел обслуживает другую сеть»
         и «узел не отвечает» требуют разных действий пользователя. */
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function check(): Promise<void> {
    setBusy(true)

    try {
      setHealth(await onCheckHealth())
    } finally {
      setBusy(false)
    }
  }

  function healthOf(endpoint: IRpcEndpoint): IRpcEndpointHealth | undefined {
    return health.find((item) => item.endpoint.url === endpoint.url)
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="text-base font-medium text-muted-foreground">RPC-узлы</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => void check()} disabled={isBusy}>
          <Activity className="size-4" aria-hidden />
          Проверить
        </Button>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <ul className="flex flex-col gap-1">
          {endpoints.map((endpoint) => {
            const status = healthOf(endpoint)
            const isActive = endpoint.url === activeEndpoint?.url

            return (
              <li
                key={endpoint.url}
                className="flex items-center gap-3 rounded-md px-2 py-2 text-sm"
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  {status === undefined ? null : status.isHealthy ? (
                    <CheckCircle2 className="size-4 text-muted-foreground" aria-label="Доступен" />
                  ) : (
                    <XCircle className="size-4 text-destructive" aria-label="Недоступен" />
                  )}
                </span>

                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-mono text-xs">{endpointHost(endpoint.url)}</span>
                  <span className="text-xs text-muted-foreground">
                    {endpoint.providerName}
                    {isActive ? ' · используется сейчас' : ''}
                    {status?.latencyMs === null || status?.latencyMs === undefined
                      ? ''
                      : ` · ${String(status.latencyMs)} мс`}
                  </span>
                  {status?.isChainMismatch === true ? (
                    <span className="flex items-center gap-1 text-xs text-destructive">
                      <ShieldAlert className="size-3" aria-hidden />
                      Узел обслуживает другую сеть
                    </span>
                  ) : null}
                </span>

                {endpoint.providerId === RPC_PROVIDER_ID.Custom ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => void onRemove(endpoint.url)}
                    aria-label={`Удалить ${endpointHost(endpoint.url)}`}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>

        <form className="flex flex-col gap-2" onSubmit={(event) => void submit(event)}>
          <Label htmlFor="rpc-url">Свой RPC-адрес</Label>
          <div className="flex gap-2">
            <Input
              id="rpc-url"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value)
              }}
              placeholder="https://"
              autoComplete="off"
            />
            <Button type="submit" disabled={isBusy || url.trim() === ''}>
              <Plus className="size-4" aria-hidden />
              Добавить узел
            </Button>
          </div>

          {error === null ? null : (
            <Alert variant="danger">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Alert variant="warning">
            <AlertDescription>
              Узел сообщает кошельку баланс, цену газа и результаты вызовов. Добавляйте только тот,
              которому доверяете: недобросовестный узел покажет не то, что вы подписываете. Адрес
              сохраняется в зашифрованном виде и используется раньше остальных.
            </AlertDescription>
          </Alert>
        </form>
      </CardContent>
    </Card>
  )
}
