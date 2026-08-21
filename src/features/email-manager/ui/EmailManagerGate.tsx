import { useEffect, useMemo, useState } from 'react'

import {
  AdminAuthError,
  AdminClient,
  AdminPinForm,
  AdminSessionContext,
  clearAdminPin,
  readAdminPin,
  writeAdminPin,
} from '@/features/admin'

import { EmailManagerComposer } from './EmailManagerComposer'
import { EmailManagerShell } from './EmailManagerShell'

function createAdminClient(): AdminClient {
  const configured = import.meta.env.VITE_SERVER_URL?.trim() ?? ''

  return new AdminClient({ baseUrl: configured })
}

/**
 * Страж менеджера писем: PIN на сервере, сессия — в `localStorage`.
 *
 * Пока PIN не принят, форма отправки не монтируется.
 */
export function EmailManagerGate() {
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
        title="Email manager"
        description="Enter the PIN to send email."
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
      <EmailManagerShell onLock={session.lock}>
        <EmailManagerComposer />
      </EmailManagerShell>
    </AdminSessionContext.Provider>
  )
}
