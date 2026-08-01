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

  /** Форма добавления. Раскрывается по нажатию, а не занимает место всегда. */
  readonly addForm: ReactNode
}

/**
 * Список сетей: переключение, добавление, удаление.
 *
 * ТЕСТОВАЯ СЕТЬ ПОМЕЧАЕТСЯ ОТДЕЛЬНО. Средства в тестовой сети ничего не стоят,
 * и пользователь, не заметивший переключения, отправит настоящий перевод
 * в никуда либо решит, что средства пропали. Различие в оформлении здесь
 * не декоративное.
 *
 * chainId ПОКАЗЫВАЕТСЯ РЯДОМ С ИМЕНЕМ. Имя сети задаёт тот, кто её добавил,
 * и «Ethereum Mainnet» может оказаться чем угодно. Идентификатор подделать
 * нельзя: он проверяется у узла при добавлении сети.
 *
 * ВСТРОЕННЫЕ СЕТИ НЕ УДАЛЯЮТСЯ, И КНОПКИ У НИХ НЕТ. Их конфигурация —
 * часть защиты от подмены: удалив основную сеть, пользователь мог бы
 * добавить вместо неё одноимённую с чужим идентификатором. Отсутствие
 * кнопки понятнее, чем кнопка, отвечающая отказом.
 *
 * ПОЛЬЗОВАТЕЛЬСКИЕ СЕТИ ПОМЕЧЕНЫ. Различие между проверенной встроенной
 * конфигурацией и добавленной вручную важнее, чем кажется: у второй
 * и узел, и обозреватель заданы тем, кто её добавил.
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
        <CardTitle className="text-base font-medium text-muted-foreground">Сети</CardTitle>

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
              Отменить
            </>
          ) : (
            <>
              <Plus className="size-4" aria-hidden />
              Добавить сеть
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
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent disabled:cursor-default aria-[current=true]:bg-accent"
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    {isActive ? <Check className="size-4" aria-hidden /> : null}
                  </span>

                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                      {network.name}
                      {network.isTestnet ? (
                        <FlaskConical
                          className="size-3 text-muted-foreground"
                          aria-label="Тестовая сеть: средства в ней не имеют стоимости"
                        />
                      ) : null}
                      {network.isBuiltIn ? null : <Badge variant="outline">своя</Badge>}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      chainId {network.chainId.toString()} · {network.nativeCurrency.symbol}
                    </span>
                  </span>
                </button>

                {network.isBuiltIn ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isBusy}
                    aria-label={`Удалить сеть ${network.name}`}
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
