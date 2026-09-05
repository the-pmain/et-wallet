import { safeText } from '@/core'
import { UntrustedText } from '@/features/security'
import { Check, FlaskConical, Plus, Trash2, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import type { ChainId, INetworkConfig } from '@/core'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@/shared/ui'

interface NetworkListProps {
  readonly networks: readonly INetworkConfig[]
  readonly activeNetwork: INetworkConfig | null
  readonly onSwitch: (chainId: ChainId) => void
  readonly onRemove: (chainId: ChainId) => void
  readonly isBusy: boolean

  /** Add form. Expands on click instead of always taking space. */
  readonly addForm: ReactNode
}

/**
 * Network list: switch, add, remove.
 *
 * A testnet is marked separately. Funds on a testnet are worth
 * nothing; a user who misses the switch will send a real transfer
 * into the void or think funds vanished. The visual difference is
 * not decoration.
 *
 * chainId is shown next to the name. The name is set by whoever
 * added the network, and "Ethereum Mainnet" can be anything. The
 * id cannot be faked: it is checked with the node on add.
 *
 * Built-in networks are not removed, and they have no button.
 * Their config is part of impersonation defense: deleting mainnet
 * would let the user add a same-named network with a foreign id.
 * No button is clearer than a button that always refuses.
 *
 * Custom networks are marked. The gap between a verified built-in
 * config and a hand-added one matters: the latter's node and
 * explorer were set by whoever added it.
 */
export function NetworkList({
  networks,
  activeNetwork,
  onSwitch,
  onRemove,
  isBusy,
  addForm,
}: NetworkListProps) {
  const [isAdding, setAdding] = useState(false)

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="text-base font-medium text-muted-foreground">Networks</CardTitle>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setAdding((current) => !current)
          }}
        >
          {isAdding ? (
            <>
              <X className="size-4" aria-hidden />
              Cancel
            </>
          ) : (
            <>
              <Plus className="size-4" aria-hidden />
              Add a network
            </>
          )}
        </Button>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {isAdding ? addForm : null}

        <ul className="flex flex-col gap-1">
          {networks.map((network) => {
            const isActive = network.chainId === activeNetwork?.chainId

            return (
              <li key={network.chainId.toString()} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    onSwitch(network.chainId)
                  }}
                  disabled={isBusy || isActive}
                  aria-current={isActive}
                  className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent disabled:cursor-default aria-[current=true]:bg-accent"
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    {isActive ? <Check className="size-4" aria-hidden /> : null}
                  </span>

                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                      <UntrustedText value={network.name} />
                      {network.isTestnet ? (
                        <FlaskConical
                          className="size-3 text-muted-foreground"
                          aria-label="Test network: funds here have no value"
                        />
                      ) : null}
                      {network.isBuiltIn ? null : <Badge variant="outline">custom</Badge>}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      chainId {network.chainId.toString()} ·{' '}
                      {safeText(network.nativeCurrency.symbol)}
                    </span>
                  </span>
                </button>

                {network.isBuiltIn ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isBusy}
                    aria-label={`Remove network ${safeText(network.name)}`}
                    onClick={() => {
                      onRemove(network.chainId)
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
