import { useEffect, useMemo, useState } from 'react'
import { Outlet } from 'react-router'

import { AdminAuthError, AdminClient } from '../model/AdminClient'
import { AdminSessionContext } from '../model/admin-context'
import { clearAdminPin, readAdminPin, writeAdminPin } from '../model/admin-pin'
import { AdminPinForm } from './AdminPinForm'
import { AdminShell } from './AdminShell'

function createAdminClient(): AdminClient {
  const configured = import.meta.env.VITE_SERVER_URL?.trim() ?? ''

  return new AdminClient({ baseUrl: configured })
}

/**
 * Страж кабинета: PIN на сервере, сессия — в `localStorage`.
 *
 * Пока PIN не принят, вложенные маршруты не монтируются. После приёма
 * оболочка остаётся на месте при переходе к профилю пользователя.
 */
export function AdminGate() {
  const client = useMemo(() => createAdminClient(), [])
  const [pin, setPin] = useState<string | null>(() => readAdminPin())
  const [unlocked, setUnlocked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setBusy] = useState(() => readAdminPin() !== null)

  useEffect(() => {
    if (pin === null) {
      client.clearPin()

      return
    }

    let cancelled = false

    void client
      .authenticate(pin)
      .then(() => {
        if (cancelled) {
          return
        }

        writeAdminPin(pin)
        setError(null)
        setUnlocked(true)
      })
      .catch((caught: unknown) => {
        if (cancelled) {
          return
        }

        clearAdminPin()
        client.clearPin()
        setUnlocked(false)
        setPin(null)
        setError(
          caught instanceof AdminAuthError && caught.status === 401 ? 'wrong' : 'unavailable',
        )
      })
      .finally(() => {
        if (!cancelled) {
          setBusy(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [client, pin])

  const session = useMemo(
    () => ({
      client,
      lock: () => {
        clearAdminPin()
        client.clearPin()
        setUnlocked(false)
        setPin(null)
        setError(null)
      },
    }),
    [client],
  )

  if (pin === null || !unlocked) {
    return (
      <AdminPinForm
        error={error}
        isBusy={isBusy}
        onSubmit={(value) => {
          setError(null)
          setBusy(true)
          setPin(value)
        }}
      />
    )
  }

  return (
    <AdminSessionContext.Provider value={session}>
      <AdminShell onLock={session.lock}>
        <Outlet />
      </AdminShell>
    </AdminSessionContext.Provider>
  )
}
