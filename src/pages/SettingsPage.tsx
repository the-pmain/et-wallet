import { Info, Lock, Monitor, Moon, Plug, ShieldAlert, ShieldCheck, Sun } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router'

import { APP_CONFIG } from '@/shared/config'
import { useOnboarding } from '@/features/onboarding'
import { AUTO_LOCK_OPTIONS, StorageDurabilityAlert, useSecurity } from '@/features/security'
import {
  AccountList,
  AddNetworkForm,
  NetworkList,
  RpcSettings,
  useWallet,
  useWalletSnapshot,
  type IAccountDiscoverySummary,
} from '@/features/wallet'
import { cn } from '@/shared/lib/utils'
import { useTheme, type Theme } from '@/shared/theme'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Label,
} from '@/shared/ui'

import type { AccountId, ChainId } from '@/core'

/** Доступные режимы оформления. */
const THEME_OPTIONS: readonly { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

/**
 * Настройки кошелька.
 *
 * СОБРАНЫ ВМЕСТЕ УПРАВЛЕНИЕ АККАУНТАМИ, СЕТЯМИ И УЗЛАМИ. На главном
 * экране им не место: он отвечает на вопрос «сколько у меня и что
 * происходит», а перечисленное меняет устройство кошелька и требует
 * осознанного захода в настройки.
 */
export function SettingsPage() {
  const session = useWallet()
  const snapshot = useWalletSnapshot()
  const onboarding = useOnboarding()
  const { storageDurability } = useSecurity()
  const { theme, setTheme } = useTheme()

  /* Имя читается из зашифрованного хранилища, то есть асинхронно.
     Отдельного поля в снимке кошелька ему не заведено: оно относится
     к онбордингу, а не к состоянию сессии, и меняться во время работы
     не может. */
  const [username, setUsername] = useState<string | null>(null)

  /* Итог поиска аккаунтов. `null` — поиск не запускали в этот заход. */
  const [discovery, setDiscovery] = useState<IAccountDiscoverySummary | null>(null)
  const [isDiscovering, setDiscovering] = useState(false)

  useEffect(() => {
    let isCurrent = true

    void onboarding.getUsername().then((value) => {
      if (isCurrent) {
        setUsername(value)
      }
    })

    return () => {
      isCurrent = false
    }
  }, [onboarding])

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-lg font-semibold">Settings</h1>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium text-muted-foreground">Your name</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {/* Имя показывается ровно там, где владелец его ищет, — рядом
              с остальными сведениями о кошельке. Оно же подписывает
              первый аккаунт, поэтому строка отвечает на вопрос «почему
              мой аккаунт называется так». */}
          <p className="text-sm">
            {username === null ? (
              <span className="text-muted-foreground">
                Not set — accounts are called "Account 1", "Account 2" and so on.
              </span>
            ) : (
              <span className="font-medium">{username}</span>
            )}
          </p>

          <p className="text-xs text-muted-foreground">
            Stored on this device only and never sent anywhere. It is not an account: access cannot
            be restored by name — only the seed phrase does that.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium text-muted-foreground">Appearance</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-2">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={theme === option.value}
              onClick={() => {
                setTheme(option.value)
              }}
              className={cn(
                'flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-medium transition-colors',
                theme === option.value
                  ? 'border-primary bg-primary/10 text-primary-emphasis'
                  : 'border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <option.icon className="size-4" aria-hidden />
              {option.label}
            </button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium text-muted-foreground">Connections</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {/* Раздел не попал в нижнюю панель: пять пунктов — предел
              для окна шириной 360 пикселей, и шестой сделал бы подписи
              нечитаемыми. */}
          <Button asChild variant="outline" className="w-full">
            <Link to="/wallet/connections">
              <Plug className="size-4" aria-hidden />
              Applications and sessions
            </Link>
          </Button>

          <p className="text-xs text-muted-foreground">
            A connected application may send signing requests. Each one is asked separately, but the
            connection itself is worth closing when it is no longer needed.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium text-muted-foreground">Trust</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button asChild variant="outline" className="w-full">
            <Link to="/trust">
              <ShieldAlert className="size-4" aria-hidden />
              What you are trusting
            </Link>
          </Button>

          <p className="text-xs text-muted-foreground">
            The wallet runs as a web page: its code is downloaded from a server every time you open
            it. What that means, and what it does not protect against, is spelled out there.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium text-muted-foreground">Approvals</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button asChild variant="outline" className="w-full">
            <Link to="/wallet/approvals">
              <ShieldAlert className="size-4" aria-hidden />
              Granted approvals
            </Link>
          </Button>

          <p className="text-xs text-muted-foreground">
            An approval lets a contract take your tokens without a new signature, and it does not
            expire. A forgotten approval is the most common way to lose funds with an intact key.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium text-muted-foreground">Backup</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button asChild variant="outline" className="w-full">
            <Link to="/wallet/backup">
              <ShieldCheck className="size-4" aria-hidden />
              Seed phrase and private keys
            </Link>
          </Button>

          <p className="text-xs text-muted-foreground">
            A seed phrase written on paper is the only way to restore the wallet after losing the
            device or clearing the browser data.
          </p>

          <StorageDurabilityAlert durability={storageDurability} />
        </CardContent>
      </Card>

      <SecuritySection />

      <AccountList
        accounts={snapshot.accounts}
        activeAccount={snapshot.activeAccount}
        ensNames={snapshot.ensNames}
        isBusy={false}
        isDiscovering={isDiscovering}
        onSelect={(id: AccountId) => {
          void session.selectAccount(id)
        }}
        onCreate={() => {
          void session.createAccount()
        }}
        onDiscover={() => {
          setDiscovering(true)
          setDiscovery(null)

          void session.discoverAccounts().then(
            (summary) => {
              setDiscovering(false)
              setDiscovery(summary)
            },
            () => {
              setDiscovering(false)
              setDiscovery(null)
            },
          )
        }}
      />

      {discovery === null ? null : (
        <Alert variant={discovery.added > 0 ? 'default' : undefined}>
          <AlertDescription>
            {discovery.added > 0
              ? `Found and added ${String(discovery.added)} account${discovery.added === 1 ? '' : 's'} that had been used before.`
              : 'No previously used addresses were found beyond the accounts you already have.'}{' '}
            {/* ГЛУБИНА НАЗЫВАЕТСЯ ВСЕГДА. «Ничего не найдено» без неё
                читается как «у вас больше ничего нет» — утверждение,
                которого поиск не делает: он смотрит ограниченное число
                адресов и не видит те, где лежат только токены. */}
            {String(discovery.scanned)} addresses were checked
            {discovery.stoppedByLimit
              ? ', and the search stopped at the limit — there may be more'
              : ''}
            . Addresses holding only tokens or collectibles are not found this way.
          </AlertDescription>
        </Alert>
      )}

      <NetworkList
        networks={snapshot.networks}
        activeNetwork={snapshot.activeNetwork}
        isBusy={false}
        onSwitch={(chainId: ChainId) => {
          void session.switchNetwork(chainId)
        }}
        onRemove={(chainId: ChainId) => {
          void session.removeNetwork(chainId)
        }}
        /* Форма получает обработчик, возвращающий обещание: ей нужно
           дождаться проверки узла и показать причину отказа, а не
           отправить запрос и забыть о нём. */
        addForm={<AddNetworkForm onAdd={(params) => session.addNetwork(params)} />}
      />

      <RpcSettings
        endpoints={snapshot.rpcEndpoints}
        activeEndpoint={snapshot.activeRpcEndpoint}
        onCheckHealth={() => session.checkRpcHealth()}
        onAdd={(url: string) => session.addRpcEndpoint(url)}
        onRemove={(url: string) => session.removeRpcEndpoint(url)}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium text-muted-foreground">Locking</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              onboarding.lock()
            }}
          >
            <Lock className="size-4" aria-hidden />
            Lock the wallet
          </Button>
        </CardContent>
      </Card>

      <Alert>
        <Info />
        <AlertDescription>Version {APP_CONFIG.version}.</AlertDescription>
      </Alert>
    </div>
  )
}

