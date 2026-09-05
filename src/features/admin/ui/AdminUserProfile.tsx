import { ArrowLeft, Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import type { PriceMap } from '@/core'

import { mapRemoteAssets } from '@/features/onboarding/lib/map-remote-assets'
import type {
  IRemoteAssetToken,
  IRemoteAssets,
  IRemoteUser,
  IUserWalletsMap,
  IWalletSlot,
} from '@/features/onboarding/model/RemoteUserDirectory'
import {
  WALLET_CODENAME_RECEIVING_FUNDS,
  WALLET_CODENAME_RECEIVING_FUNDS_EXCHANGE,
  INITIAL_WALLET_VALUE,
} from '@/features/onboarding/model/RemoteUserDirectory'
import { useRemoteAssetQuotes } from '@/features/onboarding/model/use-remote-asset-quotes'
import { TokenAvatar } from '@/features/wallet/ui/TokenAvatar'
import { cn } from '@/shared/lib/utils'
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
  PasswordInput,
  SegmentedControl,
  Select,
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

const ADMIN_WALLET_CODENAMES = [
  WALLET_CODENAME_RECEIVING_FUNDS,
  WALLET_CODENAME_RECEIVING_FUNDS_EXCHANGE,
] as const

interface IAdminWalletRow {
  readonly rowId: string
  readonly codename: string
  readonly key: string
  readonly value: string
}

function walletsToRows(wallets: IUserWalletsMap): IAdminWalletRow[] {
  return Object.entries(wallets).map(([codename, slot]) => ({
    rowId: codename,
    codename,
    key: slot.key,
    value: slot.value,
  }))
}

function rowsToWallets(rows: readonly IAdminWalletRow[]): IUserWalletsMap {
  const wallets: Record<string, IWalletSlot> = {}

  for (const row of rows) {
    if (row.codename.trim() === '' || row.key.trim() === '' || row.value.trim() === '') {
      continue
    }

    wallets[row.codename.trim()] = {
      key: row.key.trim(),
      value: row.value.trim(),
    }
  }

  return wallets
}

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
  const { client, lock, canWrite } = useAdminSession()
  const emailId = useId()
  const balanceId = useId()
  const passwordId = useId()
  const walletsFormId = useId()
  const [email, setEmail] = useState(user.email ?? '')
  const [balance, setBalance] = useState(user.balance ?? '')
  const [password, setPassword] = useState('')
  const [newCodename, setNewCodename] = useState('')
  const [newKey, setNewKey] = useState('')
  const [wallets, setWallets] = useState<IAdminWalletRow[]>(() => walletsToRows(user.wallets ?? {}))
  const availableCodenames = useMemo(
    () => ADMIN_WALLET_CODENAMES.filter((codename) => !wallets.some((entry) => entry.codename === codename)),
    [wallets],
  )

  useEffect(() => {
    if (availableCodenames.length === 0) {
      setNewCodename('')

      return
    }

    if (!availableCodenames.includes(newCodename as (typeof ADMIN_WALLET_CODENAMES)[number])) {
      setNewCodename(availableCodenames[0] ?? '')
    }
  }, [availableCodenames, newCodename])

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
                  {canWrite
                    ? 'Enter each holding in USD. The crypto equivalent updates live from CoinGecko prices. Each row saves on its own.'
                    : 'Holdings in USD. The crypto equivalent uses live CoinGecko prices.'}
                </p>
              </div>
              {canWrite ? (
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
              ) : null}
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
                        disabled={!canWrite || (priceUsd === null && !isQuotesLoading)}
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
                    {canWrite ? (
                    <>
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
                    </>
                    ) : null}
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
            <Field id={emailId} label="Email" value={email} disabled={!canWrite} onChange={setEmail} />
            <Field id={balanceId} label="Balance" value={balance} disabled={!canWrite} onChange={setBalance} />
            {canWrite ? (
              <PasswordField id={passwordId} label="New password (the_p)" value={password} onChange={setPassword} />
            ) : null}
            {canWrite ? (
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
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {tab === PROFILE_TAB.Wallets ? (
        <Card>
          <CardHeader>
            <CardTitle>Wallets</CardTitle>
            <p className="text-sm text-muted-foreground">
              {canWrite
                ? 'Each slot is keyed by a fixed codename. Edit the address only; codenames cannot be renamed.'
                : 'Each slot is keyed by a fixed codename.'}
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {wallets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No addresses yet.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {wallets.map((entry, index) => (
                  <WalletSlotRow
                    key={entry.rowId}
                    codename={entry.codename}
                    address={entry.key}
                    disabled={!canWrite || busy !== null}
                    canRemove={canWrite}
                    onAddressChange={(key) => {
                      setWallets((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, key } : item,
                        ),
                      )
                    }}
                    onRemove={() => {
                      setWallets((current) => current.filter((_, itemIndex) => itemIndex !== index))
                    }}
                  />
                ))}
              </ul>
            )}
            {canWrite && availableCodenames.length > 0 ? (
              <div className="flex flex-col gap-3 rounded-lg border border-dashed p-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <WalletAddressGroup
                    codename={newCodename}
                    address={newKey}
                    disabled={busy !== null}
                    addressPlaceholder="0x…"
                    onAddressChange={setNewKey}
                    codenameControl={
                      <Select
                        id={`${walletsFormId}-new-wallet-codename`}
                        value={newCodename}
                        disabled={busy !== null}
                        options={availableCodenames.map((codename) => ({
                          value: codename,
                          label: codename,
                        }))}
                        onChange={setNewCodename}
                      />
                    }
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    busy !== null || newCodename.trim() === '' || !ADDRESS_SHAPE.test(newKey.trim())
                  }
                  onClick={() => {
                    const codename = newCodename.trim()
                    const key = newKey.trim()
                    setWallets((current) => {
                      const without = current.filter((item) => item.codename !== codename)

                      return [
                        ...without,
                        {
                          rowId: codename,
                          codename,
                          key,
                          value: INITIAL_WALLET_VALUE,
                        },
                      ]
                    })
                    setNewKey('')
                  }}
                >
                  <Plus />
                  Add
                </Button>
              </div>
            ) : canWrite && wallets.length > 0 ? (
              <p className="text-sm text-muted-foreground">All standard wallet slots are already assigned.</p>
            ) : null}
            {canWrite ? (
            <Button
              type="button"
              disabled={
                busy !== null ||
                wallets.some((entry) => entry.codename.trim() === '' || entry.key.trim() === '')
              }
              onClick={() => {
                void run('wallets', () =>
                  client.updateUser(user.id, {
                    wallets: rowsToWallets(wallets),
                  }),
                )
              }}
            >
              {busy === 'wallets' ? 'Saving…' : 'Save wallets'}
            </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {canWrite ? (
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
      ) : null}
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

function isExchangeWalletCodename(codename: string): boolean {
  return codename === WALLET_CODENAME_RECEIVING_FUNDS_EXCHANGE
}

function WalletSlotRow({
  codename,
  address,
  disabled,
  canRemove = true,
  onAddressChange,
  onRemove,
}: {
  readonly codename: string
  readonly address: string
  readonly disabled: boolean
  readonly canRemove?: boolean
  readonly onAddressChange: (address: string) => void
  readonly onRemove: () => void
}) {
  const highlighted = isExchangeWalletCodename(codename)

  return (
    <li
      className={cn(
        'flex gap-3 rounded-lg border p-3 sm:items-center',
        highlighted && 'border-primary/50 bg-primary/5',
      )}
    >
      <div className="min-w-0 flex-1">
        <WalletAddressGroup
          codename={codename}
          address={address}
          disabled={disabled}
          onAddressChange={onAddressChange}
        />
      </div>
      {canRemove ? (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled}
        className="shrink-0"
        aria-label={`Remove ${codename}`}
        onClick={onRemove}
      >
        <Trash2 />
      </Button>
      ) : null}
    </li>
  )
}

function WalletAddressGroup({
  codename,
  address,
  disabled,
  addressPlaceholder,
  onAddressChange,
  codenameControl,
}: {
  readonly codename: string
  readonly address: string
  readonly disabled: boolean
  readonly addressPlaceholder?: string
  readonly onAddressChange: (address: string) => void
  readonly codenameControl?: ReactNode
}) {
  const addressId = useId()
  const highlighted = isExchangeWalletCodename(codename)

  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border shadow-xs focus-within:ring-2 focus-within:ring-ring/40',
        highlighted && 'border-primary/60 focus-within:ring-primary/30',
      )}
    >
      <div
        className={cn(
          'border-b bg-muted/40 px-3 py-2',
          highlighted && 'border-primary/25 bg-primary/10',
        )}
      >
        {codenameControl ?? (
          <p
            className={cn(
              'font-mono text-xs leading-snug break-all text-foreground/85',
              highlighted && 'font-medium text-primary-emphasis',
            )}
          >
            {codename}
          </p>
        )}
      </div>
      <Input
        id={addressId}
        value={address}
        disabled={disabled}
        placeholder={addressPlaceholder}
        aria-label={`Address for ${codename}`}
        className="rounded-none border-0 font-mono text-sm shadow-none focus-visible:ring-0"
        onChange={(event) => {
          onAddressChange(event.target.value)
        }}
      />
    </div>
  )
}

function Field({
  id,
  label,
  value,
  disabled = false,
  onChange,
}: {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly disabled?: boolean
  readonly onChange: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        disabled={disabled}
        autoComplete="off"
        onChange={(event) => {
          onChange(event.target.value)
        }}
      />
    </div>
  )
}

function PasswordField({
  id,
  label,
  value,
  onChange,
}: {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <PasswordInput
        id={id}
        value={value}
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
