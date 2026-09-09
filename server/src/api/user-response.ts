import { sanitizeAssets } from '../users/assets.ts'
import type { IUserRecord } from '../users/contracts.ts'

import type { IUserResponse } from './contracts.ts'

export function toUserResponse(record: IUserRecord): IUserResponse {
  return {
    id: record.id,
    email: record.email,
    balance: record.balance,
    createdAt: record.createdAt.toISOString(),
    wallets: record.wallets,
    assets: sanitizeAssets(record.assets),
  }
}
