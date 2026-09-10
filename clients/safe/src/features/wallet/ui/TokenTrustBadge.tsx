import { ShieldCheck } from 'lucide-react'

import type { IToken } from '@/core'
import { Badge } from '@/shared/ui'

/**
 * Trust mark for a token contract.
 *
 * The ticker is set by the contract author: anyone can mint `USDC`,
 * and in the asset list a fake looks like the original. Only the
 * address distinguishes them, and nobody will check forty-two
 * characters by eye.
 *
 * Three states, each meaning something different:
 *
 * - `verified` — the address matched the built-in list. A claim
 *   about the ADDRESS, not about the project's reliability: the
 *   wallet cannot promise the latter;
 * - `unverified` — added by hand and not on the list. This is NOT
 *   an accusation of fraud: the list is incomplete by design, and
 *   most legitimate tokens are not on it;
 * - empty — native currency, part of the network config.
 *
 * Verified is marked with an icon, not color. A green chip on every
 * other row stops being read, and color as the only cue is invisible
 * to people with color-vision deficiency.
 */
export function TokenTrustBadge({ token }: { readonly token: IToken }) {
  if (token.address === null) {
    return null
  }

  if (token.isVerified) {
    return (
      <Badge variant="outline" title="The contract address matches the built-in list">
        <ShieldCheck className="size-3" aria-hidden />
        verified
      </Badge>
    )
  }

  return token.isCustom ? (
    <Badge variant="outline" title="The contract is not in the built-in list — check its address">
      unverified
    </Badge>
  ) : null
}
