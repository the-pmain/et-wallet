import {
  ChevronRight,
  Info,
  Lock,
  Monitor,
  Moon,
  Plug,
  ShieldAlert,
  ShieldCheck,
  Sun,
} from 'lucide-react'
import { useEffect, useId, useState, type ComponentType } from 'react'
import { Link } from 'react-router'

import { APP_CONFIG } from '@/shared/config'
import { HardwareAccountForm } from '@/features/hardware'
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
  SegmentedControl,
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
        {/* Заголовка карточки нет намеренно: подпись переключателя уже
            называет раздел, а два заголовка подряд — «Appearance» над
            «Appearance» — читаются как сбой вёрстки. */}
        <CardContent>
          {/* Тот же переключатель, что у отбора истории и скорости
              отправки. Свой набор кнопок здесь отличался высотой и
              видом выбранного — три места, расходившиеся в мелочах. */}
          <SegmentedControl
            legend="Appearance"
            options={THEME_OPTIONS}
            value={theme}
            onChange={setTheme}
          />
        </CardContent>
      </Card>

      {/*
        ЧЕТЫРЕ ПЕРЕХОДА ОДНИМ СПИСКОМ, А НЕ ЧЕТЫРЬМЯ КАРТОЧКАМИ.

        Прежде каждый занимал отдельную карточку из заголовка, кнопки
        во всю ширину и абзаца — четыре одинаковых блока подряд, ради
        четырёх ссылок. Экран настроек из-за этого прокручивался вчетверо
        дольше нужного, а одинаковость блоков мешала различать разделы:
        глаз читал ритм, а не содержание.

        Строка вместо кнопки — потому что это переход, а не действие.
        Шеврон справа обещает именно переход, и вся строка целиком
        служит целью нажатия: попасть в неё проще, чем в кнопку.

        Пояснения сохранены дословно. Они не украшение: одобрение,
        не имеющее срока, и фраза на бумаге как единственный способ
        восстановления — то, чего пользователь может не знать, а узнать
        обязан до, а не после.
      */}
      <Card className="py-2">
        <CardContent className="flex flex-col divide-y divide-border/70 px-0 sm:px-0">
          {/* Раздел не попал в нижнюю панель: пять пунктов — предел
              для окна шириной 360 пикселей, и шестой сделал бы подписи
              нечитаемыми. */}
          <SettingsNavRow
            to="/wallet/connections"
            icon={Plug}
            title="Applications and sessions"
            description="A connected application may send signing requests. Each one is asked separately, but the connection itself is worth closing when it is no longer needed."
          />

          <SettingsNavRow
            to="/trust"
            icon={ShieldAlert}
            title="What you are trusting"
            description="The wallet runs as a web page: its code is downloaded from a server every time you open it. What that means, and what it does not protect against, is spelled out there."
          />

          <SettingsNavRow
            to="/wallet/approvals"
            icon={ShieldAlert}
            title="Granted approvals"
            description="An approval lets a contract take your tokens without a new signature, and it does not expire. A forgotten approval is the most common way to lose funds with an intact key."
          />

          <SettingsNavRow
            to="/wallet/backup"
            icon={ShieldCheck}
            title="Seed phrase and private keys"
            description="A seed phrase written on paper is the only way to restore the wallet after losing the device or clearing the browser data."
          />
        </CardContent>
      </Card>

      {/* Предупреждение о ненадёжном хранилище стоит сразу под списком,
          а не внутри строки: оно о состоянии устройства, а не о разделе,
          и внутри строки-перехода читалось бы как её описание. */}
      <StorageDurabilityAlert durability={storageDurability} />

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

      {/* Аппаратный кошелёк идёт после списка аккаунтов: это способ
          добавить ещё один, а не отдельный раздел настроек. */}
      <HardwareAccountForm />

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
        <div className="flex flex-col gap-2">
          {/* Четвёртое место, где стоял свой набор кнопок. Здесь он был
              ещё и ниже прочих — 34 пикселя при пределе прицеливания
              пальцем в 44. */}
          <SegmentedControl
            legend="Lock after inactivity"
            options={AUTO_LOCK_OPTIONS.map((value) => ({
              value,
              label: AUTO_LOCK_LABEL[value] ?? `${String(Math.round(value / 60_000))} min`,
            }))}
            value={settings.autoLockTimeoutMs}
            onChange={(value) => {
              void setAutoLockTimeout(value)
            }}
          />

          <p className="text-xs text-muted-foreground">
            An unlocked wallet keeps the keys in memory: until it locks, anyone with access to the
            device can dispose of the funds.
          </p>
        </div>

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

interface SettingsNavRowProps {
  readonly to: string
  readonly icon: ComponentType<{ className?: string }>
  readonly title: string

  /**
   * Зачем этот раздел нужен.
   *
   * Обязательное поле. Название раздела отвечает на вопрос «куда я
   * попаду», но не на вопрос «зачем мне туда». В настройках кошелька
   * второй вопрос важнее: разделы вроде одобрений открывают редко
   * и ровно потому, что не знают, чем они грозят.
   */
  readonly description: string
}

/**
 * Строка-переход в списке настроек.
 *
 * ССЫЛКА, А НЕ КНОПКА. Переход, оформленный кнопкой, теряет средний
 * щелчок, «открыть в новой вкладке» и объявление «ссылка» в программе
 * чтения с экрана.
 *
 * ЦЕЛЬ НАЖАТИЯ — ВСЯ СТРОКА. Попасть в неё проще, чем в кнопку внутри
 * блока, и это единственная цель: вложенных органов управления здесь
 * нет, поэтому неоднозначности «куда я нажал» не возникает.
 *
 * ОПИСАНИЕ ВХОДИТ В ДОСТУПНОЕ ИМЯ ССЫЛКИ. Это намеренно: тот, кто
 * слушает страницу, получает ровно то же, что видит зрячий, — название
 * и причину, по которой сюда стоит зайти.
 */
function SettingsNavRow({ to, icon: Icon, title, description }: SettingsNavRowProps) {
  return (
    <Link
      to={to}
      className="flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:px-6"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary-emphasis">
        <Icon className="size-4.5" />
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs leading-relaxed text-muted-foreground">{description}</span>
      </span>

      <ChevronRight className="mt-2 size-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  )
}
