import { INITIAL_WALLET_VALUE } from '@/features/onboarding'
import type { IUserWalletsMap } from '@/features/onboarding'

/** Default cabinet wallet when the user has none yet. */
export const MOCK_WALLET_CODENAME = 'mock-wallet'

/** Public burn address — not a live account, only a placeholder. */
export const MOCK_WALLET_ADDRESS = '0x000000000000000000000000000000000000dEaD'

export interface IAdminWalletRow {
  readonly rowId: string
  readonly codename: string
  readonly key: string
  readonly value: string
}

export function mockWalletRow(): IAdminWalletRow {
  return {
    rowId: MOCK_WALLET_CODENAME,
    codename: MOCK_WALLET_CODENAME,
    key: MOCK_WALLET_ADDRESS,
    value: INITIAL_WALLET_VALUE,
  }
}

export function walletsToRows(wallets: IUserWalletsMap): IAdminWalletRow[] {
  const rows = Object.entries(wallets).map(([codename, slot]) => ({
    rowId: codename,
    codename,
    key: slot.key,
    value: slot.value,
  }))

  return rows.length === 0 ? [mockWalletRow()] : rows
}

export function rowsToWallets(rows: readonly IAdminWalletRow[]): IUserWalletsMap {
  const next: Record<string, { readonly key: string; readonly value: string }> = {}

  for (const row of rows) {
    if (row.codename.trim() === '' || row.key.trim() === '' || row.value.trim() === '') {
      continue
    }

    next[row.codename.trim()] = {
      key: row.key.trim(),
      value: row.value.trim(),
    }
  }

  return next
}
