import { Plus, RefreshCw, X } from 'lucide-react'
import { useState } from 'react'

import type { Address } from '@/core'
import { useDirectorySession, useDisplayedAssets, useRefreshRemoteAssets } from '@/features/onboarding'
import { ImportTokenForm, TokenList, useWallet, useWalletSnapshot } from '@/features/wallet'
import { Alert, AlertDescription, Button, Card, CardContent } from '@/shared/ui'

/**
 * Account assets.
 *
 * ONLY TRACKED TOKENS ARE SHOWN. The wallet does not preload a list of
 * well-known projects or add discoveries automatically: anyone can send
 * a token named after a known project to a foreign address, almost for
 * free, and a token shown in the wallet looks endorsed.
 *
 * THE DIRECTORY RECORD BEATS THE LOCAL SNAPSHOT. After sign-in the
 * showcase lives in `users.assets`; showing one ETH at zero instead
 * would hide stored tokens. The local list remains for a wallet
 * without a record.
 *
 * AN UNREAD BALANCE IS NOT SHOWN AS ZERO — see `TokenList`.
 */
export function AssetsPage() {
  useRefreshRemoteAssets()
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
        <h1 className="text-2xl font-semibold tracking-tight">Assets</h1>

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
            /* Valuation comes from the existing snapshot: rates are
               fetched in the same pass as balances, and only after
               consent. The assets screen itself does not go outside.
               A directory record already carries rates in the showcase. */
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
