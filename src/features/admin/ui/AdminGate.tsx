import { useEffect, useMemo, useState } from 'react'
import { Outlet } from 'react-router'

import { AdminAuthError, AdminClient } from '../model/AdminClient'
import { ADMIN_ROLE, type AdminRole } from '../model/admin-role'
import { AdminSessionContext } from '../model/admin-context'
import { clearAdminPin, readAdminPin, writeAdminPin } from '../model/admin-pin'
import { AdminPinForm } from './AdminPinForm'
import { AdminShell } from './AdminShell'

function createAdminClient(): AdminClient {
  const configured = import.meta.env.VITE_SERVER_URL?.trim() ?? ''

  return new AdminClient({ baseUrl: configured })
}

/**
 * Cabinet gate: PIN on the server, session in `localStorage`.
 *
 * Nested routes do not mount until the PIN is accepted. After that
 * the shell stays in place when opening a user profile.
 */
export function AdminGate() {
  const client = useMemo(() => createAdminClient(), [])
  const [pin, setPin] = useState<string | null>(() => readAdminPin())
  const [role, setRole] = useState<AdminRole | null>(null)
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
      .then((nextRole) => {
        if (cancelled) {
          return
        }

        writeAdminPin(pin)
        setRole(nextRole)
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
        setRole(null)
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
    () =>
      role === null
        ? null
        : {
            client,
            role,
            canWrite: role === ADMIN_ROLE.Super,
            lock: () => {
              clearAdminPin()
              client.clearPin()
              setUnlocked(false)
              setRole(null)
              setPin(null)
              setError(null)
            },
          },
    [client, role],
  )

  if (pin === null || !unlocked || session === null) {
    return (
      <AdminPinForm
        error={error}
        isBusy={isBusy}
        onInteract={() => {
          setError(null)
        }}
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
      <AdminShell role={session.role} pin={pin} onLock={session.lock}>
        <Outlet />
      </AdminShell>
    </AdminSessionContext.Provider>
  )
}
