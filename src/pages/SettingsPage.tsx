import { Info, Lock, Monitor, Moon, Plug, ShieldCheck, Sun } from 'lucide-react'
import { useId } from 'react'
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
  { value: 'light', label: 'Светлая', icon: Sun },
  { value: 'dark', label: 'Тёмная', icon: Moon },
  { value: 'system', label: 'Системная', icon: Monitor },
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

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-lg font-semibold">Настройки</h1>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium text-muted-foreground">Оформление</CardTitle>
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
          <CardTitle className="text-base font-medium text-muted-foreground">Подключения</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {/* Раздел не попал в нижнюю панель: пять пунктов — предел
              для окна шириной 360 пикселей, и шестой сделал бы подписи
              нечитаемыми. */}
          <Button asChild variant="outline" className="w-full">
            <Link to="/wallet/connections">
              <Plug className="size-4" aria-hidden />
              Приложения и сессии
            </Link>
          </Button>

          <p className="text-xs text-muted-foreground">
            Подключённое приложение может присылать запросы на подпись. Каждый спрашивается
            отдельно, но само подключение стоит закрывать, когда оно больше не нужно.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium text-muted-foreground">
            Резервная копия
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button asChild variant="outline" className="w-full">
            <Link to="/wallet/backup">
              <ShieldCheck className="size-4" aria-hidden />
              Seed-фраза и приватные ключи
            </Link>
          </Button>

          <p className="text-xs text-muted-foreground">
            Записанная на бумаге seed-фраза — единственный способ восстановить кошелёк при потере
            устройства или очистке данных браузера.
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
        onSelect={(id: AccountId) => {
          void session.selectAccount(id)
        }}
        onCreate={() => {
          void session.createAccount()
        }}
      />

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
          <CardTitle className="text-base font-medium text-muted-foreground">Блокировка</CardTitle>
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
            Заблокировать кошелёк
          </Button>
        </CardContent>
      </Card>

      <Alert>
        <Info />
        <AlertDescription>Версия {APP_CONFIG.version}.</AlertDescription>
      </Alert>
    </div>
  )
}

/** Подписи сроков автоблокировки. Ключ — значение в миллисекундах. */
const AUTO_LOCK_LABEL: Readonly<Record<number, string>> = {
  60_000: '1 мин',
  300_000: '5 мин',
  900_000: '15 мин',
  1_800_000: '30 мин',
  3_600_000: '60 мин',
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
        <CardTitle className="text-base font-medium text-muted-foreground">Безопасность</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Блокировать после бездействия</legend>

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
                {AUTO_LOCK_LABEL[value] ?? `${String(Math.round(value / 60_000))} мин`}
              </button>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            Разблокированный кошелёк держит ключи в памяти: до блокировки распоряжаться средствами
            может любой, кто получил доступ к устройству.
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
              Спрашивать пароль перед подписью транзакции
            </span>
          </Label>

          <p className="text-xs text-muted-foreground">
            Отключение ускоряет отправку и снимает единственную преграду перед тем, кто получил
            доступ к уже разблокированному кошельку.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
