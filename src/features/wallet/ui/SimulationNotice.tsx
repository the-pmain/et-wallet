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

/** What is known about an asset: ticker and decimals. */
export interface ISimulationAsset {
  readonly symbol: string
  readonly decimals: number
}

interface SimulationNoticeProps {
  readonly simulation: ISimulationResult

  /** Owner address: used to decide movement direction. */
  readonly owner: Address

  /**
   * Known assets keyed by lowercase contract address.
   *
   * The `native` key is the chain currency. Anything not in the map
   * is shown in smallest units with a note: assuming eighteen
   * decimals would be off by orders of magnitude on six-decimal
   * tokens.
   */
  readonly assets: ReadonlyMap<string, ISimulationAsset>
}

/** Native-currency key in the asset map. */
export const NATIVE_ASSET_KEY = 'native'

/**
 * What the transaction will do against the current chain state.
 *
 * Why this sits next to the form fields. Confirm shows the recipient
 * and amount as the wallet assembled them. Simulation shows what the
 * node computed by running the call. Matching those two sources is
 * the check; a mismatch means something other than intended is being
 * signed.
 *
 * An empty movement list is meaningful only on success. On
 * "unsupported" and "failed" the movements are unknown, and
 * "nothing will move" would be a claim nobody checked.
 *
 * Unknown decimals are never replaced with eighteen. A token not in
 * the map is shown in smallest units and marked: "1000000" at six
 * decimals is one unit, not a million.
 */
export function SimulationNotice({ simulation, owner, assets }: SimulationNoticeProps) {
  if (simulation.outcome === SIMULATION_OUTCOME.Unsupported) {
    /* A node property, not an incident: styled as a footnote, not a
       warning. Orange in this palette means risk. */
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
        {/* Wording deliberately does not repeat the neighboring
            preflight block. Two nearly identical sentences on one
            screen read as a glitch. What is unknown here is the
            MOVEMENT LIST. */}
        <span>
          The node did not answer the simulation, so what this transaction moves stays unknown. That
          is not the same as “nothing moves”.
        </span>
      </p>
    )
  }

  if (simulation.outcome === SIMULATION_OUTCOME.Reverted) {
    /* One line, not a second red block: preflight already said the
       call will fail, and repeating that in other words is noise
       that makes both unread. */
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
              /* Order is what distinguishes them: two identical
                 transfers in a row are a legitimate case. */
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
          {/* Direction is named in words, not only a sign and color:
              a minus is easy to miss, and color is not visible to
              everyone. */}
          {isOutgoing ? 'to ' : 'from '}
          {shortenAddress(counterparty)}
        </span>
      </span>
    </li>
  )
}

/**
 * Fold a quantity into a string.
 *
 * Unknown decimals and an unknown quantity are named plainly, not
 * replaced with a plausible number.
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
    /* The token is not tracked, so decimals are unknown. Showing
       raw units without a mark would deceive by orders of magnitude. */
    return `${movement.amount.toString()} units of ${
      movement.contract === null ? 'the network currency' : shortenAddress(movement.contract)
    }`
  }

  return `${formatTokenAmount(movement.amount, asset.decimals)} ${asset.symbol}`
}
