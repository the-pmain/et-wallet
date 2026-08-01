import { ArrowLeft, Info, Plug } from 'lucide-react'
import { useEffect, useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router'

import { DappProposalCard, DappRequestCard, SessionList, useDapp } from '@/features/dapp'
import { useWalletSnapshot } from '@/features/wallet'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@/shared/ui'

/**
 * Подключения к приложениям.
 *
 * ТРАНСПОРТ ПОДНИМАЕТСЯ ПРИ ВХОДЕ НА ЭКРАН, А НЕ ПРИ ЗАПУСКЕ.
 * Библиотека WalletConnect весит около трёх мегабайт: загружать её
 * ради экрана, куда большинство не заходит, значит замедлить всем
 * вход в кошелёк.
 *
 * ЗАПРОС И ПРЕДЛОЖЕНИЕ ПОКАЗЫВАЮТСЯ НАД СПИСКОМ. Решение требуется
 * немедленно, и прокручивать до него — верный способ подтвердить
 * не глядя.
 */
export function ConnectionsPage() {
  const dapp = useDapp()
  const snapshot = useWalletSnapshot()
  const uriId = useId()

  const [uri, setUri] = useState('')
  const [isBusy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /* Зависимость — только само действие, а не весь контекст. Контекст
     меняется при каждом изменении снимка, и эффект, зависящий от него,
     вызывал бы подъём транспорта заново после каждой такой смены. */
  const { init } = dapp

  useEffect(() => {
    void init()
  }, [init])

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true)
    setError(null)

    try {
      await action()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  function submit(event: FormEvent): void {
    event.preventDefault()

    void run(async () => {
      await dapp.pair(uri)
      setUri('')
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Назад">
          <Link to="/wallet">
            <ArrowLeft className="size-4" aria-hidden />
          </Link>
        </Button>
        <h1 className="text-lg font-semibold">Подключения</h1>
      </header>

      {dapp.snapshot.proposal === null ? null : (
        <DappProposalCard
          proposal={dapp.snapshot.proposal}
          addressCount={snapshot.accounts.length}
          isBusy={isBusy}
          onApprove={() => void run(() => dapp.respondToProposal(true))}
          onReject={() => void run(() => dapp.respondToProposal(false))}
        />
      )}

      {dapp.snapshot.request === null ? null : (
        <DappRequestCard
          pending={dapp.snapshot.request}
          isBusy={isBusy}
          onApprove={() => void run(() => dapp.respondToRequest(true))}
          onReject={() => void run(() => dapp.respondToRequest(false))}
        />
      )}

      {dapp.snapshot.error === null ? null : (
        <Alert variant="warning">
          <AlertTitle>Подключения недоступны</AlertTitle>
          {/* Причина показывается дословно и без дополнений: транспорт
              уже объясняет последствие, и вторая такая же фраза рядом
              выглядит сбоем разметки. */}
          <AlertDescription>{dapp.snapshot.error}</AlertDescription>
        </Alert>
      )}

      {error === null ? null : (
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium text-muted-foreground">
            Новое подключение
          </CardTitle>
        </CardHeader>

        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={submit}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={uriId}>Ссылка подключения</Label>
              <Input
                id={uriId}
                value={uri}
                placeholder="wc:…"
                autoComplete="off"
                disabled={isBusy || !dapp.snapshot.isReady}
                onChange={(event) => {
                  setUri(event.target.value)
                  setError(null)
                }}
              />
            </div>

            {/* Прямое указание источника: ссылку выдаёт само приложение,
                и вставлять сюда что-то, пришедшее из письма или чата, —
                верный способ подключить чужого. */}
            <p className="text-xs text-muted-foreground">
              Ссылку показывает приложение, которое вы открыли сами. Не вставляйте сюда ссылки из
              писем и сообщений: подключение даёт возможность присылать вам запросы на подпись.
            </p>

            <Button type="submit" disabled={isBusy || uri.trim() === '' || !dapp.snapshot.isReady}>
              <Plug className="size-4" aria-hidden />
              Подключить
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium text-muted-foreground">
            Действующие подключения
          </CardTitle>
        </CardHeader>

        <CardContent className="p-0 sm:p-0">
          <SessionList
            sessions={dapp.snapshot.sessions}
            isBusy={isBusy}
            onDisconnect={(sessionId) => void run(() => dapp.disconnect(sessionId))}
          />
        </CardContent>
      </Card>

      <Alert>
        <Info />
        <AlertDescription>
          Подключение не даёт приложению распоряжаться средствами: каждая подпись спрашивается
          отдельно. Сервер WalletConnect при этом видит адреса ваших аккаунтов и время каждого
          запроса.
        </AlertDescription>
      </Alert>
    </div>
  )
}
