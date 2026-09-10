import { Check, KeyRound, Plus, Search } from 'lucide-react'

import { KEYRING_TYPE, type AccountId, type IAccount } from '@/core'
import { cn } from '@/shared/lib/utils'
import { Button, Card, CardContent, CardHeader, CardTitle } from '@/shared/ui'

import { addressLabel } from '../lib/format'

/** Empty name map. One instance: a new Map each render would change the reference. */
const EMPTY_ENS_NAMES: ReadonlyMap<string, string> = new Map()

interface AccountListProps {
  readonly accounts: readonly IAccount[]
  readonly activeAccount: IAccount | null
  readonly onSelect: (id: AccountId) => void
  readonly onCreate: () => void

  /**
   * Starts searching for addresses already used.
   *
   * Optional: the list is also used where there is nothing to search.
   */
  readonly onDiscover?: (() => void) | undefined

  /** Search in progress: the button is busy, it does not disappear. */
  readonly isDiscovering?: boolean

  readonly isBusy: boolean

  /**
   * Confirmed ENS names keyed by lowercase address.
   *
   * Passed in, not fetched here: the account list must not talk to the
   * network, or it would do so on every re-render.
   */
  readonly ensNames?: ReadonlyMap<string, string>

  /** List heading. Defaults to "Accounts". */
  readonly title?: string

  /** Copy when the list is empty. Without it an empty list stays silent. */
  readonly emptyMessage?: string
}

/**
 * Account list with active selection.
 *
 * Key source is shown. An imported key is not restored from the seed:
 * an owner who thinks the written phrase recovers the whole wallet
 * will lose that account with the device. The icon is the only early
 * warning.
 *
 * The address is truncated but keeps EIP-55 casing — see
 * `shortenAddress`. A verified ENS name replaces it: in a list where
 * addresses differ by six characters, a name is recognized more
 * reliably.
 */
export function AccountList({
  accounts,
  activeAccount,
  onSelect,
  onCreate,
  onDiscover,
  isDiscovering = false,
  isBusy,
  ensNames = EMPTY_ENS_NAMES,
  title = 'Accounts',
  emptyMessage,
}: AccountListProps) {
  return (
    <Card>
      {/* On a narrow screen the header stacks: two full-label buttons
          next to the title overflowed the phone width. */}
      <CardHeader className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-base font-medium text-muted-foreground">{title}</CardTitle>
        <div className="flex flex-wrap items-center justify-end gap-1">
          {/* Discover is opt-in. It tells the node operator two dozen
              addresses at once and links them; doing that on every
              settings open would leak more than needed. */}
          {onDiscover === undefined ? null : (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDiscover}
              disabled={isBusy || isDiscovering}
            >
              <Search className="size-4" aria-hidden />
              {isDiscovering ? 'Searching…' : 'Find my accounts'}
            </Button>
          )}

          {/* Short visible label, full accessible name. Two full
              captions overflow the phone by ~18px. The wallet also
              has "add RPC node"; a screen reader must tell them
              apart. */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onCreate}
            disabled={isBusy}
            aria-label="Add an account"
          >
            <Plus className="size-4" aria-hidden />
            Add
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {accounts.length === 0 && emptyMessage !== undefined ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">{emptyMessage}</p>
        ) : null}

        <ul className="flex flex-col gap-1">
          {accounts.map((account) => {
            const isActive = account.id === activeAccount?.id

            return (
              <li key={account.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(account.id)
                  }}
                  disabled={isBusy || isActive}
                  aria-current={isActive}
                  className="focus-ring flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent disabled:cursor-default aria-[current=true]:bg-accent"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                    {isActive ? <Check className="size-4" aria-hidden /> : account.order + 1}
                  </span>

                  <span className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                      {account.name}
                      {account.source === KEYRING_TYPE.PrivateKey ? (
                        <KeyRound
                          className="size-3 text-muted-foreground"
                          aria-label="Imported key: not restored from the seed phrase"
                        />
                      ) : null}
                    </span>
                    {/* Monospace only for the address: character-by-character
                        check. A name is compared as a whole. */}
                    <span
                      className={cn(
                        'truncate text-xs text-muted-foreground',
                        !ensNames.has(account.address.toLowerCase()) && 'font-mono',
                      )}
                    >
                      {addressLabel(account.address, ensNames)}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
