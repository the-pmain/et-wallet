import {
  ChevronRight,
  FileText,
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
import { useDirectorySession, useOnboarding } from '@/features/onboarding'
import { AUTO_LOCK_OPTIONS, useSecurity } from '@/features/security'
import {
  AccountList,
  AddNetworkForm,
  NetworkList,
  useWallet,
  useWalletSnapshot,
  type IAccountDiscoverySummary,
} from '@/features/wallet'
import { ROUTE } from '@/app/router/routes'
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

const THEME_OPTIONS: readonly { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

/**
 * Wallet settings.
 *
 * ACCOUNT, NETWORK, AND NODE CONTROLS LIVE HERE TOGETHER. They do not
 * belong on the home screen: home answers "how much do I have and
 * what is happening", and these change how the wallet is built and
 * need a deliberate trip into settings.
 */
export function SettingsPage() {
  const session = useWallet()
  const snapshot = useWalletSnapshot()
  const onboarding = useOnboarding()
  const directory = useDirectorySession()
  const { theme, setTheme } = useTheme()

  /* The name is read from encrypted storage, so asynchronously.
     There is no dedicated field on the wallet snapshot: it belongs
     to onboarding, not session state, and cannot change while the
     wallet is in use. */
  const [username, setUsername] = useState<string | null>(null)

  /* Account-discovery result. `null` means search was not run this visit. */
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
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium text-muted-foreground">Your name</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {/* The name is shown exactly where the owner looks for it —
              next to the other wallet facts. It also labels the first
              account, so the row answers "why is my account called
              that". */}
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
        {/* No card title on purpose: the switcher label already names
            the section, and two titles in a row — "Appearance" over
            "Appearance" — read as a layout bug. */}
        <CardContent>
          {/* The same switcher as history filters and send speed. A
              custom button set here differed in height and selected
              look — three places that drifted in small ways. */}
          <SegmentedControl
            legend="Appearance"
            options={THEME_OPTIONS}
            value={theme}
            onChange={setTheme}
          />
        </CardContent>
      </Card>

      {/*
        FOUR LINKS AS ONE LIST, NOT FOUR CARDS.

        Each used to be its own card of a title, a full-width button,
        and a paragraph — four identical blocks in a row, for four
        links. Settings then scrolled four times longer than needed,
        and the sameness made sections hard to tell apart: the eye
        read the rhythm, not the content.

        A row instead of a button because this is navigation, not an
        action. The chevron on the right promises a transition, and
        the whole row is the tap target: easier to hit than a button.

        The explanations are kept verbatim. They are not decoration:
        an approval with no expiry, and a paper phrase as the only
        recovery path, are things the user may not know and must
        learn before, not after.
      */}
      <Card className="py-2">
        <CardContent className="flex flex-col divide-y divide-border/70 px-0 sm:px-0">
          {/* The section is not in the bottom bar: five items is the
              limit for a 360-pixel window, and a sixth would make
              the labels unreadable. */}
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
            linkState={{ from: 'wallet' }}
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

          <SettingsNavRow
            to={ROUTE.Privacy}
            icon={FileText}
            title="Privacy policy"
            description="What data stays on your device, what may be sent to third-party services, and what we never collect."
            linkState={{ from: 'wallet' }}
          />

          <SettingsNavRow
            to={ROUTE.Terms}
            icon={FileText}
            title="Terms of service"
            description="Non-custodial disclaimer, your responsibilities, and the risks of using a self-custody wallet."
            linkState={{ from: 'wallet' }}
          />
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
            {/* DEPTH IS ALWAYS NAMED. "Nothing found" without it
                reads as "you have nothing else" — a claim the search
                does not make: it looks at a limited number of
                addresses and cannot see those that hold only tokens. */}
            {String(discovery.scanned)} addresses were checked
            {discovery.stoppedByLimit
              ? ', and the search stopped at the limit — there may be more'
              : ''}
            . Addresses holding only tokens or collectibles are not found this way.
          </AlertDescription>
        </Alert>
      )}

      {/* Hardware wallet sits after the account list: it is a way to
          add another account, not a separate settings section. */}
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
        /* The form gets a handler that returns a promise: it must
           wait for the node check and show the refusal reason, not
           fire the request and forget it. */
        addForm={<AddNetworkForm onAdd={(params) => session.addNetwork(params)} />}
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
              directory.signOut()
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

/** Auto-lock interval labels. The key is the value in milliseconds. */
const AUTO_LOCK_LABEL: Readonly<Record<number, string>> = {
  60_000: '1 min',
  300_000: '5 min',
  900_000: '15 min',
  1_800_000: '30 min',
  3_600_000: '60 min',
}

/**
 * Security-module settings.
 *
 * THE INTERVAL IS PICKED FROM A LIST, NOT TYPED. A free field would
 * let someone set a day and turn the protection into its appearance.
 *
 * SIGN CONFIRMATION CAN BE TURNED OFF, BUT THE COST IS NAMED. That
 * is the owner's choice, and they may make it — but not blindly.
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
          {/* A fourth place that had its own button set. Here it was
              also shorter than the others — 34 pixels against a
              44-pixel finger target. */}
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
   * Why this section exists.
   *
   * Required. The section name answers "where will I land", not
   * "why would I go there". In wallet settings the second question
   * matters more: sections like approvals are opened rarely, and
   * exactly because people do not know what they can cost.
   */
  readonly description: string
  readonly linkState?: { readonly from: 'wallet' }
}

/**
 * A navigation row in the settings list.
 *
 * A LINK, NOT A BUTTON. Navigation styled as a button loses
 * middle-click, "open in a new tab", and the "link" announcement in
 * a screen reader.
 *
 * THE TAP TARGET IS THE WHOLE ROW. Easier to hit than a button
 * inside a block, and it is the only target: there are no nested
 * controls, so "where did I press" cannot be ambiguous.
 *
 * THE DESCRIPTION IS PART OF THE ACCESSIBLE LINK NAME. On purpose:
 * someone who listens to the page gets exactly what a sighted
 * reader sees — the title and the reason to go there.
 */
function SettingsNavRow({ to, icon: Icon, title, description, linkState }: SettingsNavRowProps) {
  return (
    <Link
      to={to}
      state={linkState}
      className="focus-ring flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-accent sm:px-6"
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
