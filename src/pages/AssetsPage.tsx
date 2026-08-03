import { Info, Plus, RefreshCw, X } from 'lucide-react'
import { useState } from 'react'

import type { Address } from '@/core'
import { ImportTokenForm, TokenList, useWallet, useWalletSnapshot } from '@/features/wallet'
import { Alert, AlertDescription, Button, Card, CardContent } from '@/shared/ui'

/**
 * Активы аккаунта.
 *
 * ПОКАЗЫВАЮТСЯ ТОЛЬКО ОТСЛЕЖИВАЕМЫЕ ТОКЕНЫ. Кошелёк не подставляет
 * список известных проектов и не добавляет найденное автоматически:
 * прислать на чужой адрес токен с именем известного проекта может кто
 * угодно и почти бесплатно, а показанный в кошельке токен выглядит
 * одобренным.
 *
 * НЕПРОЧИТАННЫЙ БАЛАНС НЕ ПОКАЗЫВАЕТСЯ НУЛЁМ — см. `TokenList`.
 */
export function AssetsPage() {
  const session = useWallet()
  const snapshot = useWalletSnapshot()

  const [isImporting, setImporting] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Assets</h1>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={snapshot.isTokensLoading}
            onClick={() => void session.refreshTokens()}
          >
            <RefreshCw
              className={snapshot.isTokensLoading ? 'size-4 animate-spin' : 'size-4'}
              aria-hidden
            />
            Refresh
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setImporting((current) => !current)
            }}
          >
            {isImporting ? (
              <>
                <X className="size-4" aria-hidden />
                Cancel
              </>
            ) : (
              <>
                <Plus className="size-4" aria-hidden />
                Import a token
              </>
            )}
          </Button>
        </div>
      </header>

      {isImporting ? (
        <Card>
          <CardContent>
            <ImportTokenForm
              onPreview={(address: Address) => session.previewToken(address)}
              onAdd={async (address: Address, symbolOverride?: string) => {
                await session.addToken(address, symbolOverride)
                setImporting(false)
              }}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="p-0 sm:p-0">
          <TokenList
            tokens={snapshot.tokenBalances}
            isLoading={snapshot.isTokensLoading}
            onRemove={(address: Address) => {
              void session.removeToken(address)
            }}
          />
        </CardContent>
      </Card>

      {snapshot.balanceError === null ? null : (
        <Alert variant="danger">
          <AlertDescription>
            The node did not answer. The values shown may be stale — that does not mean the funds
            are gone.
          </AlertDescription>
        </Alert>
      )}

      <Alert>
        <Info />
        <AlertDescription>
          Asset value in fiat is not shown: that needs an external price source, which would receive
          your addresses. Choosing such a source is the wallet owner’s decision.
        </AlertDescription>
      </Alert>
    </div>
  )
}
