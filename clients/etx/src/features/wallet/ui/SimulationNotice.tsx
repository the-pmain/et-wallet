import { ArrowDownLeft, ArrowUpRight, CircleAlert, CircleHelp, Radar } from 'lucide-react'

import {
  MOVEMENT_KIND,
  SIMULATION_OUTCOME,
  areAddressesEqual,
  type Address,
  type IAssetMovement,
  type ISimulationResult,
} from '@/core'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui'

import { formatTokenAmount, shortenAddress } from '../lib/format'

/** Что известно об активе: обозначение и число знаков. */
export interface ISimulationAsset {
  readonly symbol: string
  readonly decimals: number
}

interface SimulationNoticeProps {
  readonly simulation: ISimulationResult

  /** Адрес владельца: по нему определяется направление перемещения. */
  readonly owner: Address

  /**
   * Известные активы по адресу контракта в нижнем регистре.
   *
   * Ключ `native` описывает валюту сети. Чего в наборе нет, то
   * показывается в наименьших единицах с оговоркой: подставить
   * восемнадцать знаков «по умолчанию» значило бы ошибиться
   * на порядки у токенов с шестью.
   */
  readonly assets: ReadonlyMap<string, ISimulationAsset>
}

/** Ключ нативной валюты в наборе активов. */
export const NATIVE_ASSET_KEY = 'native'

/**
 * Что транзакция сделает по нынешнему состоянию цепи.
 *
 * ЗАЧЕМ ЭТО РЯДОМ С ПОЛЯМИ ФОРМЫ. Экран подтверждения показывает
 * получателя и сумму такими, какими их собрал кошелёк. Симуляция
 * показывает, что насчитал узел, выполнив вызов. Совпадение этих
 * двух источников и есть проверка; расхождение — признак того, что
 * подписывается не то, что задумано.
 *
 * ПУСТОЙ ПЕРЕЧЕНЬ ЗНАЧИМ ТОЛЬКО ПРИ УСПЕХЕ. При исходах «узел не умеет»
 * и «не удалось» перемещения неизвестны, и показывать «ничего
 * не двинется» было бы утверждением, которого никто не проверял.
 *
 * НЕИЗВЕСТНОЕ ЧИСЛО ЗНАКОВ НЕ ПОДМЕНЯЕТСЯ ВОСЕМНАДЦАТЬЮ. У токена,
 * которого нет в наборе, количество показывается в наименьших
 * единицах и помечается словом: «1000000» при шести знаках — это
 * одна единица, а не миллион.
 */
export function SimulationNotice({ simulation, owner, assets }: SimulationNoticeProps) {
  if (simulation.outcome === SIMULATION_OUTCOME.Unsupported) {
    /* Свойство узла, а не происшествие: оформлено сноской, а не
       предупреждением. Оранжевый в этой палитре означает риск. */
    return (
      <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-muted-foreground">
        <CircleHelp className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          This node cannot show what the transaction will do — it does not support simulation. The
          checks above still apply.
        </span>
      </p>
    )
  }

  if (simulation.outcome === SIMULATION_OUTCOME.Unavailable) {
    return (
      <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-muted-foreground">
        <CircleHelp className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {/* Формулировка нарочно не повторяет соседний блок о прогоне.
            Два почти одинаковых предложения на одном экране читаются
            как сбой, и человек перестаёт различать, что именно
            не проверено. Здесь неизвестен ПЕРЕЧЕНЬ ПЕРЕМЕЩЕНИЙ. */}
        <span>
          The node did not answer the simulation, so what this transaction moves stays unknown. That
          is not the same as “nothing moves”.
        </span>
      </p>
    )
  }

  if (simulation.outcome === SIMULATION_OUTCOME.Reverted) {
    /* Одной строкой, а не вторым красным блоком: о том, что вызов
       не пройдёт, уже сказал прогон, и повторять это другими словами
       на том же экране — шум, из-за которого перестают читать оба. */
    return (
      <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-destructive">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          The simulation ended in a revert
          {simulation.reason === null ? '' : `: ${simulation.reason}`}. Nothing would move.
        </span>
      </p>
    )
  }

  if (simulation.movements.length === 0) {
    return (
      <Alert>
        <Radar />
        <AlertTitle>No assets move</AlertTitle>
        <AlertDescription>
          The node ran this transaction and it transfers nothing. Fees are paid regardless.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert>
      <Radar />
      <AlertTitle>What this transaction moves</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <ul className="flex flex-col gap-1.5">
          {simulation.movements.map((movement, index) => (
            <MovementRow
              /* Порядок перемещений и есть их различие: два одинаковых
                 перевода подряд — законный случай. */
              key={`${movement.contract ?? NATIVE_ASSET_KEY}:${String(index)}`}
              movement={movement}
              owner={owner}
              assets={assets}
            />
          ))}
        </ul>

        <p className="text-xs">
          Simulated against the current state of the chain. It is not a promise: the state may
          change before the transaction is included in a block.
        </p>
      </AlertDescription>
    </Alert>
  )
}

function MovementRow({
  movement,
  owner,
  assets,
}: {
  readonly movement: IAssetMovement
  readonly owner: Address
  readonly assets: ReadonlyMap<string, ISimulationAsset>
}) {
  const isOutgoing = areAddressesEqual(movement.from, owner)
  const isIncoming = areAddressesEqual(movement.to, owner)
  const asset = assets.get(movement.contract?.toLowerCase() ?? NATIVE_ASSET_KEY) ?? null
  const counterparty = isOutgoing ? movement.to : movement.from

  return (
    <li className="flex items-start gap-2 text-sm">
      <span
        className={cn(
          'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full',
          isIncoming ? 'bg-risk-low/15 text-risk-low' : 'bg-muted text-muted-foreground',
        )}
      >
        {isIncoming ? (
          <ArrowDownLeft className="size-3" aria-hidden />
        ) : (
          <ArrowUpRight className="size-3" aria-hidden />
        )}
      </span>

      <span className="flex min-w-0 flex-col">
        <span className="font-medium tabular-nums">
          {isIncoming && !isOutgoing ? '+' : isOutgoing ? '−' : ''}
          {describeAmount(movement, asset)}
        </span>

        <span className="truncate font-mono text-xs text-muted-foreground">
          {/* Направление называется словом, а не только знаком и цветом:
              минус легко не заметить, а цвет виден не всем. */}
          {isOutgoing ? 'to ' : 'from '}
          {shortenAddress(counterparty)}
        </span>
      </span>
    </li>
  )
}

/**
 * Складывает количество в строку.
 *
 * Неизвестное число знаков и неизвестное количество называются прямо,
 * а не заменяются правдоподобным числом.
 */
function describeAmount(movement: IAssetMovement, asset: ISimulationAsset | null): string {
  if (movement.kind === MOVEMENT_KIND.Erc721) {
    return `1 item #${movement.tokenId?.toString() ?? '—'}`
  }

  if (movement.amount === null) {
    return movement.kind === MOVEMENT_KIND.Erc1155
      ? 'items of an unknown quantity'
      : 'an unknown amount'
  }

  if (movement.kind === MOVEMENT_KIND.Erc1155) {
    return `${movement.amount.toString()} × item #${movement.tokenId?.toString() ?? '—'}`
  }

  if (asset === null) {
    /* Токен не отслеживается, и число знаков неоткуда взять. Показать
       сырые единицы без пометки — обмануть на порядки. */
    return `${movement.amount.toString()} units of ${
      movement.contract === null ? 'the network currency' : shortenAddress(movement.contract)
    }`
  }

  return `${formatTokenAmount(movement.amount, asset.decimals)} ${asset.symbol}`
}
