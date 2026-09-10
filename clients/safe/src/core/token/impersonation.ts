import { findForeignCharacters, toNameSkeleton } from '@/core/security'
import type { Address, ChainId } from '@/core/types'

import { listVerifiedTokens, type IVerifiedToken } from './verified'

/** A detected attempt to pass a foreign contract off as a verified token. */
export interface ITokenImpersonation {
  /** The verified token the contract is impersonating. */
  readonly verified: IVerifiedToken

  /** What matched: symbol or name. */
  readonly field: 'symbol' | 'name'

  /** Characters outside Latin and digits. Empty on a letter match. */
  readonly foreignCharacters: readonly string[]
}

/**
 * Looks for a contract impersonating a verified token.
 *
 * WHY. A token's symbol and name are set by the contract author —
 * not a network property or a fact, but a string the contract
 * returns on request. Anyone can call themselves `USDC`. The owner
 * then sees the familiar symbol in the list, sends funds to this
 * "USDC", and finds they transferred a worthless token, or grants
 * an approval to a contract nobody checked.
 *
 * THIS IS THE SAME ATTACK AS WITH A NETWORK NAME, and is caught the
 * same way: `USDC` with a Cyrillic C (U+0421) matches the real one in no
 * byte, and on screen it is the same word. Comparison is by
 * "skeleton".
 *
 * A REFERENCE EXISTS ONLY FOR VERIFIED TOKENS, and that is the
 * check's limit: a fake of a token that is not on the list has
 * nothing to compare against. The list covers what fakes are made
 * for — stablecoins and wrapped assets.
 *
 * A MATCH WITH ITSELF IS NOT A FAKE: a verified contract is allowed
 * to use its own name.
 */
export function findTokenImpersonation(
  candidate: {
    readonly chainId: ChainId
    readonly address: Address
    readonly symbol: string
    readonly name: string
  },
  verifiedTokens: readonly IVerifiedToken[] = listVerifiedTokens(candidate.chainId),
): ITokenImpersonation | null {
  const symbolSkeleton = toNameSkeleton(candidate.symbol)
  const nameSkeleton = toNameSkeleton(candidate.name)

  for (const verified of verifiedTokens) {
    if (verified.address.toLowerCase() === candidate.address.toLowerCase()) {
      continue
    }

    /* The symbol is compared first: it is what is shown in the
       asset list and on send confirmation, while the full name is
       not visible everywhere. */
    if (symbolSkeleton !== '' && toNameSkeleton(verified.symbol) === symbolSkeleton) {
      return {
        verified,
        field: 'symbol',
        foreignCharacters: findForeignCharacters(candidate.symbol),
      }
    }

    if (nameSkeleton !== '' && toNameSkeleton(verified.name) === nameSkeleton) {
      return {
        verified,
        field: 'name',
        foreignCharacters: findForeignCharacters(candidate.name),
      }
    }
  }

  return null
}
