import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { TEST_MODE } from '@/shared/config'
import { createTestAppServices } from '@/test/doubles'

import { App } from './App'
import { AppProviders } from './providers'

/**
 * Проверяется сборка приложения целиком: провайдеры, маршрутизация,
 * определение состояния кошелька.
 *
 * Шифрование подменено ускоренным — боевые 600 000 итераций PBKDF2
 * не имеют отношения к тому, что здесь проверяется.
 */
function renderApp() {
  const services = createTestAppServices()

  render(
    <AppProviders services={services}>
      <App />
    </AppProviders>,
  )

  return services
}

describe('App', () => {
  it('показывает экран приветствия для несозданного кошелька', async () => {
    renderApp()

    /* Признак — фирменный знак: узнаваемый вид приложения работает
       как слабая преграда для фишинговой копии, поэтому его присутствие
       на первом экране проверяется отдельно от текста заголовка. */
    expect(await screen.findByRole('img', { name: 'ETWallet' })).toBeInTheDocument()
  })

  it('предлагает создание кошелька', async () => {
    renderApp()

    expect(await screen.findByRole('link', { name: /create a new wallet/i })).toBeInTheDocument()
  })

  it('показывает вход по seed-фразе в соответствии с режимом', async () => {
    /* Временное послабление снимает этот путь целиком. Проверка следует
       за флагом, а не закрепляет одно из состояний: возврат защиты
       обратно не должен ронять набор. */
    renderApp()

    await screen.findByRole('link', { name: /create a new wallet/i })

    const importLink = screen.queryByRole('link', { name: /import/i })

    expect(importLink === null).toBe(TEST_MODE.hideSeedImport)
  })
})
