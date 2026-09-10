import type { ChainId } from '@/core/types'

import { findForeignCharacters, toNameSkeleton } from '@/core/security'

import type { INetworkConfig } from './types'

/**
 * How the name matched a built-in one.
 *
 * THE USER MUST SEE THE DISTINCTION. On a letter-for-letter match
 * they see two identical names and understand the message at once.
 * On a look-alike substitution they see TWO VISUALLY IDENTICAL names,
 * and "name is taken" without an explanation looks like a wallet
 * bug — i.e. a reason to click "add anyway".
 */
export const IMPERSONATION_KIND = {
  /** Same letters, possibly different case or surrounding spaces. */
  SameName: 'same-name',

  /** Different letters, indistinguishable by eye. */
  LookAlike: 'look-alike',
} as const

export type ImpersonationKind = (typeof IMPERSONATION_KIND)[keyof typeof IMPERSONATION_KIND]

/** A detected attempt to pass a user network off as a built-in one. */
export interface IImpersonation {
  readonly name: string

  /** Built-in network the added one is impersonating. */
  readonly impersonated: INetworkConfig

  readonly kind: ImpersonationKind

  /**
   * Name characters outside Latin letters and digits.
   *
   * Empty on a letter-for-letter match. On a substitution — what
   * must be shown: listing the foreign letters turns an opaque
   * message into an obvious one.
   */
  readonly foreignCharacters: readonly string[]
}

/**
 * Looks for an attempt to pass a user network off as a built-in one.
 *
 * WHY THIS IS NEEDED IF chainId IS ALREADY CHECKED AGAINST THE NODE.
 *
 * Checking chainId proves the node serves the claimed network.
 * It does NOT prove that network is the one the user has in mind.
 * Classic trick: a site offers to add a network named `Ethereum`
 * but with its own chain id. The node honestly confirms its chainId,
 * the check passes, and the familiar name appears in the wallet
 * header. Then the user signs a transfer, believing it is going
 * to the main network.
 *
 * ONLY THE NAME IS CHECKED, NOT THE CURRENCY SYMBOL. `ETH` is
 * legitimately used by Optimism, Arbitrum, and Base — all built-in.
 * A warning on every symbol match would fire almost always and
 * almost always in vain, and a false alarm in a security system
 * is worse than no check: it trains people not to read warnings.
 *
 * A name match, by contrast, is never legitimate: two networks
 * named `Ethereum` do not exist.
 *
 * COMPARISON IS CASE- AND EDGE-SPACE-INSENSITIVE: `ethereum `
 * and `Ethereum` are the same thing to a person, and a defence
 * that a case change bypasses is useless.
 *
 * LOOK-ALIKE SUBSTITUTION IS CAUGHT TOO. `Ethereum` with a Cyrillic
 * e (U+0435) matches the Latin one in no byte, yet looks the same;
 * skeleton comparison reduces both names to one form.
 * A subset of confusable characters used in practice is taken —
 * the full Unicode table weighs more than the entire network
 * layer. The limit is named in the debt list.
 */
export function findImpersonation(
  candidate: { chainId: ChainId; name: string },
  builtInNetworks: readonly INetworkConfig[],
): IImpersonation | null {
  const name = normalize(candidate.name)
  const skeleton = toNameSkeleton(candidate.name)

  for (const builtIn of builtInNetworks) {
    /* Matching identifiers mean the same network, not a fake:
       adding a built-in network again is already rejected by the
       existence check. */
    if (builtIn.chainId === candidate.chainId) {
      continue
    }

    if (normalize(builtIn.name) === name) {
      return {
        name: builtIn.name,
        impersonated: builtIn,
        kind: IMPERSONATION_KIND.SameName,
        foreignCharacters: [],
      }
    }

    /* An empty skeleton is not a match: a name of punctuation
       alone would match every built-in. Such a name is rejected
       by the shape check, not here. */
    if (skeleton !== '' && toNameSkeleton(builtIn.name) === skeleton) {
      return {
        name: builtIn.name,
        impersonated: builtIn,
        kind: IMPERSONATION_KIND.LookAlike,
        foreignCharacters: findForeignCharacters(candidate.name),
      }
    }
  }

  return null
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}
