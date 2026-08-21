import { useEffect, useMemo, useState } from 'react'

import { AdminAuthError, AdminClient, AdminPinForm, AdminSessionContext } from '@/features/admin'

import {
  clearEmailManagerPin,
  readEmailManagerPin,
  writeEmailManagerPin,
} from '../model/email-manager-pin'
import { EmailManagerComposer } from './EmailManagerComposer'
import { EmailManagerShell } from './EmailManagerShell'

function createEmailManagerClient(): AdminClient {
  const configured = import.meta.env.VITE_SERVER_URL?.trim() ?? ''

  return new AdminClient({
    baseUrl: configured,
    authPath: '/v1/email-manager/auth',
    pinHeader: 'x-email-manager-pin',
  })
}

/**
 * Страж менеджера писем: свой PIN, своё поле в `localStorage`.
 *
 * Пока PIN не принят, форма отправки не монтируется.
 */
export function EmailManagerGate() {
  const client = useMemo(() => createEmailManagerClient(), [])
  const [pin, setPin] = useState<string | null>(() => readEmailManagerPin())
  const [unlocked, setUnlocked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setBusy] = useState(() => readEmailManagerPin() !== null)

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

        writeEmailManagerPin(pin)
        setError(null)
        setUnlocked(true)
      })
      .catch((caught: unknown) => {
        if (cancelled) {
          return
        }

        clearEmailManagerPin()
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
        clearEmailManagerPin()
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
