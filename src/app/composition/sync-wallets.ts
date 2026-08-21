import { INITIAL_WALLET_VALUE, readLoginCredentials } from '@/features/onboarding'
import type { IUserDirectory } from '@/features/onboarding'
import type { IWalletSession } from '@/features/wallet'

/**
 * Дописывает созданные адреса в `users.wallets`.
 *
 * КОГДА. Создание уже кладёт первый адрес в `POST /v1/users`.
 * Подписка ловит поздние аккаунты (`createAccount`, поиск).
 * Повтор того же адреса на сервере заменяет значение, не плодит дубликат.
 *
 * КЛЮЧ — АДРЕС, ЗНАЧЕНИЕ — `0`. Секретов в записи нет: seed и ключи
 * на сервер не уходят.
 *
 * ПОВТОР ТОГО ЖЕ АДРЕСА НЕ ШЛЁТСЯ. Снимок обновляется на каждый баланс;
 * без запоминания уже записанных адресов сервер получал бы тот же
 * `POST` десятки раз за сессию.
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
          key: account.address,
          value: INITIAL_WALLET_VALUE,
        })
        .catch(() => {
          posted.delete(fingerprint)
        })
    }
  })
}
