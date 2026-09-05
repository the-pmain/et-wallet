import { ChartPie, Copy, Download, FileCode, Send } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'

import type { IAccount } from '@/core'
import {
  findWalletByCodename,
  WALLET_CODENAME_RECEIVING_FUNDS_EXCHANGE,
  type IUserWalletsMap,
} from '@/features/onboarding'
import { copyWithAutoClear } from '@/features/security'
import { useTranslation } from '@/shared/i18n'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription, Button } from '@/shared/ui'

interface QuickActionsProps {
  readonly account: IAccount | null
  readonly wallets?: IUserWalletsMap
  readonly isGeneratingExchangeWallet?: boolean
  readonly generationError?: string | null
  readonly onGenerateExchangeWallet?: () => void
}

/**
 * Dashboard quick actions.
 *
 * Send and receive stay clickable. Both used to disable until the
 * session exposed the active account; after email login the on-device
 * store opens separately, and a grey tile looked like a broken cabinet
 * rather than a key waiting to load.
 *
 * Receive shows the full address, not a truncated one. A truncated
 * address cannot be checked character by character, and that check is
 * what protects against a malicious extension swapping the clipboard.
 *
 * No separate card. The row sits inside the balance card so the amount
 * and what can be done with it read as one object. Lock and Refresh
 * were removed as duplicates of the header lock and the balance-card
 * refresh — five equal tiles made Send disappear.
 */
export function QuickActions({
  account,
  wallets = {},
  isGeneratingExchangeWallet = false,
  generationError = null,
  onGenerateExchangeWallet,
}: QuickActionsProps) {
  const { t } = useTranslation()
  const [isAddressVisible, setAddressVisible] = useState(false)
  const [isCopied, setCopied] = useState(false)
  const [isExchangeCopied, setExchangeCopied] = useState(false)

  const exchangeWallet = findWalletByCodename(wallets, WALLET_CODENAME_RECEIVING_FUNDS_EXCHANGE)
  const exchangeAddress = exchangeWallet?.key ?? null
  const isGenerationRequested = isGeneratingExchangeWallet

  async function copyAddress(address: string, markCopied: () => void): Promise<void> {
    await copyWithAutoClear(address)
    markCopied()
  }

  return (
    <div className="flex flex-col gap-3 max-lg:w-full">
      <div className="flex w-fit items-stretch justify-start gap-[0.81rem] max-lg:mx-auto max-lg:w-full max-lg:justify-center">
        <ActionTile
          to="/wallet/send"
          icon={Send}
          label={t('dashboard.send')}
        />

        <ActionTile
          icon={Download}
          label={t('dashboard.receive')}
          isActive={isAddressVisible}
          onClick={() => {
            setAddressVisible((visible) => !visible)
          }}
        />

        {/* Portfolio is a peer of Send/Receive, not a footnote under the amount. */}
        <ActionTile to="/wallet/portfolio" icon={ChartPie} label={t('dashboard.portfolio')} />

        {/* Contract calls are not implemented. The tile stays so the row
            does not jump when the feature lands, and so we do not promise
            a mode that does not exist. A-172. */}
        <ActionTile icon={FileCode} label={t('dashboard.smartContract')} isDisabled />
      </div>

      {isAddressVisible && account !== null ? (
        <ReceiveAddressPanel
          title="Address for receiving funds"
          address={account.address}
          isCopied={isCopied}
          onCopy={() => {
            void copyAddress(account.address, () => {
              setCopied(true)
            })
          }}
        />
      ) : null}

      {isAddressVisible ? (
        <ReceiveAddressPanel
          title="Address for receiving funds from exchange or institution"
          address={exchangeAddress}
          isCopied={isExchangeCopied}
          showCopy={true}
          isCopyDisabled={exchangeAddress === null}
          onCopy={() => {
            if (exchangeAddress === null) {
              return
            }

            void copyAddress(exchangeAddress, () => {
              setExchangeCopied(true)
            })
          }}
          secondaryAction={
            exchangeAddress === null ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={isGeneratingExchangeWallet || onGenerateExchangeWallet === undefined}
                onClick={() => {
                  onGenerateExchangeWallet?.()
                }}
              >
                {isGeneratingExchangeWallet ? 'wallet generation request sent' : 'Generate a wallet'}
              </Button>
            ) : null
          }
          emptyMessage={
            exchangeAddress === null && generationError !== null
              ? generationError
              : exchangeAddress === null && !isGenerationRequested
                ? 'No wallet has been generated yet.'
                : exchangeAddress === null && isGenerationRequested
                  ? 'Wallet generation request sent. The address will appear here once ready.'
                  : null
          }
        />
      ) : null}
    </div>
  )
}

