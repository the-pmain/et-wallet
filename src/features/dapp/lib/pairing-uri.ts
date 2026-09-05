/**
 * WalletConnect pairing URI scheme.
 *
 * Checked exactly, not by substring: `https://evil/wc:…` contains
 * `wc:` and would pass a search without being a pairing URI.
 */
const PAIRING_SCHEME = 'wc:'

/**
 * Upper length bound.
 *
 * A pairing URI is topic, version, and key — about a hundred and
 * fifty characters. A barcode holds several thousand, and accepting
 * them all lets a stranger fill the input with a wall of text.
 */
const MAX_PAIRING_URI_LENGTH = 512

/**
 * Whether the scanned text looks like a pairing URI.
 *
 * TEXT FROM A SCREEN OR A STICKER IS UNTRUSTED. A barcode can hold
 * anything: a site URL, another wallet's payment request, arbitrary
 * text. Handing that to pairing unread would run a stranger's
 * command; dropping it silently would leave the person in front of
 * a camera that "does not work".
 *
 * The check is SHALLOW ON PURPOSE: the URI must not be parsed here.
 * That is WalletConnect's job, and a second parser would mean two
 * ideas of what counts as a URI.
 */
export function isPairingUri(text: string): boolean {
  const value = text.trim()

  return (
    value.length > PAIRING_SCHEME.length &&
    value.length <= MAX_PAIRING_URI_LENGTH &&
    value.startsWith(PAIRING_SCHEME)
  )
}
