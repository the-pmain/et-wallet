import { InsecureRpcUrlError, InvalidArgumentError, InvalidRpcUrlError } from '@/core/errors'

/**
 * Protocols allowed for an RPC endpoint.
 *
 * Plain HTTP is excluded outright. A middleman on an unprotected
 * channel substitutes the balance, nonce, gas price, and contract
 * call result — the user signs a transaction different from the
 * one shown on screen. This is not a theoretical risk: public
 * Wi-Fi access points and corporate proxies intercept HTTP as
 * a matter of course.
 */
const ALLOWED_PROTOCOLS: readonly string[] = ['https:', 'wss:']

/**
 * Checks that an RPC address is fit to use.
 *
 * @throws InvalidRpcUrlError if the string does not parse as a URL.
 * @throws InsecureRpcUrlError if the protocol is not on the allowed list.
 */
export function assertValidRpcUrl(value: string): void {
  let url: URL

  try {
    url = new URL(value)
  } catch {
    throw new InvalidRpcUrlError(value)
  }

  if (!ALLOWED_PROTOCOLS.includes(url.protocol)) {
    throw new InsecureRpcUrlError(url.protocol)
  }
}

/**
 * Checks a network's RPC address list.
 *
 * An empty list is rejected: a network with no node is unusable,
 * and that is better found at add time than on the first transaction.
 *
 * @throws InvalidArgumentError, InvalidRpcUrlError, InsecureRpcUrlError
 */
export function assertValidRpcUrls(values: readonly string[]): void {
  if (values.length === 0) {
    throw new InvalidArgumentError('rpcUrls', 'at least one RPC endpoint is required')
  }

  for (const value of values) {
    assertValidRpcUrl(value)
  }
}

/**
 * Checks a block-explorer address.
 *
 * Requiring `https` here has milder consequences than for RPC: the
 * explorer does not affect signed data. But an HTTP link from the
 * wallet is a navigation that can be intercepted and replaced with
 * a phishing copy of the explorer, where the user is shown a
 * "successful" transaction.
 *
 * @throws InvalidRpcUrlError, InsecureRpcUrlError
 */
export function assertValidExplorerUrl(value: string): void {
  let url: URL

  try {
    url = new URL(value)
  } catch {
    throw new InvalidRpcUrlError(value)
  }

  if (url.protocol !== 'https:') {
    throw new InsecureRpcUrlError(url.protocol)
  }
}
