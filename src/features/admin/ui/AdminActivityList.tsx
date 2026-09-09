import { History } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'

import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription, EmptyState, Input, Skeleton } from '@/shared/ui'

import { formatAdminTimestamp } from '../lib/format-admin-timestamp'
import { formatLoginLocation } from '../lib/format-login-location'
import { AdminAuthError, type IAdminLogin, type IAdminUserActivity } from '../model/AdminClient'
import { activityMatchesAdminQuery } from '../model/activity-query'
import { useAdminSession } from '../model/admin-context'
import { UserAvatar } from './UserAvatar'

export function AdminActivityList() {
  const { client, lock } = useAdminSession()
  const [users, setUsers] = useState<readonly IAdminUserActivity[] | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void client
      .listLoginActivity()
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

        setError('The activity list could not be loaded.')
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

    return users.filter((row) => activityMatchesAdminQuery(row, needle))
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

  const authentications = users.reduce((total, row) => total + row.loginCount, 0)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="text-sm text-muted-foreground">
          {String(users.length)} {users.length === 1 ? 'user' : 'users'} · {String(authentications)}{' '}
          {authentications === 1 ? 'authentication' : 'authentications'}.
        </p>
      </div>
      <Input
        type="search"
        value={query}
        placeholder="Search email, user id, or location"
        aria-label="Search email, user id, or location"
        onChange={(event) => {
          setQuery(event.target.value)
        }}
      />
      {filtered.length === 0 ? (
        users.length === 0 ? (
          <EmptyState
            icon={History}
            title="No activity yet"
            description="Successful app logins appear here after a user signs in."
          />
        ) : (
          <p className="text-sm text-muted-foreground">No users match this search.</p>
        )
      ) : (
        <ul className="divide-y rounded-xl border">
          {filtered.map((row) => (
            <ActivityRow key={row.userId} row={row} />
          ))}
        </ul>
      )}
    </div>
  )
}

function ActivityRow({ row }: { readonly row: IAdminUserActivity }) {
  const hasLogins = row.logins.length > 0
  const email = row.email ?? 'No email'
  const countLabel =
    row.loginCount === 1 ? '1 authentication' : `${String(row.loginCount)} authentications`

  const identity = (
    <span className="flex min-w-0 items-center gap-3">
      <UserAvatar userId={row.userId} email={row.email} />
      <span className="min-w-0">
        <span className={cn('block truncate font-medium', !hasLogins && 'text-muted-foreground')}>
          {email}
        </span>
        <span
          className={cn(
            'block truncate text-xs',
            hasLogins ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          id {row.userId} · {countLabel}
        </span>
      </span>
    </span>
  )

  if (!hasLogins) {
    return (
      <li>
        <Link
          to={`/admin/users/${row.userId}`}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-muted-foreground hover:bg-accent"
        >
          {identity}
          <span className="shrink-0 text-xs">Never signed in</span>
        </Link>
      </li>
    )
  }

  return (
    <li>
      <details className="group hover:bg-accent">
        <summary className="flex w-full cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 select-none [&::-webkit-details-marker]:hidden">
          {identity}
          <LastLogin login={row.logins[0]} />
        </summary>
        <ol className="ml-10 flex flex-col gap-2 border-l px-4 pb-3">
          {row.logins.map((login, index) => (
            <li
              key={login.id}
              className={cn('text-foreground', index === 0 ? 'text-base' : 'text-sm')}
            >
              <time dateTime={login.createdAt} className="tabular-nums">
                {formatAdminTimestamp(login.createdAt)}
              </time>
              <LoginPlace login={login} className={index === 0 ? 'ml-2 text-sm' : 'ml-2 text-xs'} />
              {index === 0 ? (
                <span className="ml-2 text-xs text-muted-foreground">latest</span>
              ) : null}
            </li>
          ))}
        </ol>
      </details>
    </li>
  )
}

function LastLogin({ login }: { readonly login: IAdminLogin | undefined }) {
  if (login === undefined) {
    return null
  }

  const place = formatLoginLocation(login)

  return (
    <span className="shrink-0 text-right">
      <time
        dateTime={login.createdAt}
        className="block text-sm font-medium text-foreground tabular-nums"
      >
        {formatAdminTimestamp(login.createdAt)}
      </time>
      {place !== null ? (
        <span className="mt-0.5 block max-w-[14rem] truncate text-xs text-muted-foreground">
          {place}
        </span>
      ) : null}
    </span>
  )
}

function LoginPlace({
  login,
  className,
}: {
  readonly login: IAdminLogin
  readonly className?: string
}) {
  const place = formatLoginLocation(login)

  if (place === null) {
    return null
  }

  return <span className={cn('text-muted-foreground', className)}>{place}</span>
}
