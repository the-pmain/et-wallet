import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { assertTestModeIsDisabledInProduction } from '@/shared/config'

import { App } from './App'
import { AppProviders } from './providers'
import './styles/index.css'

/* The check runs before render: a production build with temporarily
   lifted protections must refuse to start, not work unnoticed. A
   forgotten flag is not a hypothetical slip — it is a usual way to
   lose someone else's money. */
assertTestModeIsDisabledInProduction()

const rootElement = document.getElementById('root')

/* A missing root node is an unrecoverable index.html config error.
   An explicit check is better than `!`: it gives a clear message
   instead of a null dereference. */
if (rootElement === null) {
  throw new Error('The root element #root was not found in index.html.')
}

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
)
