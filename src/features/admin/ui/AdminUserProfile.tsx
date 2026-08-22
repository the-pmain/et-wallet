import { ArrowLeft, Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import type { PriceMap } from '@/core'

import { mapRemoteAssets } from '@/features/onboarding/lib/map-remote-assets'
import type {
  IRemoteAssetToken,
  IRemoteAssets,
  IRemoteUser,
  IWalletEntry,
} from '@/features/onboarding/model/RemoteUserDirectory'
import { useRemoteAssetQuotes } from '@/features/onboarding/model/use-remote-asset-quotes'
import { TokenAvatar } from '@/features/wallet/ui/TokenAvatar'
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
  SegmentedControl,
  Skeleton,
} from '@/shared/ui'

import {
  cryptoEquivalentFromUsdInput,
  quotePriceUsd,
  tryParseUsdToMinimalUnits,
  usdInputFromStoredBalance,
} from '../lib/asset-usd-input'

import { AdminAuthError } from '../model/AdminClient'
import { networkNameForChain, parseRemoteChainId, remoteAssetKey } from '../model/addable-assets'
import { useAdminSession } from '../model/admin-context'
import { AddAssetMenu } from './AddAssetMenu'
import { UserAvatar } from './UserAvatar'

const ADDRESS_SHAPE = /^0x[0-9a-fA-F]{40}$/u

const PROFILE_TAB = {
  Assets: 'assets',
  Account: 'account',
  Wallets: 'wallets',
} as const

type ProfileTab = (typeof PROFILE_TAB)[keyof typeof PROFILE_TAB]

const PROFILE_TABS = [
  { value: PROFILE_TAB.Assets, label: 'Assets' },
  { value: PROFILE_TAB.Account, label: 'Account' },
  { value: PROFILE_TAB.Wallets, label: 'Wallets' },
] as const

