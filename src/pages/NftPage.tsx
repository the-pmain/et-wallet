import { ExternalLink, Images, RefreshCw, ShieldAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { TOKEN_STANDARD, type INftItem, type TxHash } from '@/core'
import { NftTransferCard, shortenAddress, useWallet, useWalletSnapshot } from '@/features/wallet'
import { Alert, AlertDescription, Badge, Button, Card, CardContent, EmptyState } from '@/shared/ui'

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
        <h1 className="text-lg font-semibold">Передача предмета</h1>

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
          Обновить
        </Button>
      </header>

      {sentHash === null ? null : (
        <Alert>
          <AlertDescription>
            Передача отправлена. Предмет исчезнет из списка, когда транзакция попадёт в блок; до тех
            пор он числится за вами. Следите за состоянием в разделе «История».
          </AlertDescription>
        </Alert>
      )}

      {limits?.sourceUnavailable === true ? (
        <Alert variant="danger">
          <AlertDescription>
            Найти предметы не удалось: узел не ответил.
            {limits.reason === null ? null : <> Он сообщил: «{limits.reason}».</>} Пустой список
            здесь не означает, что коллекции нет.
          </AlertDescription>
        </Alert>
      ) : null}

      {limits !== null && limits.skipped > 0 ? (
        <Alert variant="warning">
          <AlertDescription>
            Показаны не все предметы: {limits.skipped.toLocaleString('ru-RU')} осталось
            непроверенными. Принадлежность каждого требует отдельного обращения к контракту, и число
            проверок ограничено, чтобы узел не отказал в обслуживании.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className={items !== null && items.length > 0 ? 'p-0 sm:p-0' : undefined}>
          {snapshot.isNftLoading && items === null ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <RefreshCw className="size-4 animate-spin" aria-hidden />
              Ищем предметы…
            </div>
          ) : items === null || items.length === 0 ? (
            <EmptyState
              icon={Images}
              title="Предметов не найдено"
              description={
                <>
                  Кошелёк просматривает последние{' '}
                  {limits === null || limits.scannedBlocks === null
                    ? 'блоки'
                    : `${limits.scannedBlocks.toLocaleString('ru-RU')} блоков`}{' '}
                  и проверяет принадлежность каждого найденного предмета. Полученное раньше этого
                  окна и с тех пор не двигавшееся сюда не попадёт — проверьте адрес в обозревателе.
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
                      Открыть в обозревателе
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

      <Alert variant="warning">
        <ShieldAlert />
        <AlertDescription>
          Изображения не загружаются намеренно. Ссылки на них задаёт автор контракта, и его сервер
          увидел бы ваш IP-адрес рядом с адресом кошелька. Название коллекции тоже задаёт автор
          контракта — сверяйте адрес контракта, а не имя.
        </AlertDescription>
      </Alert>
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
            {item.collectionName ?? 'Коллекция без названия'}
          </span>
          <Badge variant="outline">{item.standard}</Badge>
        </span>

        <span className="truncate font-mono text-xs text-muted-foreground">
          {shortenAddress(item.contract)} · #{item.tokenId.toString()}
        </span>
      </span>

      <span className="flex shrink-0 flex-col items-end gap-1">
        {item.standard === TOKEN_STANDARD.Erc1155 ? (
          <span className="text-sm font-medium tabular-nums">×{item.balance.toString()}</span>
        ) : null}

        <Button variant="outline" size="sm" onClick={onSend}>
          Передать
        </Button>

        {explorer === null ? null : (
          <a
            href={`${explorer}/token/${item.contract}`}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Обозреватель
            <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
      </span>
    </div>
  )
}
