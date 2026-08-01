import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { assertTestModeIsDisabledInProduction } from '@/shared/config'

import { App } from './App'
import { AppProviders } from './providers'
import './styles/index.css'

/* Проверка стоит до отрисовки: боевая сборка с временно снятыми защитами
   обязана не запуститься, а не заработать незаметно. Забытый флаг — это
   не гипотетическая оплошность, а обычный способ потерять чужие деньги. */
assertTestModeIsDisabledInProduction()

const rootElement = document.getElementById('root')

/* Отсутствие корневого узла — неустранимая ошибка конфигурации index.html.
   Явная проверка лучше `!`: она даёт понятное сообщение вместо разыменования null. */
if (rootElement === null) {
  throw new Error('Не найден корневой элемент #root в index.html.')
}

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
)
