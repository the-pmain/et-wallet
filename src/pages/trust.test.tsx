import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { TEST_MNEMONIC } from '@/core/hdwallet/vectors'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

const PASSWORD = 'Korova-7-Luna!'

let services: ITestAppServices

function renderApp() {
  return render(
    <AppProviders services={services}>
      <AppRouter />
    </AppProviders>,
  )
}

beforeEach(() => {
  window.location.hash = ''
  services = createTestAppServices()
})

describe('Чему приходится доверять', () => {
  it('доступно с первого экрана, до создания кошелька', async () => {
    /* Сведения нужны раньше решения: человек, уже создавший кошелёк
       и переведший туда средства, распорядиться ими иначе уже
       не сможет. */
    const user = userEvent.setup()

    renderApp()

    await user.click(await screen.findByRole('link', { name: /what you are trusting/i }))

    expect(
      await screen.findByRole('heading', { name: 'What you are trusting' }),
    ).toBeInTheDocument()
  })

  it('называет главное: код приходит с сервера при каждом открытии', async () => {
    /* Это отличает веб-кошелёк от расширения и от настольного
       приложения, и умолчать об этом значит обещать безопасность,
       которой нет. */
    window.location.hash = '#/trust'

    renderApp()

    expect(await screen.findByText(/downloaded from a server every time/i)).toBeInTheDocument()
  })

  it('прямо говорит, что шифрование здесь не помогает', async () => {
    /* Соблазн успокоить упоминанием шифрования велик, но подменённый
       код и есть кошелёк: шифровать он будет ровно так, как ему
       велели. */
    window.location.hash = '#/trust'

    renderApp()

    expect(
      await screen.findByText(/no encryption inside the wallet prevents that/i),
    ).toBeInTheDocument()
  })

  it('разделяет то, что кошелёк защищает, и то, чего не может', async () => {
    window.location.hash = '#/trust'

    renderApp()

    expect(await screen.findByText('What the wallet does protect')).toBeInTheDocument()
    expect(screen.getByText('What it cannot protect')).toBeInTheDocument()
  })

  it('даёт выполнимые советы, а не призыв не пользоваться', async () => {
    /* Решение принимает владелец средств: кошелёк обязан дать
       сведения, а не выбирать за него. */
    window.location.hash = '#/trust'

    renderApp()

    expect(await screen.findByText(/from your own bookmark/i)).toBeInTheDocument()
    expect(screen.getByText(/hardware wallet/i)).toBeInTheDocument()
  })

  it('оговаривает, что это свойство всех веб-кошельков', async () => {
    /* Иначе прочитанное выглядит как признание в собственной
       ненадёжности, а не как объяснение устройства. */
    window.location.hash = '#/trust'

    renderApp()

    expect(await screen.findByText(/every wallet that runs as a web page/i)).toBeInTheDocument()
  })

  it('доступно из настроек открытого кошелька', async () => {
    const user = userEvent.setup()

    await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)

    renderApp()
    await screen.findByText('Account 1')

    await user.click(screen.getByRole('link', { name: 'Settings' }))
    await user.click(await screen.findByRole('link', { name: /what you are trusting/i }))

    expect(
      await screen.findByRole('heading', { name: 'What you are trusting' }),
    ).toBeInTheDocument()
  })
})
