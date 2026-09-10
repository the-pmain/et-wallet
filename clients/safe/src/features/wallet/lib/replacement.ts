import { TRANSACTION_STATUS, TRANSFER_SOURCE, type ITransferRecord } from '@/core'

/**
 * What is done with a stuck transaction.
 *
 * The two actions differ by outcome, not by fee. Speed-up finishes
 * the transfer sooner; cancel tries to stop it. One "fix" button
 * would let a user cancel while thinking they are speeding up.
 */
export const REPLACEMENT_KIND = {
  SpeedUp: 'speed-up',
  Cancel: 'cancel',
} as const

export type ReplacementKind = (typeof REPLACEMENT_KIND)[keyof typeof REPLACEMENT_KIND]

/**
 * Whether a transfer can be replaced.
 *
 * Own sends only. Replace is signed with the sender's key and takes
 * its nonce: someone else's tx cannot be replaced. Indexer records
 * include foreign transfers, so the source is checked explicitly.
 *
 * Pending only. A tx that landed cannot be replaced — its nonce is
 * spent. The core would refuse anyway; showing a button that is
 * guaranteed to fail is a lie.
 *
 * Saved parameters are not checked here: without them speed-up is
 * impossible, cancel is not. The core has the parameters and names
 * the reason on refusal.
 */
export function isReplaceable(record: ITransferRecord): boolean {
  return record.source === TRANSFER_SOURCE.Local && record.status === TRANSACTION_STATUS.Pending
}
