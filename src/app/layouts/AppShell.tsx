import { ChevronDown, Lock } from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router'

import { useOnboarding } from '@/features/onboarding'
import { AutoLockWarning, useSecurity } from '@/features/security'
import { AccountAvatar, SESSION_STATE, addressLabel, useWalletSnapshot } from '@/features/wallet'
import { useTranslation } from '@/shared/i18n'
import { cn } from '@/shared/lib/utils'
import { Badge, Button, Toaster } from '@/shared/ui'

import { AmbientBackground } from './AmbientBackground'
import { NAVIGATION } from './navigation'

/**
 * Оболочка разблокированного кошелька.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ МАРШРУТ-ЛЕЙАУТ, А НЕ ОБЁРТКА В КАЖДОЙ СТРАНИЦЕ.
 * Пять экранов делят шапку и навигацию; повторение их в каждой странице
 * означало бы пять мест, где панель может разойтись, и перерисовку
 * шапки при каждом переходе. Вложенный маршрут с `Outlet` сохраняет
 * общие части смонтированными.
 *
 * Экраны онбординга оболочки не имеют намеренно: до разблокировки
 * переходить некуда, а панель навигации на экране ввода пароля создала бы
 * впечатление, что часть кошелька доступна без него.
 */
export function AppShell() {
  const snapshot = useWalletSnapshot()
  const onboarding = useOnboarding()
  const location = useLocation()
  const { t } = useTranslation()
  const { autoLock } = useSecurity()

  return (
    <div className="relative flex min-h-svh flex-col bg-background">
      {/* Фон закреплён по окну просмотра и лежит под всем содержимым:
          шапка и панель навигации размывают его собственным фильтром,
          а карточки непрозрачны — текст читается на них, а не на нём. */}
      <AmbientBackground />

      {/* Область уведомлений: смонтирована один раз на всю оболочку. */}
      <Toaster />

      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3">
          {snapshot.activeAccount === null ? null : (
            <>
              <AccountAvatar address={snapshot.activeAccount.address} />

              <div className="flex min-w-0 flex-col">
                <span className="flex items-center gap-1 truncate text-sm font-semibold">
                  {snapshot.activeAccount.name}
                  <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
                </span>
                {/* Имя ENS вместо адреса, когда оно подтверждено сверкой.
                    Моноширинный шрифт снимается: он существует ради
                    посимвольного сличения адреса, а имя сличают целиком. */}
                <span
                  className={cn(
                    'truncate text-xs text-muted-foreground',
                    !snapshot.ensNames.has(snapshot.activeAccount.address.toLowerCase()) &&
                      'font-mono',
                  )}
                >
                  {addressLabel(snapshot.activeAccount.address, snapshot.ensNames)}
                </span>
              </div>
            </>
          )}

          <div className="ml-auto flex items-center gap-2">
            {snapshot.activeNetwork === null ? null : (
              <Badge variant={snapshot.activeNetwork.isTestnet ? 'warning' : 'default'}>
                {snapshot.activeNetwork.name}
              </Badge>
            )}

            <Button
              variant="ghost"
              size="icon"
              aria-label="Lock the wallet"
              onClick={() => {
                onboarding.lock()
              }}
            >
              <Lock className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      </header>

      {/*
        Ключ по адресу перезапускает анимацию появления при каждом переходе.
        Без него React переиспользует узел и переход выглядит рывком.
      */}
      {/* Предупреждение стоит над содержимым и вне ключа маршрута:
          переход между экранами не должен его сбрасывать — до блокировки
          осталось столько же, сколько было. */}
      <div className="relative z-10 mx-auto w-full max-w-3xl px-4 pt-2">
        <AutoLockWarning
          isVisible={autoLock.isWarning}
          remainingMs={autoLock.remainingMs}
          onExtend={autoLock.extend}
        />
      </div>

      {/* `relative z-10` обязателен: фон позиционирован, и без явного
          слоя непозиционированное содержимое ушло бы под него. */}
      <main
        key={location.pathname}
        className="relative z-10 mx-auto w-full max-w-3xl flex-1 animate-in px-4 pt-4 pb-24 duration-300 fade-in slide-in-from-bottom-2"
      >
        {snapshot.state === SESSION_STATE.Open ? <Outlet /> : <ShellPlaceholder />}
      </main>

      <nav
        aria-label="Wallet sections"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border/60 bg-background/90 backdrop-blur-md"
      >
        <div className="mx-auto flex w-full max-w-3xl items-stretch justify-around px-2 pb-[env(safe-area-inset-bottom)]">
          {NAVIGATION.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === NAVIGATION[0]?.to}
              className={({ isActive }) =>
                cn(
                  'flex flex-1 flex-col items-center gap-1 rounded-lg px-1 py-2.5 text-[11px] font-medium transition-colors',
                  isActive
                    ? 'text-primary-emphasis'
                    : 'text-muted-foreground hover:text-foreground focus-visible:text-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      'flex size-8 items-center justify-center rounded-lg transition-colors',
                      isActive ? 'bg-primary/12' : 'bg-transparent',
                    )}
                  >
                    <item.icon className="size-4.5" />
                  </span>
                  {t(item.labelKey)}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}

/**
 * Заглушка на время открытия сессии.
 *
 * Показывается внутри оболочки, а не вместо неё: навигация и шапка,
 * исчезающие на секунду при каждом входе, читаются как сбой.
 */
function ShellPlaceholder() {
  return (
    <div className="flex min-h-[50svh] items-center justify-center text-sm text-muted-foreground">
      Opening the wallet…
    </div>
  )
}
