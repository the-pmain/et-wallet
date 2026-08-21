import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import type {
  IRemoteAssetToken,
  IRemoteAssets,
  IRemoteUser,
  IWalletEntry,
} from '@/features/onboarding/model/RemoteUserDirectory'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Skeleton,
} from '@/shared/ui'

import { AdminAuthError } from '../model/AdminClient'
import { useAdminSession } from '../model/admin-context'
import { UserAvatar } from './UserAvatar'

const ADDRESS_SHAPE = /^0x[0-9a-fA-F]{40}$/u

/**
 * Профиль записи: почта, баланс, колонка `wallets`, витрина `assets`.
 */
export function AdminUserProfile() {
  const { userId } = useParams()
  const navigate = useNavigate()
  const { client, lock } = useAdminSession()
  const [user, setUser] = useState<IRemoteUser | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (userId === undefined) {
      return
    }

    let cancelled = false

    void client
      .getUser(userId)
      .then((record) => {
        if (!cancelled) {
          setUser(record)
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

        setLoadError(
          caught instanceof AdminAuthError && caught.status === 404 ? 'missing' : 'failed',
        )
      })

    return () => {
      cancelled = true
    }
  }, [client, lock, userId])

  if (loadError === 'missing') {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <Alert variant="danger">
          <AlertDescription>This user does not exist.</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (loadError !== null) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <Alert variant="danger">
          <AlertDescription>The profile could not be loaded.</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (user === null || userId === undefined) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  return (
    <ProfileEditor
      key={user.id}
      user={user}
      onUpdated={setUser}
      onDeleted={() => {
        void navigate('/admin')
      }}
    />
  )
}

