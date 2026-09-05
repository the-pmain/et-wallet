import { TRANSFER_KIND, type INetworkConfig, type ITransferRecord, type TransferKind } from '@/core'

import { formatTokenAmount } from './format'

/** Transfer amount ready for display. */
export interface ITransferAmount {
  /** Numeric value for display. */
  readonly text: string

  /** Unit: token symbol, item id, or a note. */
  readonly unit: string

  /**
   * The figure is shown in raw units.
   *
   * Contract decimals are unknown, so this amount must not be compared
   * with others. The UI must mark the row.
   */
  readonly isRaw: boolean
}

/**
 * Shape a transfer for display.
 *
 * Decimals are never guessed. Eighteen is a convention, not a rule:
 * USDC has six, WBTC eight, some tokens zero. Assuming eighteen for a
 * six-decimal token would understate the amount by a trillion, and
 * the user would think almost nothing moved.
 *
 * Unknown decimals therefore show raw units with `isRaw`, not a
 * plausible invented figure.
 *
 * The token symbol is untrusted: the contract author sets it, and
 * anyone can mint `USDC`. It is passed through; telling verified
 * tokens from arbitrary ones is the UI's job.
 */
export function describeAmount(
  record: ITransferRecord,
  network: INetworkConfig | null,
): ITransferAmount {
  if (record.kind === TRANSFER_KIND.Erc721) {
    /* A unique item has no quantity: showing "1" is meaningless; the
       id carries the value. */
    return {
      text: record.tokenId === null ? '—' : `#${record.tokenId.toString()}`,
      unit: record.asset.symbol ?? 'NFT',
      isRaw: false,
    }
  }

  if (record.kind === TRANSFER_KIND.Native) {
    const decimals = network?.nativeCurrency.decimals ?? record.asset.decimals

    return decimals === null
      ? { text: record.value.toString(), unit: 'units', isRaw: true }
      : {
          text: formatTokenAmount(record.value, decimals),
          unit: network?.nativeCurrency.symbol ?? record.asset.symbol ?? '',
          isRaw: false,
        }
  }

  if (record.asset.decimals === null) {
    return {
      text: record.value.toString(),
      unit: record.asset.symbol ?? 'units',
      isRaw: true,
    }
  }

  return {
    text: formatTokenAmount(record.value, record.asset.decimals),
    unit: record.asset.symbol ?? '',
    isRaw: false,
  }
}

/** Human-readable transfer category name. */
export function describeKind(kind: TransferKind): string {
  switch (kind) {
    case TRANSFER_KIND.Native:
      return 'Transfer'
    case TRANSFER_KIND.Erc20:
      return 'Token'
    case TRANSFER_KIND.Erc721:
      return 'NFT'
    case TRANSFER_KIND.Erc1155:
      return 'NFT (ERC-1155)'
  }
}
