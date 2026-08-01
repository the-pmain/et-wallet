import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { FREE_UNLOCK_ATTEMPTS, type Wei } from '@/core'
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

/** Вводит пароль и нажимает разблокировку. */
async function attempt(password: string): Promise<void> {
  const user = userEvent.setup()
  const field = await screen.findByLabelText('Пароль')

  await user.clear(field)
  await user.type(field, password)
  await user.click(screen.getByRole('button', { name: 'Разблокировать' }))
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

describe('Ограничение попыток входа', () => {
  it('первые неудачи не закрывают ввод', async () => {
    renderApp()

    await attempt(WRONG_PASSWORD)

    await waitFor(() => {
      expect(screen.getByText(/Неверный пароль/i)).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'Разблокировать' })).toBeEnabled()
  })

  it('показывает, сколько попыток осталось до задержки', async () => {
    /* Молчаливое приближение к порогу означало бы, что владелец
       узнаёт о задержке только когда в неё упрётся. */
    renderApp()

    await attempt(WRONG_PASSWORD)

    expect(await screen.findByText(/Осталось попыток до задержки/i)).toBeInTheDocument()
  })

  it('закрывает ввод после исчерпания запаса', async () => {
    renderApp()

    for (let index = 0; index <= FREE_UNLOCK_ATTEMPTS; index += 1) {
      await attempt(WRONG_PASSWORD)
    }

    expect(await screen.findByText(/Слишком много попыток/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Разблокировать' })).toBeDisabled()
  })

  it('показывает обратный отсчёт, а не молчаливый отказ', async () => {
    renderApp()

    for (let index = 0; index <= FREE_UNLOCK_ATTEMPTS; index += 1) {
      await attempt(WRONG_PASSWORD)
    }

    /* Формат «мм:сс»: пользователь должен видеть, сколько ждать. */
    expect(await screen.findByText(/^\d+:\d{2}$/)).toBeInTheDocument()
  })

  it('верный пароль после задержки открывает кошелёк', async () => {
    renderApp()

    for (let index = 0; index <= FREE_UNLOCK_ATTEMPTS; index += 1) {
      await attempt(WRONG_PASSWORD)
    }

    await screen.findByText(/Слишком много попыток/i)

    /* Управляемые часы двигают время вперёд: ждать пять секунд
       по-настоящему означало бы замедлить весь набор. */
    await act(async () => {
      services.clock.advance(10_000)
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Разблокировать' })).toBeEnabled()
    })

    await attempt(PASSWORD)

    expect(await screen.findByText('Аккаунт 1')).toBeInTheDocument()
  })

  it('успешный вход обнуляет счётчик', async () => {
    renderApp()

    await attempt(WRONG_PASSWORD)
    await attempt(PASSWORD)

    await screen.findByText('Аккаунт 1')

    await expect(services.onboarding.getUnlockThrottleState()).resolves.toEqual({
      failedAttempts: 0,
      retryAfterMs: 0,
    })
  })
})

describe('Ограничитель переживает перезагрузку', () => {
  it('состояние читается при открытии экрана', async () => {
    /* Ограничитель, обнуляемый обновлением страницы, не ограничивает
       ничего: подбирающий нажимает F5 после каждой неудачи. Здесь
       перезагрузка изображается повторной отрисовкой поверх того же
       хранилища. */
    for (let index = 0; index <= FREE_UNLOCK_ATTEMPTS; index += 1) {
      await expect(services.onboarding.unlock(WRONG_PASSWORD)).rejects.toThrow()
    }

    renderApp()

    expect(await screen.findByText(/Слишком много попыток/i)).toBeInTheDocument()
  })
})

describe('Ограничитель общий с подтверждением пароля', () => {
  it('неудачи подтверждения закрывают и вход', async () => {
    /* Разные счётчики означали бы, что подбирающий выберет форму
       без ограничения. */
    for (let index = 0; index <= FREE_UNLOCK_ATTEMPTS; index += 1) {
      await services.onboarding.verifyPassword(WRONG_PASSWORD)
    }

    await expect(services.onboarding.unlock(PASSWORD)).rejects.toThrow(/Слишком много попыток/i)
  })
})
