/**
 * Default fractional digits shown.
 *
 * Six, not eighteen: full native-currency precision is unreadable and
 * implies the last digits matter.
 */
const DEFAULT_FRACTION_DIGITS = 6

/**
 * Format a raw (smallest-unit) amount for display.
 *
 * All math is `bigint`. Casting to `number` at 18 decimals loses
 * precision on tenths of a token: `Number.MAX_SAFE_INTEGER` is less
 * than 0.01 ETH in wei.
 *
 * Truncate, do not round up. Rounding up would show more than the
 * owner has and invite a send that cannot succeed. The shown value
 * never exceeds the real one.
 *
 * A non-zero remainder never becomes zero. Dust below display
 * precision is `<0.000001`. A shown zero on a non-zero balance would
 * claim "no funds".
 */
export function formatTokenAmount(
  raw: bigint,
  decimals: number,
  fractionDigits: number = DEFAULT_FRACTION_DIGITS,
): string {
  if (raw < 0n) {
    return `-${formatTokenAmount(-raw, decimals, fractionDigits)}`
  }

  const scale = 10n ** BigInt(decimals)
  const whole = raw / scale
  const remainder = raw % scale

  if (remainder === 0n) {
    return whole.toString()
  }

  /* Pad the fraction to full length: 0.05 at 18 decimals is 5·10¹⁶,
     and without padding the remainder "5" would be read as 0.5. */
  const fraction = remainder.toString().padStart(decimals, '0').slice(0, fractionDigits)
  const trimmed = fraction.replace(/0+$/u, '')

  if (trimmed === '') {
    /* Remainder exists but does not fit the displayed precision. */
    return `<${formatSmallestVisible(whole, fractionDigits)}`
  }

  return `${whole.toString()}.${trimmed}`
}

/**
 * Full token-unit amount, no truncation.
 *
 * For the input field: show `2`, not `2000000000000000000`, and do
 * not replace dust with `<0.000001`. Inverse of {@link parseAmount}.
 */
export function formatExactTokenAmount(raw: bigint, decimals: number): string {
  if (raw < 0n) {
    return `-${formatExactTokenAmount(-raw, decimals)}`
  }

  if (decimals === 0) {
    return raw.toString()
  }

  const scale = 10n ** BigInt(decimals)
  const whole = raw / scale
  const remainder = raw % scale

  if (remainder === 0n) {
    return whole.toString()
  }

  const fraction = remainder.toString().padStart(decimals, '0').replace(/0+$/u, '')

  return `${whole.toString()}.${fraction}`
}

/** Smallest value distinguishable at the given precision. */
function formatSmallestVisible(whole: bigint, fractionDigits: number): string {
  const fraction = '0'.repeat(Math.max(fractionDigits - 1, 0))

  return `${whole.toString()}.${fraction}1`
}

/**
 * Truncate an address for a narrow UI slot.
 *
 * Casing is kept: it carries the EIP-55 checksum. Lowercasing "for
 * looks" would remove the only chance to notice a swapped address.
 *
 * Start and end are shown. The middle does not help recognition;
 * swapping the ends is what is visible.
 */
export function shortenAddress(address: string, visibleChars = 6): string {
  if (address.length <= visibleChars * 2 + 1) {
    return address
  }

  return `${address.slice(0, visibleChars)}…${address.slice(-visibleChars)}`
}

/**
 * Address label: a verified ENS name, otherwise the truncated address.
 *
 * Replacement is not always allowed. A name is shorter and easier to
 * recognize in an account list. On a send-confirm screen it is
 * forbidden: the address is what is signed, and showing a name instead
 * is the main wallet-UI attack class. There the name is shown in
 * addition to the full address.
 *
 * The map holds only names checked by forward resolution: anyone can
 * set an unchecked reverse-record name.
 */
export function addressLabel(address: string, ensNames: ReadonlyMap<string, string>): string {
  return ensNames.get(address.toLowerCase()) ?? shortenAddress(address)
}

/**
 * Host name from an RPC URL.
 *
 * Show the host, not the full URL. The path holds a key (Alchemy app
 * key, or the user's own node credential). Showing it leaks on screen
 * shares and screenshots; the host is enough to recognize the node.
 *
 * An unparseable string is returned as-is: hiding a mystery value is
 * worse than showing what is actually stored.
 */
export function endpointHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Operation date and time in the local format. */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString()
}
