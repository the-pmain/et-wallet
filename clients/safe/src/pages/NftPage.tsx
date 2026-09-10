import { UntrustedText } from '@/features/security'
import { ExternalLink, Images, RefreshCw, ShieldAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { TOKEN_STANDARD, type INftItem, type TxHash } from '@/core'
import { NftTransferCard, shortenAddress, useWallet, useWalletSnapshot } from '@/features/wallet'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Skeleton,
} from '@/shared/ui'

/**
 * Collectible tokens of the active account.
 *
 * THE LIST IS BUILT IN TWO STEPS, AND THAT IS NOT REDUNDANT. A node
 * cannot answer "what belongs to this address": first inflows are
 * found in logs, then each contract is asked whether the item still
 * belongs to the owner. A list from logs alone would show given-away
 * items as owned.
 *
 * THE OWNER STARTS THE SEARCH BY OPENING THE SECTION. It is dozens of
 * node calls and a detailed activity trail at the operator: doing it
 * on every unlock would pay for something nobody asked for.
 *
 * THERE ARE NO IMAGES, AND THAT IS A DECISION, NOT A GAP. Their URLs
 * are set by the contract author; loading them would reveal the
 * owner's IP to an arbitrary server and let it be tied to the wallet.
 * Collection name, contract address, and item id are enough to
 * recognize the item.
 */
