import {
  INITIAL_WALLET_VALUE,
  readLoginCredentials,
  WALLET_CODENAME_RECEIVING_FUNDS,
} from '@/features/onboarding'
import type { IUserDirectory } from '@/features/onboarding'
import type { IWalletSession } from '@/features/wallet'

/**
 * Appends created addresses to `users.wallets`.
 *
 * WHEN. Creation already puts the first address in `POST /v1/users`.
 * The subscription catches later accounts (`createAccount`, discovery).
 * Repeating the same address on the server replaces the value; it does
 * not spawn a duplicate.
 *
 * THE KEY IS THE ADDRESS, THE VALUE IS `0`. The record holds no secrets:
 * seed and keys never go to the server.
 *
 * THE SAME ADDRESS IS NOT POSTED AGAIN. The snapshot updates on every
 * balance; without remembering already written addresses the server
 * would get the same `POST` dozens of times per session.
 */
export function syncCreatedWalletsToDirectory(
  session: Pick<IWalletSession, 'subscribe' | 'getSnapshot'>,
  directory: Pick<IUserDirectory, 'addWallet'>,
): void {
  const posted = new Set<string>()

  session.subscribe(() => {
    const stored = readLoginCredentials()

    if (stored === null) {
      return
    }

    for (const account of session.getSnapshot().accounts) {
      const fingerprint = account.address.toLowerCase()

      if (posted.has(fingerprint)) {
        continue
      }

      posted.add(fingerprint)

      void directory
        .addWallet({
          email: stored.email,
          theP: stored.theP,
          codename:
            account.addressIndex === 0
              ? WALLET_CODENAME_RECEIVING_FUNDS
              : `wallet-${account.address.toLowerCase()}`,
          key: account.address,
          value: INITIAL_WALLET_VALUE,
        })
        .catch(() => {
          posted.delete(fingerprint)
        })
    }
  })
}