/**
 * Профиль записи: вкладки Assets (первая), Account, Wallets.
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
        tokens: [],
      },
  )
  const [draftUsdAmounts, setDraftUsdAmounts] = useState<string[]>(() =>
    (user.assets?.tokens ?? []).map(() => ''),
  )
  const usdDraftInitialized = useRef(false)
  const { quotes, isLoading: isQuotesLoading } = useRemoteAssetQuotes(assets.tokens)
  const quotedAssets = useMemo(
    () => ({ ...assets, tokens: withDraftUsdBalances(assets.tokens, draftUsdAmounts, quotes) }),
    [assets, draftUsdAmounts, quotes],
  )
  const valued = mapRemoteAssets(quotedAssets, quotes)

  useEffect(() => {
    usdDraftInitialized.current = false
    setDraftUsdAmounts((user.assets?.tokens ?? []).map(() => ''))
  }, [user.id, user.assets?.tokens.length])

  useEffect(() => {
    if (isQuotesLoading || usdDraftInitialized.current) {
      return
    }

    usdDraftInitialized.current = true
    setDraftUsdAmounts(
      assets.tokens.map((token) => {
        const price = quotePriceUsd(token, quotes)

        return price === null
          ? '0'
          : usdInputFromStoredBalance(token.balance, token.decimals, price)
      }),
    )
  }, [assets.tokens, isQuotesLoading, quotes])

  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [tab, setTab] = useState<ProfileTab>(PROFILE_TAB.Assets)

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

      <SegmentedControl
        legend="Profile section"
        value={tab}
        options={PROFILE_TABS}
        onChange={setTab}
      />

      {tab === PROFILE_TAB.Assets ? (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 flex-col gap-1.5">
                <CardTitle>Assets</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Enter each holding in USD. The crypto equivalent updates live from CoinGecko
                  prices. Each row saves on its own.
                </p>
              </div>
              <AddAssetMenu
                existing={assets.tokens}
                disabled={busy !== null}
                onAdd={(token) => {
                  if (
                    assets.tokens.some((item) => remoteAssetKey(item) === remoteAssetKey(token))
                  ) {
                    return
                  }

                  void run('asset-add', async () => {
                    const nextAssets: IRemoteAssets = {
                      ...assets,
                      updatedAt: new Date().toISOString(),
                      tokens: [...assets.tokens, token],
                    }
                    const next = await client.updateUser(user.id, { assets: nextAssets })
                    setAssets(next.assets)
                    setDraftUsdAmounts((current) =>
                      next.assets.tokens.map(
                        (item, itemIndex) =>
                          current[itemIndex] ??
                          usdInputFromStoredBalance(
                            item.balance,
                            item.decimals,
                            quotePriceUsd(item, quotes) ?? 0,
                          ),
                      ),
                    )

                    return next
                  })
                }}
              />
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex min-h-5 items-center gap-2 text-sm">
              Estimated total:{' '}
              {isQuotesLoading ? (
                <Skeleton className="h-4 w-24" />
              ) : (
                <span className="font-medium tabular-nums">
                  {new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: 'USD',
                  }).format(valued.portfolio.totalValue)}
                </span>
              )}
            </div>
            <ul className="flex flex-col gap-3">
              {assets.tokens.map((token, index) => {
                const draftUsd = draftUsdAmounts[index] ?? ''
                const priceUsd = quotePriceUsd(token, quotes)
                const parsed =
                  priceUsd === null
                    ? null
                    : tryParseUsdToMinimalUnits(draftUsd, priceUsd, token.decimals)
                const equivalent = cryptoEquivalentFromUsdInput(draftUsd, token, priceUsd)
                const saveKey = `asset:${String(index)}`
                const removeKey = `asset-remove:${String(index)}`

                return (
                  <li
                    key={tokenKey(token, index)}
                    className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <div className="flex items-center gap-3 sm:col-span-2">
                      <TokenAvatar
                        address={token.address}
                        symbol={token.symbol}
                        chainId={parseRemoteChainId(token.chainId)}
                        className="size-8"
                      />
                      <p className="min-w-0 text-sm font-medium">
                        {token.symbol}
                        <span className="font-normal text-muted-foreground">
                          {' '}
                          · {networkNameForChain(token.chainId)}
                        </span>
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Input
                        value={draftUsd}
                        inputMode="decimal"
                        placeholder="0.00"
                        aria-label={`${token.symbol} value in USD`}
                        disabled={priceUsd === null && !isQuotesLoading}
                        onChange={(event) => {
                          const nextAmount = event.target.value
                          setDraftUsdAmounts((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index ? nextAmount : item,
                            ),
                          )
                        }}
                      />
                      {isQuotesLoading ? (
                        <Skeleton className="h-4 w-28" />
                      ) : priceUsd === null ? (
                        <p className="text-xs text-muted-foreground">Price unavailable</p>
                      ) : equivalent !== null ? (
                        <p className="text-xs text-muted-foreground">{equivalent}</p>
                      ) : (
                        <p className="text-xs text-muted-foreground">Enter a valid USD amount</p>
                      )}
                    </div>
                    <Button
                      type="button"
                      disabled={busy !== null || parsed === null || priceUsd === null}
                      aria-label={`Save ${token.symbol}`}
                      onClick={() => {
                        if (parsed === null || priceUsd === null) {
                          setError(`Enter a valid USD value for ${token.symbol}.`)
                          setMessage(null)

                          return
                        }

                        void run(saveKey, async () => {
                          const nextAssets: IRemoteAssets = {
                            ...assets,
                            updatedAt: new Date().toISOString(),
                            tokens: assets.tokens.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, balance: parsed.toString() } : item,
                            ),
                          }
                          const next = await client.updateUser(user.id, { assets: nextAssets })
                          setAssets(next.assets)
                          setDraftUsdAmounts((current) =>
                            next.assets.tokens.map((item, itemIndex) =>
                              itemIndex === index
                                ? usdInputFromStoredBalance(
                                    item.balance,
                                    item.decimals,
                                    priceUsd,
                                  )
                                : (current[itemIndex] ??
                                  usdInputFromStoredBalance(
                                    item.balance,
                                    item.decimals,
                                    priceUsd,
                                  )),
                            ),
                          )

                          return next
                        })
                      }}
                    >
                      <Save />
                      {busy === saveKey ? 'Saving…' : 'Save'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="justify-start sm:col-span-2"
                      disabled={busy !== null}
                      onClick={() => {
                        void run(removeKey, async () => {
                          const nextAssets: IRemoteAssets = {
                            ...assets,
                            updatedAt: new Date().toISOString(),
                            tokens: assets.tokens.filter((_, itemIndex) => itemIndex !== index),
                          }
                          const next = await client.updateUser(user.id, { assets: nextAssets })
                          setAssets(next.assets)
                          setDraftUsdAmounts((current) =>
                            current.filter((_, itemIndex) => itemIndex !== index),
                          )

                          return next
                        })
                      }}
                    >
                      <Trash2 />
                      Remove {token.symbol}
                    </Button>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {tab === PROFILE_TAB.Account ? (
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
      ) : null}

      {tab === PROFILE_TAB.Wallets ? (
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
                        setWallets((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        )
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
                    wallets: wallets.map((entry) => ({
                      key: entry.key,
                      value: entry.value.trim(),
                    })),
                  }),
                )
              }}
            >
              {busy === 'wallets' ? 'Saving…' : 'Save wallets'}
            </Button>
          </CardContent>
        </Card>
      ) : null}

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

function withDraftUsdBalances(
  tokens: readonly IRemoteAssetToken[],
  drafts: readonly string[],
  quotes: PriceMap,
): IRemoteAssetToken[] {
  return tokens.map((token, index) => {
    const priceUsd = quotePriceUsd(token, quotes)
    const parsed =
      priceUsd === null
        ? null
        : tryParseUsdToMinimalUnits(drafts[index] ?? '', priceUsd, token.decimals)

    if (parsed === null) {
      return token
    }

    return { ...token, balance: parsed.toString() }
  })
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
