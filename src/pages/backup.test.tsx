import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { type Wei } from '@/core'
import { TEST_MNEMONIC } from '@/core/hdwallet/vectors'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

const PASSWORD = 'Korova-7-Luna!'
/** Почта владельца: идентификатор входа, лежит в колонке `email`. */
const USERNAME = 'owner@example.com'
const WRONG_PASSWORD = 'Sobaka-9-Solnce!'

const BALANCE = 1_000_000_000_000_000_000n as Wei

let services: ITestAppServices

function renderApp() {
  return render(
    <AppProviders services={services}>
      <AppRouter />
    </AppProviders>,
  )
}

/** Открывает экран резервной копии. */
async function openBackup(): Promise<void> {
  await screen.findByText(USERNAME)
  window.location.hash = '#/wallet/backup'

  await screen.findByRole('heading', { name: 'Backup' })
}

/** Проходит путь до ввода пароля для указанного секрета. */
async function reachPasswordStep(button: string, acknowledge: string): Promise<void> {
  const user = userEvent.setup()

  await user.click(await screen.findByRole('button', { name: button }))
  await user.click(await screen.findByRole('checkbox'))
  await user.click(await screen.findByRole('button', { name: acknowledge }))
}

beforeEach(async () => {
  window.location.hash = ''
  services = createTestAppServices()
  services.providerFactory.configure({ balance: BALANCE })

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD, USERNAME)
})

describe('Резервная копия: экран', () => {
  it('объясняет, что означает потеря фразы', async () => {
    renderApp()
    await openBackup()

    expect(screen.getByText(/obtains the wallet/i)).toBeInTheDocument()
  })

  it('не показывает секретов до запроса', async () => {
    renderApp()
    await openBackup()

    expect(screen.queryByText('abandon')).not.toBeInTheDocument()
  })
})

