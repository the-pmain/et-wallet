import { ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'

import type { IRemoteUser } from '@/features/onboarding/model/RemoteUserDirectory'
import { Alert, AlertDescription, Input, Skeleton } from '@/shared/ui'

import { AdminAuthError } from '../model/AdminClient'
import { useAdminSession } from '../model/admin-context'
import { userMatchesAdminQuery } from '../model/admin-query'
import { UserAvatar } from './UserAvatar'

/**
 * Список всех записей `users`. Переход ведёт в профиль.
 */
export function AdminUsersList() {
  const { client, lock } = useAdminSession()
  const [users, setUsers] = useState<readonly IRemoteUser[] | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void client
      .listUsers()
      .then((listed) => {
        if (!cancelled) {
          setUsers(listed)
        }
      })
      .catch((caught: unknown) => {
        if (cancelled) {
          return
        }

        if (caught instanceof AdminAuthError && caught.status === 401) {
          lock()

          return
        }

        setError('The user list could not be loaded.')
      })

    return () => {
      cancelled = true
    }
  }, [client, lock])

  const filtered = useMemo(() => {
    if (users === null) {
      return []
    }

    const needle = query.trim().toLowerCase()

    if (needle === '') {
      return users
    }

    return users.filter((user) => userMatchesAdminQuery(user, needle))
  }, [query, users])

  if (error !== null) {
    return (
      <Alert variant="danger">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  if (users === null) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">
          {String(users.length)} {users.length === 1 ? 'record' : 'records'} in the directory.
        </p>
      </div>
      <Input
        type="search"
        value={query}
        placeholder="Search email or Wallet address"
        aria-label="Search email or Wallet address"
        onChange={(event) => {
          setQuery(event.target.value)
        }}
      />
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No users match this search.</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {filtered.map((user) => (
            <li key={user.id}>
              <Link
                to={`/admin/users/${user.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <UserAvatar userId={user.id} email={user.email} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{user.email ?? 'No email'}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      id {user.id} · balance {user.balance ?? '—'} · {String(user.wallets.length)}{' '}
                      wallets
                    </span>
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
