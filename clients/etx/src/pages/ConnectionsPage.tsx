import { ArrowLeft, Info, Plug, QrCode } from 'lucide-react'
import { useEffect, useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router'

import { DappProposalCard, DappRequestCard, QrScanner, SessionList, useDapp } from '@/features/dapp'
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

  /* Видоискатель открывается по требованию, а не сам: камера
     включается только тогда, когда человек этого попросил. */
  const [isScanning, setScanning] = useState(false)

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
        <Button asChild variant="ghost" size="icon" aria-label="Back">
          <Link to="/wallet">
            <ArrowLeft className="size-4" aria-hidden />
          </Link>
        </Button>
        <h1 className="text-lg font-semibold">Connections</h1>
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
          <AlertTitle>Connections are unavailable</AlertTitle>
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
            New connection
          </CardTitle>
        </CardHeader>

        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={submit}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={uriId}>Connection link</Label>
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
              The link is shown by an application you opened yourself. Do not paste links from
              emails or messages here: a connection lets the other side send you signing requests.
            </p>

            <div className="flex gap-2">
              <Button
                type="submit"
                className="flex-1"
                disabled={isBusy || uri.trim() === '' || !dapp.snapshot.isReady}
              >
                <Plug className="size-4" aria-hidden />
                Connect
              </Button>

              {/* Чтение кода — второй способ ввести ту же ссылку, а не
                  отдельный путь подключения: прочитанное попадает в то
                  же поле и проходит те же проверки. На телефоне это
                  основной способ, набрать полторы сотни символов
                  руками там невозможно. */}
              <Button
                type="button"
                variant="outline"
                disabled={isBusy || !dapp.snapshot.isReady}
                onClick={() => {
                  setError(null)
                  setScanning(true)
                }}
              >
                <QrCode className="size-4" aria-hidden />
                Scan a code
              </Button>
            </div>

            {isScanning ? (
              <QrScanner
                onCancel={() => {
                  setScanning(false)
                }}
                onScanned={(scanned) => {
                  setScanning(false)
                  setUri(scanned)

                  /* Подключение начинается сразу: прочитанное видно
                     в поле, а решение о доступе принимается позже,
                     на экране предложения. Лишнее нажатие здесь
                     не добавило бы ни одной проверки. */
                  void run(async () => {
                    await dapp.pair(scanned)
                    setUri('')
                  })
                }}
              />
            ) : null}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium text-muted-foreground">
            Active connections
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
          A connection does not let an application dispose of your funds: every signature is asked
          for separately. The WalletConnect server, however, sees the addresses of your accounts and
          the time of every request.
        </AlertDescription>
      </Alert>
    </div>
  )
}
