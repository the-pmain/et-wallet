import { AppRouter } from './router'

/**
 * Root app component.
 *
 * Holds only routing: providers live in `AppProviders` so their nesting
 * order is set in one place and can be reused in tests.
 */
export function App() {
  return <AppRouter />
}
