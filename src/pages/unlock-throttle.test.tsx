import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { type Wei } from '@/core'
import { TEST_MNEMONIC } from '@/core/hdwallet/vectors'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

const PASSWORD = 'Korova-7-Luna!'
const WRONG_PASSWORD = 'Sobaka-9-Solnce!'

let services: ITestAppServices

function renderApp() {
  return render(
    <AppProviders services={services}>
      <AppRouter />
    </AppProviders>,
  )
}

/** Вводит имя, пароль и нажимает разблокировку. */
async function attempt(password: string): Promise<void> {
  const user = userEvent.setup()
  const nameField = await screen.findByLabelText('Email')
  const field = await screen.findByLabelText('Password')

  await user.clear(nameField)
  await user.type(nameField, 'james@example.com')
  await user.clear(field)
  await user.type(field, password)
  await user.click(screen.getByRole('button', { name: 'Unlock' }))
}

/** Открывает экран входа: создаёт кошелёк и блокирует его. */
async function openLockedWallet(): Promise<void> {
  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
  services.onboarding.lock()
}

beforeEach(async () => {
  window.location.hash = ''
  services = createTestAppServices()
  services.providerFactory.configure({ balance: 0n as Wei })

  await openLockedWallet()
})

describe('Вход без ограничения попыток', () => {
  it('неудача не закрывает ввод и не показывает счётчик', async () => {
    renderApp()

    await attempt(WRONG_PASSWORD)

    await waitFor(() => {
      expect(screen.getByText(/Wrong password/i)).toBeInTheDocument()
    })

    expect(screen.queryByText(/Attempts left before a delay/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Too many attempts/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeEnabled()
  })

  it('много неудач подряд оставляют форму открытой', async () => {
    renderApp()

    for (let index = 0; index < 8; index += 1) {
      await attempt(WRONG_PASSWORD)
    }

    expect(await screen.findByText(/Wrong password/i)).toBeInTheDocument()
    expect(screen.queryByText(/Attempts left before a delay/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Too many attempts/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeEnabled()
  })

  it('верный пароль открывает кошелёк после нескольких неудач', async () => {
    renderApp()

    for (let index = 0; index < 8; index += 1) {
      await attempt(WRONG_PASSWORD)
    }

    await attempt(PASSWORD)

    expect(await screen.findByText('Account 1')).toBeInTheDocument()
  })

  it('счётчик остаётся пустым', async () => {
    renderApp()

    await attempt(WRONG_PASSWORD)
    await screen.findByText(/Wrong password/i)

    await expect(services.onboarding.getUnlockThrottleState()).resolves.toEqual({
      failedAttempts: 0,
      retryAfterMs: 0,
    })
  })
})

describe('Подтверждение пароля не закрывает вход', () => {
  it('неудачи проверки не мешают разблокировать кошелёк', async () => {
    for (let index = 0; index < 8; index += 1) {
      await expect(services.onboarding.verifyPassword(WRONG_PASSWORD)).resolves.toBe(false)
    }

    await expect(services.onboarding.unlock(PASSWORD)).resolves.toBeUndefined()
  })
})