describe('Резервная копия: seed-фраза', () => {
  it('требует отметки о понимании последствий до ввода пароля', async () => {
    const user = userEvent.setup()

    renderApp()
    await openBackup()

    await user.click(await screen.findByRole('button', { name: 'Show the seed phrase' }))

    expect(screen.getByText('The phrase opens the whole wallet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show the phrase' })).toBeDisabled()
  })

  it('называет, что пароль устройства фразу не защищает', async () => {
    const user = userEvent.setup()

    renderApp()
    await openBackup()

    await user.click(await screen.findByRole('button', { name: 'Show the seed phrase' }))

    expect(screen.getByText(/The password of this device does not protect it/i)).toBeInTheDocument()
  })

  it('спрашивает пароль даже при разблокированном кошельке', async () => {
    renderApp()
    await openBackup()
    await reachPasswordStep('Show the seed phrase', 'Show the phrase')

    expect(screen.getByText(/revealing the seed phrase/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
  })

  it('показывает фразу после верного пароля', async () => {
    const user = userEvent.setup()

    renderApp()
    await openBackup()
    await reachPasswordStep('Show the seed phrase', 'Show the phrase')

    await user.type(screen.getByLabelText('Password'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText('about')).toBeInTheDocument()
    expect(screen.getAllByText('abandon')).toHaveLength(11)
  })

  it('неверный пароль фразу не выдаёт', async () => {
    const user = userEvent.setup()

    renderApp()
    await openBackup()
    await reachPasswordStep('Show the seed phrase', 'Show the phrase')

    await user.type(screen.getByLabelText('Password'), WRONG_PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText('Wrong password.')).toBeInTheDocument()
    expect(screen.queryByText('about')).not.toBeInTheDocument()
  })

  it('копирование фразы в буфер обмена не предлагается', async () => {
    /* Буфер обмена читают другие приложения, а фраза — это весь
       кошелёк. Кнопка копирования здесь была бы удобством ценой
       единственного секрета, который нельзя сменить. */
    const user = userEvent.setup()

    renderApp()
    await openBackup()
    await reachPasswordStep('Show the seed phrase', 'Show the phrase')

    await user.type(screen.getByLabelText('Password'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await screen.findByText('about')

    expect(screen.queryByRole('button', { name: /Copy/i })).not.toBeInTheDocument()
  })

  it('убирает фразу с экрана по закрытию', async () => {
    const user = userEvent.setup()

    renderApp()
    await openBackup()
    await reachPasswordStep('Show the seed phrase', 'Show the phrase')

    await user.type(screen.getByLabelText('Password'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await screen.findByText('about')
    await user.click(screen.getByRole('button', { name: 'Hide and close' }))

    expect(screen.queryByText('about')).not.toBeInTheDocument()
  })
})

describe('Резервная копия: приватный ключ', () => {
  it('оговаривает невозможность отзыва', async () => {
    const user = userEvent.setup()

    renderApp()
    await openBackup()

    await user.click(await screen.findByRole('button', { name: 'Show the private key' }))

    expect(screen.getByText('The key hands over the address for good')).toBeInTheDocument()
  })

  it('выдаёт ключ после подтверждения и пароля', async () => {
    const user = userEvent.setup()

    renderApp()
    await openBackup()
    await reachPasswordStep('Show the private key', 'Show the key')

    await user.type(screen.getByLabelText('Password'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText(/^0x[0-9a-f]{64}$/i)).toBeInTheDocument()
  })

  it('ключ скрыт до явного показа', async () => {
    const user = userEvent.setup()

    renderApp()
    await openBackup()
    await reachPasswordStep('Show the private key', 'Show the key')

    await user.type(screen.getByLabelText('Password'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    /* Значение присутствует в разметке, но скрыто от чтения с экрана
       и размыто: случайный взгляд и демонстрация экрана его не раскроют. */
    expect(await screen.findByText(/^0x[0-9a-f]{64}$/i)).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('button', { name: 'Show' })).toBeInTheDocument()
  })
})

describe('Проверка записанной копии', () => {
  /** Заполняет форму проверки и нажимает «Check». */
  async function check(phrase: string, password: string): Promise<void> {
    const user = userEvent.setup()

    await user.type(screen.getByLabelText(/The phrase from your paper/i), phrase)
    await user.type(screen.getByLabelText(/Wallet password/i), password)
    await user.click(screen.getByRole('button', { name: 'Check' }))
  }

  it('верная копия подтверждается', async () => {
    renderApp()
    await openBackup()
    await check(TEST_MNEMONIC, PASSWORD)

    expect(await screen.findByText('The copy matches')).toBeInTheDocument()
  })

  it('ошибка в одном слове названа расхождением', async () => {
    renderApp()
    await openBackup()
    await check(TEST_MNEMONIC.replace('about', 'above'), PASSWORD)

    expect(await screen.findByText('The copy does not match')).toBeInTheDocument()
  })

  it('при расхождении фраза не показывается', async () => {
    /* Показ «правильного варианта» после неудачи свёл бы всю пользу
       экрана к нулю: он и затевался ради того, чтобы не раскрывать
       фразу ради проверки. */
    renderApp()
    await openBackup()
    await check('abandon abandon abandon', PASSWORD)

    await screen.findByText('The copy does not match')

    expect(document.body.textContent).not.toContain(TEST_MNEMONIC)
  })

  it('какое слово отличается, не сообщается', async () => {
    /* Подсказка помогла бы не только владельцу: нашедший бумагу
       с несколькими смазанными словами подбирал бы остаток по одному. */
    renderApp()
    await openBackup()
    await check(TEST_MNEMONIC.replace('about', 'above'), PASSWORD)

    await screen.findByText('The copy does not match')

    expect(screen.getByText(/not shown on purpose/i)).toBeInTheDocument()
  })

  it('неверный пароль отвечает отказом, а не «не совпало»', async () => {
    /* Иначе ответ сообщал бы, что пароль угадан. */
    renderApp()
    await openBackup()
    await check(TEST_MNEMONIC, WRONG_PASSWORD)

    expect(await screen.findByText(/password is wrong/i)).toBeInTheDocument()
    expect(screen.queryByText('The copy does not match')).not.toBeInTheDocument()
  })

  it('введённое стирается после ответа', async () => {
    /* Оставленная в поле фраза видна каждому, кто подойдёт
       к устройству. */
    renderApp()
    await openBackup()
    await check(TEST_MNEMONIC, PASSWORD)

    await screen.findByText('The copy matches')

    expect(screen.getByLabelText(/The phrase from your paper/i)).toHaveValue('')
    expect(screen.getByLabelText(/Wallet password/i)).toHaveValue('')
  })

  it('объясняет, зачем спрашивается пароль', async () => {
    /* На разблокированном кошельке требование выглядит придиркой,
       если не сказать, что оно закрывает перебор чужих догадок. */
    renderApp()
    await openBackup()

    expect(screen.getByText(/cannot be used to guess a phrase/i)).toBeInTheDocument()
  })
})
