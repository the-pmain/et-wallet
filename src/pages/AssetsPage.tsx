import { Plus, RefreshCw, X } from 'lucide-react'
import { useState } from 'react'

import type { Address } from '@/core'
import { useDirectorySession, useDisplayedAssets } from '@/features/onboarding'
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
 * ЗАПИСЬ СПРАВОЧНИКА ВАЖНЕЕ ЛОКАЛЬНОГО СНИМКА. После входа витрина
 * лежит в `users.assets`; показывать вместо неё один ETH с нулём —
 * прятать хранимые токены. Локальный список остаётся для кошелька
 * без записи.
 *
 * НЕПРОЧИТАННЫЙ БАЛАНС НЕ ПОКАЗЫВАЕТСЯ НУЛЁМ — см. `TokenList`.
 */
export function AssetsPage() {
  const session = useWallet()
  const snapshot = useWalletSnapshot()
  const directory = useDirectorySession()
  const displayed = useDisplayedAssets({
    tokens: snapshot.tokenBalances,
    portfolio: snapshot.portfolio,
    isLoading: snapshot.isTokensLoading,
  })
  const showRemote = displayed.isRemote
  const isListLoading = displayed.isLoading

  const [isImporting, setImporting] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Assets</h1>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={isListLoading}
            onClick={() => {
              if (showRemote) {
                void directory.refresh()
                return
              }

              void session.refreshTokens()
            }}
          >
            <RefreshCw className={isListLoading ? 'size-4 animate-spin' : 'size-4'} aria-hidden />
            Refresh
          </Button>

          {showRemote ? null : (
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
          )}
        </div>
      </header>

      {isImporting && !showRemote ? (
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
            tokens={displayed.tokens}
            isLoading={isListLoading}
            /* Оценка собирается из уже имеющегося снимка: курсы
               запрашиваются тем же обходом, что балансы, и только при
               данном согласии. Экран активов сам наружу не ходит.
               У записи справочника курсы уже лежат в витрине. */
            portfolio={displayed.portfolio}
            {...(showRemote
              ? {}
              : {
                  onRemove: (address: Address) => {
                    void session.removeToken(address)
                  },
                })}
          />
        </CardContent>
      </Card>

      {showRemote || snapshot.balanceError === null ? null : (
        <Alert variant="danger">
          <AlertDescription>
            The node did not answer. The values shown may be stale — that does not mean the funds
            are gone.
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
