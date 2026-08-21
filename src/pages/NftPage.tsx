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
 * Коллекционные токены активного аккаунта.
 *
 * СПИСОК СТРОИТСЯ В ДВА ШАГА, И ЭТО НЕ ИЗБЫТОЧНОСТЬ. Узел не умеет
 * отвечать на вопрос «что принадлежит адресу»: сначала находятся
 * поступления в журналах, затем у каждого контракта спрашивается,
 * принадлежит ли предмет владельцу сейчас. Список по одним журналам
 * показывал бы отданное как своё.
 *
 * ПОИСК ЗАПУСКАЕТ ВЛАДЕЛЕЦ, ОТКРЫВАЯ РАЗДЕЛ. Это десятки обращений
 * к узлу и подробный след активности у его оператора: делать это
 * при каждом входе значило бы платить за то, чего никто не просил.
 *
 * ИЗОБРАЖЕНИЙ ЗДЕСЬ НЕТ, И ЭТО РЕШЕНИЕ, А НЕ НЕДОДЕЛКА. Ссылки на них
 * задаёт автор контракта; загрузка раскрыла бы IP-адрес владельца
 * произвольному серверу и позволила бы связать его с кошельком.
 * Показываются название коллекции, адрес контракта и номер предмета —
 * этого достаточно, чтобы предмет опознать.
 */
export function NftPage() {
  const session = useWallet()
  const snapshot = useWalletSnapshot()

  const explorer = snapshot.activeNetwork?.blockExplorerUrls[0] ?? null
  const address = snapshot.activeAccount?.address ?? null
  const items = snapshot.nfts
  const limits = snapshot.nftLimits

  /* Для какой пары «аккаунт и сеть» поиск уже запускали. Хранится
     в ссылке, а не в состоянии: это не данные для показа, а защита
     от повторного запуска, и перерисовка при её смене не нужна.
     Ключ, а не флаг, — потому что смена аккаунта или сети обязана
     запустить поиск заново. */
  const requestedFor = useRef<string | null>(null)

  /* Предмет, который передают прямо сейчас. `null` — идёт обычный
     просмотр списка. */
  const [sending, setSending] = useState<INftItem | null>(null)

  /* Хэш отправленной передачи. Показывается вместо формы: без него
     владелец не узнает, ушла операция или нет. */
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
        <h1 className="text-lg font-semibold">Transfer an item</h1>

        <NftTransferCard
          item={sending}
          onCancel={() => {
            setSending(null)
          }}
          onSent={(hash) => {
            setSending(null)
            setSentHash(hash)

            /* Список перезапрашивается: предмет больше не принадлежит
               владельцу, и оставить его на экране значило бы показывать
               чужое имущество как своё. */
            void session.loadNfts()
          }}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">NFT</h1>

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

      {/* ПОСТОЯННОЕ СВОЙСТВО — СНОСКОЙ, А НЕ ПРЕДУПРЕЖДЕНИЕМ.
          Прежде здесь стоял `Alert variant="warning"` — тот же вид, что
          у сообщения о подозрительной операции. Но предупреждать не
          о чем: изображения не загружаются всегда, это решение кошелька,
          а не событие. Оранжевый цвет в этой палитре означает риск, и
          трата его на неизменное свойство приучает не отличать
          настоящий риск от пояснения.

          Текст сохранён дословно, включая указание сверять адрес
          контракта, а не имя: имя задаёт автор контракта, и подделать
          его ничего не стоит. */}
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
 * Строка списка предметов.
 *
 * АДРЕС КОНТРАКТА ПОКАЗЫВАЕТСЯ ВСЕГДА. Название коллекции задаёт автор
 * контракта, и назвать свою коллекцию именем известной может кто угодно;
 * адрес — единственное, что отличает подлинник от подделки.
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

      {/* ДЕЙСТВИЯ В СТРОКУ, А НЕ СТОЛБИКОМ. Прежде количество, кнопка
          и ссылка на обозреватель стояли друг под другом, и строка
          вырастала втрое против содержания. Количество к тому же
          относится к предмету, а не к действиям, и стояло не в том
          столбце. */}
      <span className="flex shrink-0 items-center gap-2">
        {item.standard === TOKEN_STANDARD.Erc1155 ? (
          <span className="text-base font-semibold tabular-nums">×{item.balance.toString()}</span>
        ) : null}

        <Button variant="outline" size="sm" onClick={onSend}>
          Transfer
        </Button>

        {explorer === null ? null : (
          /* Ссылка стала значком: слово «Explorer» рядом с «Transfer»
             читалось как второе равнозначное действие, хотя это уход
             из кошелька. Доступное имя при этом полное. */
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
