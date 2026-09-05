import type { IReleaseCatalog } from './types.ts'

/**
 * App release info.
 *
 * NO DOWNLOAD URL HERE. A service that says "your version is outdated,
 * download from here" is a ready way to send the user to a fake
 * installer: one swapped string in the response is enough. The store
 * URL is baked into the client and changes only with a new release,
 * so it goes through store signing and review.
 *
 * `minSupported` IS A SUPPORT STATEMENT, NOT A KILL SWITCH.
 * The service may not stop the wallet: a non-custodial app must stay
 * usable even when its service is down or hostile. The client shows
 * a warning and keeps working.
 */
export const RELEASES: IReleaseCatalog = {
  latest: '0.1.0',
  minSupported: '0.1.0',
  advisory: null,
}
