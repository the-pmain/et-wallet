import type { ChainId } from '@/core/types'

import type { IPriceProvider } from './contracts'
import type { FiatCurrency, IPriceRef, PriceMap } from './types'

/**
 * A source that does not know rates.
 *
 * THIS IS NOT A TEST STUB, IT IS LIVE DEFAULT BEHAVIOUR. Until the
 * user consents to calling a third-party service, the wallet does
 * not request rates — and that state must be expressed as an
 * object, not as the absence of an object: `null` instead of a
 * source would force every call site to remember the check.
 *
 * An empty map means "rates are unknown", and the UI shows the
 * portfolio without a value. It does not mean "the assets are
 * worth nothing".
 */
export class NullPriceProvider implements IPriceProvider {
  readonly id = 'none'
  readonly name = 'No price source is connected'

  supports(_chainId: ChainId): boolean {
    return false
  }

  getPrices(_refs: readonly IPriceRef[], _currency: FiatCurrency): Promise<PriceMap> {
    return Promise.resolve(new Map())
  }
}