function ProfileEditor({
  user,
  onUpdated,
  onDeleted,
}: {
  readonly user: IRemoteUser
  readonly onUpdated: (user: IRemoteUser) => void
  readonly onDeleted: () => void
}) {
  const { client, lock } = useAdminSession()
  const emailId = useId()
  const balanceId = useId()
  const passwordId = useId()
  const [email, setEmail] = useState(user.email ?? '')
  const [balance, setBalance] = useState(user.balance ?? '')
  const [password, setPassword] = useState('')
  const [wallets, setWallets] = useState<IWalletEntry[]>(() => [...(user.wallets ?? [])])
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('0')
  const [assets, setAssets] = useState<IRemoteAssets>(
    () =>
      user.assets ?? {
        quoteCurrency: 'USD',
        updatedAt: user.createdAt,
        totalValueUsd: '0',
        tokens: [],
      },
  )
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const run = async (key: string, work: () => Promise<IRemoteUser | void>) => {
    setBusy(key)
    setError(null)
    setMessage(null)

    try {
      const next = await work()

      if (next !== undefined) {
        onUpdated(next)
      }

      setMessage('Saved.')
    } catch (caught: unknown) {
      if (caught instanceof AdminAuthError && caught.status === 401) {
        lock()

        return
      }

      setError('The change could not be saved.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <BackLink />
        <div className="flex items-center gap-4">
          <UserAvatar userId={user.id} email={user.email} className="size-14" />
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{user.email ?? 'User'}</h1>
            <p className="text-sm text-muted-foreground">
              id {user.id} · created {formatDate(user.createdAt)}
            </p>
          </div>
        </div>
      </div>

      {error !== null ? (
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {message !== null ? (
        <Alert>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field id={emailId} label="Email" value={email} onChange={setEmail} />
          <Field id={balanceId} label="Balance" value={balance} onChange={setBalance} />
          <Field
            id={passwordId}
            label="New password (the_p)"
            value={password}
            onChange={setPassword}
            type="password"
          />
          <Button
            type="button"
            disabled={busy !== null || email.trim() === '' || balance.trim() === ''}
            onClick={() => {
              void run('account', async () => {
                const patch: { email: string; balance: string; theP?: string } = {
                  email: email.trim(),
                  balance: balance.trim(),
                }

                if (password.trim() !== '') {
                  patch.theP = password.trim()
                }

                const next = await client.updateUser(user.id, patch)
                setPassword('')

                return next
              })
            }}
          >
            {busy === 'account' ? 'Saving…' : 'Save account'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Wallets</CardTitle>
          <p className="text-sm text-muted-foreground">
            Column `wallets`: each row is an address (`key`) and its stored value (`value`).
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {wallets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No addresses yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {wallets.map((entry, index) => (
                <li
                  key={entry.key}
                  className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_8rem_auto]"
                >
                  <Input value={entry.key} readOnly aria-label={`Address ${String(index + 1)}`} />
                  <Input
                    value={entry.value}
                    aria-label={`Value for ${entry.key}`}
                    onChange={(event) => {
                      const value = event.target.value
                      setWallets((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { key: item.key, value } : item,
                        ),
                      )
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${entry.key}`}
                    onClick={() => {
                      setWallets((current) => current.filter((_, itemIndex) => itemIndex !== index))
                    }}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid gap-2 sm:grid-cols-[1fr_8rem_auto]">
            <Input
              value={newKey}
              placeholder="0x…"
              aria-label="New wallet address"
              onChange={(event) => {
                setNewKey(event.target.value)
              }}
            />
            <Input
              value={newValue}
              aria-label="New wallet value"
              onChange={(event) => {
                setNewValue(event.target.value)
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={!ADDRESS_SHAPE.test(newKey.trim()) || newValue.trim() === ''}
              onClick={() => {
                const key = newKey.trim()
                const value = newValue.trim()
                setWallets((current) => {
                  const without = current.filter(
                    (item) => item.key.toLowerCase() !== key.toLowerCase(),
                  )

                  return [...without, { key, value }]
                })
                setNewKey('')
                setNewValue('0')
              }}
            >
              <Plus />
              Add
            </Button>
          </div>
          <Button
            type="button"
            disabled={busy !== null || wallets.some((entry) => entry.value.trim() === '')}
            onClick={() => {
              void run('wallets', () =>
                client.updateUser(user.id, {
                  wallets: wallets.map((entry) => ({ key: entry.key, value: entry.value.trim() })),
                }),
              )
            }}
          >
            {busy === 'wallets' ? 'Saving…' : 'Save wallets'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assets</CardTitle>
          <p className="text-sm text-muted-foreground">
            Showcase stored on the user record, not a live chain scan.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field
            id={`${user.id}-total`}
            label="Total USD"
            value={assets.totalValueUsd}
            onChange={(value) => {
              setAssets((current) => ({ ...current, totalValueUsd: value }))
            }}
          />
          <ul className="flex flex-col gap-3">
            {assets.tokens.map((token, index) => (
              <li
                key={tokenKey(token, index)}
                className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2"
              >
                <p className="text-sm font-medium sm:col-span-2">
                  {token.symbol} · chain {token.chainId}
                </p>
                <Input
                  value={token.balance}
                  aria-label={`${token.symbol} balance`}
                  onChange={(event) => {
                    const balance = event.target.value
                    setAssets((current) => ({
                      ...current,
                      tokens: current.tokens.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, balance } : item,
                      ),
                    }))
                  }}
                />
                <Input
                  value={token.valueUsd}
                  aria-label={`${token.symbol} USD value`}
                  onChange={(event) => {
                    const valueUsd = event.target.value
                    setAssets((current) => ({
                      ...current,
                      tokens: current.tokens.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, valueUsd } : item,
                      ),
                    }))
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  className="justify-start sm:col-span-2"
                  onClick={() => {
                    setAssets((current) => ({
                      ...current,
                      tokens: current.tokens.filter((_, itemIndex) => itemIndex !== index),
                    }))
                  }}
                >
                  <Trash2 />
                  Remove {token.symbol}
                </Button>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            disabled={busy !== null}
            onClick={() => {
              void run('assets', () =>
                client.updateUser(user.id, {
                  assets: {
                    ...assets,
                    updatedAt: new Date().toISOString(),
                  },
                }),
              )
            }}
          >
            {busy === 'assets' ? 'Saving…' : 'Save assets'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Danger</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="destructive"
            disabled={busy !== null}
            onClick={() => {
              if (!window.confirm(`Delete ${user.email ?? user.id}? This cannot be undone.`)) {
                return
              }

              void run('delete', async () => {
                await client.deleteUser(user.id)
                onDeleted()
              })
            }}
          >
            {busy === 'delete' ? 'Deleting…' : 'Delete user'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function BackLink() {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
      <Link to="/admin">
        <ArrowLeft />
        All users
      </Link>
    </Button>
  )
}

function Field({
  id,
  label,
  value,
  onChange,
  type = 'text',
}: {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly type?: 'text' | 'password'
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        autoComplete={type === 'password' ? 'new-password' : 'off'}
        onChange={(event) => {
          onChange(event.target.value)
        }}
      />
    </div>
  )
}

function tokenKey(token: IRemoteAssetToken, index: number): string {
  return `${token.chainId}:${token.address ?? 'native'}:${String(index)}`
}

function formatDate(value: string): string {
  const parsed = Date.parse(value)

  if (Number.isNaN(parsed)) {
    return value
  }

  return new Date(parsed).toLocaleString()
}