export function NftPage() {
  const session = useWallet()
  const snapshot = useWalletSnapshot()

  const explorer = snapshot.activeNetwork?.blockExplorerUrls[0] ?? null
  const address = snapshot.activeAccount?.address ?? null
  const items = snapshot.nfts
  const limits = snapshot.nftLimits

  /* Which account+network pair already started a search. Stored in a
     ref, not in state: this is not display data, it is a guard against
     a second run, and a redraw on change is not needed. A key, not a
     flag, because a change of account or network must start search
     again. */
  const requestedFor = useRef<string | null>(null)

  /* Item being transferred right now. `null` means ordinary list view. */
  const [sending, setSending] = useState<INftItem | null>(null)

  /* Hash of the sent transfer. Shown instead of the form: without it
     the owner would not know whether the operation left. */
  const [sentHash, setSentHash] = useState<TxHash | null>(null)
  const scope = `${snapshot.activeNetwork?.chainId.toString() ?? ''}:${snapshot.activeAccount?.id ?? ''}`

  useEffect(() => {
    if (items === null && requestedFor.current !== scope) {
      requestedFor.current = scope
      void session.loadNfts()
    }
  }, [items, scope, session])

  if (sending !== null) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Transfer an item</h1>

        <NftTransferCard
          item={sending}
          onCancel={() => {
            setSending(null)
          }}
          onSent={(hash) => {
            setSending(null)
            setSentHash(hash)

            /* The list is fetched again: the item no longer belongs to
               the owner, and leaving it on screen would show someone
               else's property as theirs. */
            void session.loadNfts()
          }}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">NFT</h1>

        <Button
          variant="ghost"
          size="sm"
          disabled={snapshot.isNftLoading}
          onClick={() => void session.loadNfts()}
        >
          <RefreshCw
            className={snapshot.isNftLoading ? 'size-4 animate-spin' : 'size-4'}
            aria-hidden
          />
          Refresh
        </Button>
      </header>

      {sentHash === null ? null : (
        <Alert>
          <AlertDescription>
            The transfer has been sent. The item disappears from the list once the transaction lands
            in a block; until then it is still counted as yours. Watch its state in the History
            section.
          </AlertDescription>
        </Alert>
      )}

      {limits?.sourceUnavailable === true ? (
        <Alert variant="danger">
          <AlertDescription>
            The items could not be found: the node did not answer.
            {limits.reason === null ? null : <> It reported: "{limits.reason}".</>} An empty list
            here does not mean the collection is gone.
          </AlertDescription>
        </Alert>
      ) : null}

      {limits !== null && limits.skipped > 0 ? (
        <Alert variant="warning">
          <AlertDescription>
            Not every item is shown: {limits.skipped.toLocaleString('en-GB')} remain unverified.
            Ownership of each one takes a separate call to a contract, and the number of checks is
            limited so that the node does not refuse service.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className={items !== null && items.length > 0 ? 'p-0 sm:p-0' : undefined}>
          {snapshot.isNftLoading && items === null ? (
            <div className="divide-y divide-border" aria-busy>
              {Array.from({ length: 3 }, (_, index) => (
                <div
                  key={index}
                  className="flex items-center gap-3 px-4 py-3.5 sm:px-6"
                  aria-hidden
                >
                  <Skeleton className="size-10 shrink-0 rounded-lg" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
              ))}
              <span className="sr-only">Searching for items…</span>
            </div>
          ) : items === null || items.length === 0 ? (
            <EmptyState
              icon={Images}
              title="No items found"
              description={
                <>
                  The wallet scans the last{' '}
                  {limits === null || limits.scannedBlocks === null
                    ? 'blocks'
                    : `${limits.scannedBlocks.toLocaleString('en-GB')} blocks`}{' '}
                  and checks ownership of every item it finds. Anything received before that window
                  and not moved since will not appear here — check the address in an explorer.
                </>
              }
              action={
                explorer === null || address === null ? undefined : (
                  <Button asChild variant="outline" size="sm">
                    <a
                      href={`${explorer}/address/${address}`}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      <ExternalLink className="size-4" aria-hidden />
                      Open in the explorer
                    </a>
                  </Button>
                )
              }
            />
          ) : (
            <ul className="divide-y">
              {items.map((item) => (
                <li key={`${item.contract}:${item.tokenId.toString()}`}>
                  <NftRow
                    item={item}
                    explorer={explorer}
                    onSend={() => {
                      setSentHash(null)
                      setSending(item)
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* A STANDING PROPERTY IS A FOOTNOTE, NOT A WARNING.
          This used to be `Alert variant="warning"` — the same look as
          a suspicious-operation message. There is nothing to warn
          about: images are never loaded; that is a wallet decision,
          not an event. Orange in this palette means risk, and spending
          it on a standing property trains people not to tell real risk
          from a footnote.

          The wording is kept verbatim, including the instruction to
          check the contract address, not the name: the name is set by
          the contract author and costs nothing to fake. */}
      <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-muted-foreground">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Images are deliberately not loaded. Their links are set by the contract author, and their
          server would see your IP address next to your wallet address. The collection name is set
          by the contract author too — check the contract address, not the name.
        </span>
      </p>
    </div>
  )
}

/**
 * A row in the items list.
 *
 * THE CONTRACT ADDRESS IS ALWAYS SHOWN. The collection name is set by
 * the contract author, and anyone can name their collection after a
 * famous one; the address is what distinguishes the original from a
 * fake.
 */
function NftRow({
  item,
  explorer,
  onSend,
}: {
  readonly item: INftItem
  readonly explorer: string | null
  readonly onSend: () => void
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Images className="size-5" aria-hidden />
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">
            {item.collectionName === null ? (
              'Collection without a name'
            ) : (
              <UntrustedText value={item.collectionName} />
            )}
          </span>
          <Badge variant="outline">{item.standard}</Badge>
        </span>

        <span className="truncate font-mono text-xs text-muted-foreground">
          {shortenAddress(item.contract)} · #{item.tokenId.toString()}
        </span>
      </span>

      {/* ACTIONS IN A ROW, NOT A COLUMN. Quantity, the button, and the
          explorer link used to stack, and the row grew to three times
          its content. Quantity also belongs to the item, not to the
          actions, and sat in the wrong column. */}
      <span className="flex shrink-0 items-center gap-2">
        {item.standard === TOKEN_STANDARD.Erc1155 ? (
          <span className="text-base font-semibold tabular-nums">×{item.balance.toString()}</span>
        ) : null}

        <Button variant="outline" size="sm" onClick={onSend}>
          Transfer
        </Button>

        {explorer === null ? null : (
          /* The link is an icon: the word "Explorer" next to "Transfer"
             read as a second equal action, though it leaves the wallet.
             The accessible name stays full. */
          <Button asChild variant="ghost" size="icon" className="size-8 text-muted-foreground">
            <a
              href={`${explorer}/token/${item.contract}`}
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Open the collection in the explorer"
            >
              <ExternalLink className="size-4" aria-hidden />
            </a>
          </Button>
        )}
      </span>
    </div>
  )
}
