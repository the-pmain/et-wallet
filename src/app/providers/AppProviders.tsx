import { useState, type ReactNode } from 'react'

import { OnboardingProvider, DirectorySessionProvider } from '@/features/onboarding'
import { WalletProvider } from '@/features/wallet'

import { createAppServices, type IAppServices } from '../composition/createAppServices'
import { AppErrorBoundary } from './AppErrorBoundary'
import { DappProvider } from './DappProvider'
import { I18nProvider } from './I18nProvider'
import { SecurityProvider } from './SecurityProvider'
import { ThemeProvider } from './ThemeProvider'

interface AppProvidersProps {
  children: ReactNode

  /** Готовый набор сервисов. Используется тестами для подмены хранилища. */
  services?: IAppServices
}

/**
 * Единая точка сборки всех провайдеров приложения.
 *
 * Зачем отдельный компонент вместо вложенных провайдеров в main.tsx:
 * порядок провайдеров — часть архитектуры (роутер должен видеть состояние
 * блокировки, состояние блокировки — хранилище и так далее). Держать этот
 * порядок в одном месте дешевле, чем искать его в точке входа, и это
 * позволяет переиспользовать всё дерево провайдеров в тестах.
 *
 * `OnboardingProvider` вложен в `ThemeProvider`: оформление не зависит
 * от состояния кошелька, а экран загрузки обязан отрисоваться в нужной
 * теме ещё до того, как хранилище прочитано.
 *
 * `WalletProvider` вложен в `OnboardingProvider`: сессия кошелька открывается
 * и закрывается по состоянию блокировки, а значит обязана его видеть.
 *
 * СЕРВИСЫ СОЗДАЮТСЯ ЧЕРЕЗ ИНИЦИАЛИЗАТОР `useState`, А НЕ В ТЕЛЕ КОМПОНЕНТА.
 * Вызов при каждом рендере создавал бы новое хранилище и терял кошелёк
 * при первой же перерисовке.
 */
export function AppProviders({ children, services }: AppProvidersProps) {
  const [created] = useState(() => services ?? createAppServices())
  const value = services ?? created

  return (
    /* ПЕРЕХВАТ СБОЕВ — САМЫЙ ВНЕШНИЙ СЛОЙ. Ошибка в любом провайдере
       или экране размонтировала бы всё дерево, и владелец средств увидел
       бы белый экран — для него неотличимый от пропажи денег. Оформление
       и локализация при этом остаются внутри: экран отказа обязан
       отрисоваться, даже если сломались они. */
    <AppErrorBoundary>
      <ThemeProvider>
        {/* Локализация обёрнута снаружи состояния кошелька и внутри
          оформления: язык нужен уже экрану загрузки, а от того, открыт
          ли кошелёк, он не зависит. */}
        <I18nProvider>
          <DirectorySessionProvider>
            <OnboardingProvider service={value.onboarding} broadcast={value.broadcast}>
              {/* Модуль безопасности вложен в онбординг и охватывает сессию
                кошелька: автоблокировка следит за состоянием блокировки,
                а её срабатывание обязано закрыть сессию. */}
              <SecurityProvider
                clock={value.clock}
                settingsRepository={value.securitySettings}
                storage={value.storage}
              >
                <WalletProvider session={value.session}>
                  {/* Подключения вложены в сессию кошелька: запрос
                    от приложения выполняется её ключами и в её сети. */}
                  <DappProvider service={value.dappSessions}>{children}</DappProvider>
                </WalletProvider>
              </SecurityProvider>
            </OnboardingProvider>
          </DirectorySessionProvider>
        </I18nProvider>
      </ThemeProvider>
    </AppErrorBoundary>
  )
}
