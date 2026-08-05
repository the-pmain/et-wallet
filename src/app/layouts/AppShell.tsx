import { ChevronDown, Lock } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'

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

  /*
    ПЕРЕХОД МЕЖДУ ЭКРАНАМИ ПЕРЕВОДИТ ФОКУС В СОДЕРЖИМОЕ.

    Без этого переход был не виден тому, кто страницу слушает: нажатие
    пункта панели подменяло содержимое, фокус оставался на ссылке, и
    ничего не объявлялось. Человек не узнавал, что попал на другой
    экран, — переход существовал только для зрячих.

    Фокус на область содержимого, а не на заголовок: заголовок есть
    не у всех экранов, а область есть всегда, и программа чтения
    начинает читать её сверху — то есть с названия экрана, если оно
    там есть.

    ПЕРВЫЙ ПОКАЗ ПРОПУСКАЕТСЯ. Отнимать фокус при открытии приложения
    незачем: человек ещё никуда не переходил, а перехваченный фокус
    сбил бы того, кто уже начал обход клавишей.

    СРАВНИВАЕТСЯ ПРЕЖНИЙ АДРЕС, А НЕ СЧИТАЮТСЯ ПОКАЗЫ. Первая редакция
    держала признак «это первый показ» и снимала его в эффекте. В режиме
    `StrictMode` React вызывает эффект дважды: первый вызов снимал
    признак, второй забирал фокус — и приложение отнимало его ровно там,
    где не должно. Измерено живьём. Сравнение адресов от числа вызовов
    не зависит: пока адрес прежний, фокус не трогается, сколько бы раз
    эффект ни выполнился.
  */
  const contentRef = useRef<HTMLElement>(null)
  const previousPath = useRef<string | null>(null)

  useEffect(() => {
    const previous = previousPath.current
    previousPath.current = location.pathname

    if (previous === null || previous === location.pathname) {
      return
    }

    /* Без прокрутки: экран и так показан сверху, а браузер иначе
       дёрнул бы его к области, которую только что отрисовали. */
    contentRef.current?.focus({ preventScroll: true })
  }, [location.pathname])

  return (
    <div className="relative flex min-h-svh flex-col bg-background">
      {/* Фон закреплён по окну просмотра и лежит под всем содержимым:
          шапка и панель навигации размывают его собственным фильтром,
          а карточки непрозрачны — текст читается на них, а не на нём. */}
      <AmbientBackground />

      {/* Область уведомлений: смонтирована один раз на всю оболочку. */}
      <Toaster />

      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3 lg:ml-60">
          {snapshot.activeAccount === null ? null : (
            /* ПЕРЕКЛЮЧАТЕЛЬ ВЫГЛЯДИТ НАЖИМАЕМЫМ. Прежде здесь стояли
               значок со стрелкой и текст без фона и без отклика на
               наведение: стрелка обещала выбор, вид его не подтверждал.
               Ссылка ведёт в настройки, где аккаунты и переключаются. */
            <Link
              to="/wallet/settings"
              className="-ml-1.5 flex min-w-0 items-center gap-2.5 rounded-full py-1 pr-3 pl-1.5 transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <AccountAvatar address={snapshot.activeAccount.address} />

              <div className="flex min-w-0 flex-col">
                <span className="flex items-center gap-1 truncate text-sm font-semibold">
                  {snapshot.activeAccount.name}
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
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
            </Link>
          )}

          <div className="ml-auto flex items-center gap-2">
            {snapshot.activeNetwork === null ? null : (
              /* Точка перед именем сети. Цвет несёт то же, что и вариант
                 значка, но виден раньше текста: боевая сеть или испытательная
                 — первое, что нужно знать, глядя на сумму. */
              <Badge
                variant={snapshot.activeNetwork.isTestnet ? 'warning' : 'default'}
                className="gap-1.5"
              >
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    snapshot.activeNetwork.isTestnet ? 'bg-risk-medium' : 'bg-risk-low',
                  )}
                  aria-hidden
                />
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
      <div className="relative z-10 mx-auto w-full max-w-3xl px-4 pt-2 lg:ml-60">
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
        ref={contentRef}
        /* Область получает фокус только программно, при переходе:
           клавишей в неё не попадают, и кольцо здесь было бы шумом
           на весь экран. */
        tabIndex={-1}
        className="relative z-10 mx-auto w-full max-w-3xl flex-1 animate-in px-4 pt-4 pb-24 duration-300 fade-in slide-in-from-bottom-2 focus:outline-none lg:ml-60 lg:pb-8"
      >
        {snapshot.state === SESSION_STATE.Open ? <Outlet /> : <ShellPlaceholder />}
      </main>

      {/*
        ОДНА ПАНЕЛЬ РАЗДЕЛОВ НА ОБЕ ШИРИНЫ, раскладка меняется классами.

        Две панели — по одной на ширину — означали бы два одноимённых
        ориентира в разметке: программа чтения с экрана объявила бы
        «навигация» дважды. Отрисовывать нужную по замеру ширины из кода
        тоже неверно: значение приходится держать в состоянии, и панель
        зависит от события, которое может не прийти. Классы ширины
        пересчитываются браузером всегда.

        Снизу на телефоне: там до панели дотягивается большой палец.
        Слева на широком экране: низ окна с мышью — самое далёкое от
        взгляда место, и приложение с нижней панелью читается как
        растянутое мобильное.
      */}
      <nav
        aria-label="Wallet sections"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border/60 bg-background/90 backdrop-blur-md lg:inset-y-0 lg:right-auto lg:left-0 lg:w-60 lg:border-t-0 lg:border-r lg:bg-background/80"
      >
        <div className="mx-auto flex w-full max-w-3xl items-stretch justify-around px-2 pb-[env(safe-area-inset-bottom)] lg:mx-0 lg:flex-col lg:items-stretch lg:justify-start lg:gap-1 lg:p-3 lg:pt-20">
          {NAVIGATION.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === NAVIGATION[0]?.to}
              className={({ isActive }) =>
                cn(
                  'flex flex-1 flex-col items-center gap-1 rounded-lg px-1 py-2.5 text-[11px] font-medium transition-colors',
                  /* На широком экране подпись встаёт рядом со значком:
                     в колонке есть ширина, и читать её проще, чем
                     разбирать значок. */
                  'lg:flex-none lg:flex-row lg:items-center lg:gap-3 lg:px-3 lg:text-sm',
                  isActive
                    ? 'text-primary-emphasis lg:bg-primary/12'
                    : 'text-muted-foreground hover:text-foreground focus-visible:text-foreground lg:hover:bg-accent',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      'flex size-8 items-center justify-center rounded-lg transition-colors lg:size-auto lg:bg-transparent',
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