interface ReceiveAddressPanelProps {
  readonly title: string
  readonly address: string | null
  readonly isCopied: boolean
  readonly onCopy?: () => void
  readonly showCopy?: boolean
  readonly isCopyDisabled?: boolean
  readonly secondaryAction?: ReactNode
  readonly emptyMessage?: string | null
}

function ReceiveAddressPanel({
  title,
  address,
  isCopied,
  onCopy,
  showCopy = false,
  isCopyDisabled = false,
  secondaryAction,
  emptyMessage,
}: ReceiveAddressPanelProps) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/70 bg-card/70 p-3">
      <p className="text-xs text-muted-foreground">{title}</p>

      {address !== null ? (
        <p className="font-mono text-sm break-all">{address}</p>
      ) : emptyMessage !== null && emptyMessage !== undefined ? (
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {showCopy || onCopy !== undefined ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={isCopyDisabled}
            onClick={onCopy}
          >
            <Copy className="size-4" aria-hidden />
            {isCopied ? 'Copied' : 'Copy'}
          </Button>
        ) : null}
        {secondaryAction}
      </div>

      {address !== null ? (
        <Alert variant="warning">
          <AlertDescription>
            Check the address character by character before sending funds: a malicious extension
            can replace the contents of the clipboard. The address is the same in every EVM
            network, but tokens sent in another network stay in that one. The copied address is
            removed from the clipboard after a minute.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}

interface ActionTileProps {
  readonly icon: typeof Send
  readonly label: string

  /** Destination. Without it the tile renders as a button. */
  readonly to?: string
  readonly onClick?: () => void
  /** Pressed state for toggle tiles (e.g. Receive). */
  readonly isActive?: boolean
  readonly isDisabled?: boolean
}

/**
 * Quick-action tile: icon in a circle, label beneath.
 *
 * The circle is the visible hit target; a bare letter-sized icon is
 * guesswork. Navigation stays a link so middle-click, "open in new tab",
 * and the screen-reader "link" role survive. A disabled link tile
 * becomes text: `<a>` has no `disabled`, and the navigation would still
 * fire.
 */
function ActionTile({ icon: Icon, label, to, onClick, isActive, isDisabled }: ActionTileProps) {
  const content = (
    <>
      <span
        className={cn(
          'flex size-9 items-center justify-center rounded-full transition-colors max-lg:size-12',
          isActive === true
            ? 'bg-primary text-primary-foreground ring-2 ring-primary/30 ring-offset-2 ring-offset-background'
            : 'bg-primary/25 text-primary-emphasis group-hover:bg-primary group-hover:text-primary-foreground max-lg:bg-muted max-lg:text-foreground max-lg:group-hover:bg-primary max-lg:group-hover:text-primary-foreground',
        )}
      >
        <Icon className="size-4.5 max-lg:size-5" aria-hidden />
      </span>
      <span className="w-full text-center leading-tight text-balance">{label}</span>
    </>
  )

  const shared = cn(
    'action-tile group focus-ring border border-border/70 bg-primary/10',
    'max-lg:border-transparent max-lg:bg-transparent max-lg:hover:border-transparent max-lg:hover:bg-transparent',
    isActive === true && 'border-primary/40 bg-accent/60 max-lg:border-transparent max-lg:bg-transparent',
    isDisabled === true
      ? 'pointer-events-none opacity-50'
      : 'cursor-pointer hover:border-primary/50 hover:bg-primary/22 hover:text-foreground',
  )

  if (to !== undefined) {
    return isDisabled === true ? (
      <span className={shared} aria-disabled>
        {content}
      </span>
    ) : (
      <Link to={to} className={shared}>
        {content}
      </Link>
    )
  }

  return (
    <button
      type="button"
      className={shared}
      onClick={onClick}
      disabled={isDisabled === true}
      {...(isActive !== undefined ? { 'aria-pressed': isActive } : {})}
    >
      {content}
    </button>
  )
}
