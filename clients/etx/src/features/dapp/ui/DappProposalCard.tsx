import { Globe, Link2 } from 'lucide-react'

import { UntrustedText } from '@/features/security'
import { Alert, AlertDescription, Button, Card, CardContent } from '@/shared/ui'

import type { IPendingProposal } from '../model/DappSessionService'

interface DappProposalCardProps {
  readonly proposal: IPendingProposal
  readonly addressCount: number
  readonly isBusy: boolean
  readonly onApprove: () => void
  readonly onReject: () => void
}

/**
 * Предложение подключения от приложения.
 *
 * ПЕРЕЧИСЛЕНО, ЧТО ПРИЛОЖЕНИЕ ПОЛУЧИТ И ЧЕГО НЕ ПОЛУЧИТ. Согласие,
 * данное на общее «подключиться», согласием не является: человек
 * не может принять решение о том, чего ему не назвали.
 *
 * ПОДКЛЮЧЕНИЕ НЕ ДАЁТ ПРАВА ПОДПИСЫВАТЬ БЕЗ СПРОСА. Это главное, что
 * пользователь должен понять: каждая подпись будет спрошена отдельно.
 */
export function DappProposalCard({
  proposal,
  addressCount,
  isBusy,
  onApprove,
  onReject,
}: DappProposalCardProps) {
  return (
    <Card className="border-primary/40">
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span className="icon-tile size-10 shrink-0 rounded-xl">
            <Link2 className="size-5" aria-hidden />
          </span>

          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold">
              <UntrustedText
                value={
                  proposal.dapp.name === '' ? 'Application without a name' : proposal.dapp.name
                }
              />
            </span>
            <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
              <Globe className="size-3 shrink-0" aria-hidden />
              <UntrustedText
                value={proposal.dapp.url === '' ? 'no address given' : proposal.dapp.url}
              />
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2 rounded-xl border p-3 text-xs">
          <p className="font-medium">The application will get</p>
          <ul className="flex list-disc flex-col gap-1 pl-4 text-muted-foreground">
            <li>the addresses of your accounts ({addressCount});</li>
            <li>the ability to send signing requests;</li>
            <li>information about the selected network.</li>
          </ul>

          <p className="mt-1 font-medium">The application will not get</p>
          <ul className="flex list-disc flex-col gap-1 pl-4 text-muted-foreground">
            <li>the seed phrase or the private keys — they never leave the device;</li>
            <li>the right to sign anything without your confirmation;</li>
            <li>access to your funds by itself.</li>
          </ul>
        </div>

        <Alert variant="warning">
          <AlertDescription>
            The name and the address were supplied by the application itself. Anyone can claim to be
            a well-known service — connect only to something you opened yourself.
          </AlertDescription>
        </Alert>

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" disabled={isBusy} onClick={onReject}>
            Reject
          </Button>

          {/* Подпись отличается от кнопки формы нового подключения:
              две кнопки «Подключить» на одном экране означают, что
              вспомогательные технологии их не различают, а глаз
              выбирает не ту. */}
          <Button className="flex-1" disabled={isBusy} onClick={onApprove}>
            Allow the connection
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
