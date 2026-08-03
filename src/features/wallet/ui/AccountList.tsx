import { Check, KeyRound, Plus, Search } from 'lucide-react'

import { KEYRING_TYPE, type AccountId, type IAccount } from '@/core'
import { cn } from '@/shared/lib/utils'
import { Button, Card, CardContent, CardHeader, CardTitle } from '@/shared/ui'

import { addressLabel } from '../lib/format'

/** Пустой набор имён. Один экземпляр: новая карта на каждый рендер меняла бы ссылку. */
const EMPTY_ENS_NAMES: ReadonlyMap<string, string> = new Map()

interface AccountListProps {
  readonly accounts: readonly IAccount[]
  readonly activeAccount: IAccount | null
  readonly onSelect: (id: AccountId) => void
  readonly onCreate: () => void

  /**
   * Запускает поиск адресов, которыми уже пользовались.
   *
   * Необязателен: список используется и там, где искать нечем.
   */
  readonly onDiscover?: (() => void) | undefined

  /** Идёт поиск: кнопка занята, а не исчезает. */
  readonly isDiscovering?: boolean

  readonly isBusy: boolean

  /**
   * Подтверждённые имена ENS по адресам в нижнем регистре.
   *
   * Передаётся снаружи, а не запрашивается компонентом: список
   * аккаунтов не должен уметь ходить в сеть, иначе он начнёт делать
   * это при каждой перерисовке.
   */
  readonly ensNames?: ReadonlyMap<string, string>
}

/**
 * Список аккаунтов с выбором активного.
 *
 * ИСТОЧНИК КЛЮЧА ПОКАЗЫВАЕТСЯ ЯВНО. Импортированный ключ не восстанавливается
 * из seed-фразы: владелец, считающий, что записанной фразы достаточно для
 * восстановления всего кошелька, потеряет такой аккаунт вместе с устройством.
 * Значок рядом с аккаунтом — единственное место, где об этом можно
 * предупредить заранее.
 *
 * АДРЕС ПОКАЗЫВАЕТСЯ УСЕЧЁННЫМ, НО С СОХРАНЕНИЕМ РЕГИСТРА EIP-55 —
 * см. `shortenAddress`. Вместо адреса выводится имя ENS, если оно
 * подтверждено сверкой: в списке, где адреса различаются шестью
 * символами, имя опознаётся вернее.
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
}: AccountListProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="text-base font-medium text-muted-foreground">Accounts</CardTitle>
        {/* Имя действия полное, а не «Добавить»: на экране есть вторая
            кнопка добавления — для RPC-узла. Одинаковые имена неразличимы
            в экранном дикторе и в списке элементов управления. */}
        <div className="flex items-center gap-1">
          {/* ПОИСК ОТДЕЛЬНОЙ КНОПКОЙ, А НЕ САМ ПО СЕБЕ. Он сообщает
              оператору узла два десятка адресов разом и связывает их
              между собой; делать это без спроса при каждом открытии
              настроек значило бы раскрывать больше, чем нужно. */}
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

          <Button variant="ghost" size="sm" onClick={onCreate} disabled={isBusy}>
            <Plus className="size-4" aria-hidden />
            Add an account
          </Button>
        </div>
      </CardHeader>

      <CardContent>
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
                  className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent disabled:cursor-default aria-[current=true]:bg-accent"
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
                    {/* Моноширинный шрифт только для адреса: он нужен
                        для посимвольного сличения, а имя сличают целиком. */}
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