/** Подписи сроков автоблокировки. Ключ — значение в миллисекундах. */
const AUTO_LOCK_LABEL: Readonly<Record<number, string>> = {
  60_000: '1 min',
  300_000: '5 min',
  900_000: '15 min',
  1_800_000: '30 min',
  3_600_000: '60 min',
}

/**
 * Настройки модуля безопасности.
 *
 * СРОК ВЫБИРАЕТСЯ ИЗ СПИСКА, А НЕ ВВОДИТСЯ. Поле ввода позволило бы
 * назначить сутки и превратить защиту в её видимость.
 *
 * ПОДТВЕРЖДЕНИЕ ПОДПИСИ ВЫКЛЮЧАЕТСЯ, НО ПОСЛЕДСТВИЕ НАЗВАНО. Это выбор
 * владельца средств, и он вправе его сделать — но не вслепую.
 */
function SecuritySection() {
  const { settings, setAutoLockTimeout, setConfirmBeforeSigning } = useSecurity()
  const confirmId = useId()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium text-muted-foreground">Security</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Lock after inactivity</legend>

          <div className="grid grid-cols-5 gap-2">
            {AUTO_LOCK_OPTIONS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={settings.autoLockTimeoutMs === value}
                onClick={() => {
                  void setAutoLockTimeout(value)
                }}
                className={cn(
                  'rounded-xl border px-1 py-2 text-xs font-medium transition-colors',
                  settings.autoLockTimeoutMs === value
                    ? 'border-primary bg-primary/10 text-primary-emphasis'
                    : 'border-border text-muted-foreground hover:bg-accent',
                )}
              >
                {AUTO_LOCK_LABEL[value] ?? `${String(Math.round(value / 60_000))} min`}
              </button>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            An unlocked wallet keeps the keys in memory: until it locks, anyone with access to the
            device can dispose of the funds.
          </p>
        </fieldset>

        <div className="flex flex-col gap-2 border-t pt-4">
          <Label htmlFor={confirmId} className="items-start gap-3">
            <Checkbox
              id={confirmId}
              checked={settings.confirmBeforeSigning}
              onChange={(event) => {
                void setConfirmBeforeSigning(event.target.checked)
              }}
            />
            <span className="text-sm leading-snug font-normal">
              Ask for the password before signing a transaction
            </span>
          </Label>

          <p className="text-xs text-muted-foreground">
            Turning this off speeds up sending and removes the only barrier in front of whoever gets
            access to an already unlocked wallet.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
