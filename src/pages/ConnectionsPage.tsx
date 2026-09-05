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
 * Connections to apps.
 *
 * THE TRANSPORT STARTS WHEN THIS SCREEN OPENS, NOT AT APP LAUNCH.
 * WalletConnect is about three megabytes: loading it for a screen
 * most people never open would slow every wallet unlock.
 *
 * THE REQUEST AND THE PROPOSAL SIT ABOVE THE LIST. A decision is
 * needed immediately, and scrolling to it is a reliable way to
 * confirm without looking.
 */
export function ConnectionsPage() {
  const dapp = useDapp()
  const snapshot = useWalletSnapshot()
  const uriId = useId()

  const [uri, setUri] = useState('')
  const [isBusy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /* The viewfinder opens on demand, not by itself: the camera turns
     on only when the person asked for it. */
  const [isScanning, setScanning] = useState(false)

  /* Depend on the action itself, not the whole context. The context
     changes on every snapshot update, and an effect that depended on
     it would restart the transport after every such change. */
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
        <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
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
          {/* The reason is shown verbatim, with no extra sentence: the
              transport already explains the consequence, and a second
              copy next to it looks like a layout bug. */}
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

            {/* Name the source: the app itself issues the URI, and
                pasting something from email or chat is a reliable way
                to connect a stranger. */}
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

              {/* Scanning the code is a second way to enter the same
                  URI, not a separate connection path: the scan lands
                  in the same field and passes the same checks. On a
                  phone this is the main way; typing a hundred and
                  fifty characters by hand is not realistic. */}
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

                  /* Connection starts at once: the scan is visible in
                     the field, and the access decision comes later on
                     the proposal screen. An extra tap here would add
                     no extra check. */
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
