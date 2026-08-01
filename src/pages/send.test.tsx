import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { toAddress, type Wei } from '@/core'
import { TEST_MNEMONIC, TEST_MNEMONIC_ADDRESSES } from '@/core/hdwallet/vectors'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

const PASSWORD = 'Korova-7-Luna!'

const RECIPIENT = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

/** Десять эфиров: хватает и на перевод, и на комиссию. */
const BALANCE = (10n ** 19n) as Wei

let services: ITestAppServices

function renderApp() {
  return render(
    <AppProviders services={services}>
      <AppRouter />
    </AppProviders>,
  )
}

/** Открывает экран отправки из панели. */
async function openSend(): Promise<void> {
  const user = userEvent.setup()

  await screen.findByText('Аккаунт 1')
  await user.click(screen.getByRole('link', { name: /отправить/i }))
  await screen.findByRole('heading', { name: 'Отправка' })
}

/**
 * Заполняет форму и переходит к подтверждению.
 *
 * ОЖИДАНИЕ РАЗБОРА ОБЯЗАТЕЛЬНО. Поле принимает и адрес, и имя ENS,
 * поэтому введённое разбирается с задержкой и асинхронно. Кнопка «Далее»
 * до окончания разбора заблокирована — нажатие без ожидания попало бы
 * в неактивную кнопку и тест падал бы через раз.
 */
async function fillAndContinue(recipient: string, amount: string): Promise<void> {
  const user = userEvent.setup()

  await user.type(screen.getByLabelText(/Адрес получателя/), recipient)
  await user.type(screen.getByLabelText(/Сумма/), amount)

  const next = screen.getByRole('button', { name: 'Далее' })

  await waitFor(() => {
    expect(next).toBeEnabled()
  })

  await user.click(next)
}

/**
 * Проходит подтверждение отправки целиком, включая повторный ввод пароля.
 *
 * Пароль спрашивается по умолчанию: он защищает от того, кто получил
 * доступ к уже разблокированному кошельку.
 */
async function confirmAndSend(): Promise<void> {
  const user = userEvent.setup()

  await user.click(screen.getByRole('button', { name: 'Подтвердить и отправить' }))
  await user.type(await screen.findByLabelText('Пароль'), PASSWORD)
  await user.click(screen.getByRole('button', { name: 'Подтвердить' }))
}

beforeEach(async () => {
  window.location.hash = ''
  services = createTestAppServices()
  services.providerFactory.configure({ balance: BALANCE })

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
})

describe('Отправка: форма', () => {
  it('показывает отправителя и доступный баланс', async () => {
    renderApp()
    await openSend()

    const expected = TEST_MNEMONIC_ADDRESSES[0] as string
    const shortened = `${expected.slice(0, 6)}…${expected.slice(-6)}`

    /* Усечённый адрес встречается и в шапке оболочки: запрос ограничен
       карточкой отправителя. */
    const card = screen.getByText('Откуда').closest('[data-slot=card]') as HTMLElement

    expect(within(card).getByText(shortened)).toBeInTheDocument()
    expect(within(card).getByText('10 ETH')).toBeInTheDocument()
  })

  it('не пускает дальше без адреса получателя', async () => {
    renderApp()
    await openSend()

    expect(screen.getByRole('button', { name: 'Далее' })).toBeDisabled()
  })

  it('не пускает дальше с некорректным адресом', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSend()

    await user.type(screen.getByLabelText(/Адрес получателя/), '0x123')
    await user.type(screen.getByLabelText(/Сумма/), '1')

    /* Ожидание нужно и здесь: разбор идёт с задержкой, и проверка
       сразу после ввода застала бы кнопку заблокированной по другой
       причине — потому что разбор ещё не закончился. */
    expect(await screen.findByText(/Введите адрес из 42 символов/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Далее' })).toBeDisabled()
  })

  it('сообщает о недопустимой сумме', async () => {
    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '0')

    /* Ноль отвергается до обращения к сети: незачем оценивать газ
       для перевода, которого не будет. */
    expect(await screen.findByText(/больше нуля/i)).toBeInTheDocument()
  })

  it('предлагает три уровня срочности', async () => {
    renderApp()
    await openSend()

    for (const label of ['Обычная', 'Быстрая', 'Срочная']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })
})

describe('Отправка: подтверждение', () => {
  it('показывает поля подписываемой транзакции', async () => {
    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Подтверждение' })

    /* Показанное обязано совпадать с подписываемым: экран выводит поля
       готового объекта, а не пересчитанные заново значения. */
    expect(screen.getByText('1 ETH')).toBeInTheDocument()
    expect(screen.getByText(RECIPIENT)).toBeInTheDocument()
    expect(screen.getByText(TEST_MNEMONIC_ADDRESSES[0] as string)).toBeInTheDocument()
  })

  it('показывает получателя целиком, а не усечённым', async () => {
    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Подтверждение' })

    /* Усечённый адрес невозможно сверить посимвольно, а именно сверка
       защищает от подмены содержимого буфера обмена. */
    expect(screen.getByText(RECIPIENT)).toBeInTheDocument()
  })

  it('показывает chainId, nonce и лимит газа', async () => {
    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Подтверждение' })

    expect(screen.getByText('chainId')).toBeInTheDocument()
    expect(screen.getByText('Номер (nonce)')).toBeInTheDocument()
    expect(screen.getByText('Лимит газа')).toBeInTheDocument()
  })

  it('предупреждает о необратимости перевода', async () => {
    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Подтверждение' })

    expect(screen.getByText(/Перевод в блокчейне необратим/i)).toBeInTheDocument()
  })

  it('предупреждает об адресе без контрольной суммы', async () => {
    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT.toLowerCase(), '1')

    await screen.findByRole('heading', { name: 'Подтверждение' })

    expect(screen.getByText(/опечатка в нём не обнаруживается/i)).toBeInTheDocument()
  })

  it('предупреждает о переводе самому себе', async () => {
    renderApp()
    await openSend()
    await fillAndContinue(TEST_MNEMONIC_ADDRESSES[0] as string, '1')

    await screen.findByRole('heading', { name: 'Подтверждение' })

    expect(screen.getByText(/Получатель совпадает с отправителем/i)).toBeInTheDocument()
  })

  it('позволяет вернуться к правке', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Подтверждение' })
    await user.click(screen.getByRole('button', { name: 'Назад' }))

    expect(await screen.findByRole('heading', { name: 'Отправка' })).toBeInTheDocument()
  })
})

describe('Отправка: результат', () => {
  it('показывает хэш опубликованной транзакции', async () => {
    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Подтверждение' })
    await confirmAndSend()

    expect(
      await screen.findByRole('heading', { name: 'Транзакция отправлена' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/^0x[0-9a-fA-F]+$/)).toBeInTheDocument()
  })

  it('оговаривает, что принятие узлом не означает включения в блок', async () => {
    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Подтверждение' })
    await confirmAndSend()

    await waitFor(() => {
      expect(screen.getByText(/не означает включения в блок/i)).toBeInTheDocument()
    })
  })
})

describe('Отправка: подтверждение паролем', () => {
  it('спрашивает пароль перед подписью', async () => {
    /* Защищает от того, кто получил доступ к уже разблокированному
       кошельку: к оставленному устройству, к чужой сессии. */
    const user = userEvent.setup()

    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Подтверждение' })
    await user.click(screen.getByRole('button', { name: 'Подтвердить и отправить' }))

    expect(await screen.findByLabelText('Пароль')).toBeInTheDocument()
    expect(screen.getByText(/отправку перевода/i)).toBeInTheDocument()
  })

  it('не отправляет при неверном пароле', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Подтверждение' })
    await user.click(screen.getByRole('button', { name: 'Подтвердить и отправить' }))
    await user.type(await screen.findByLabelText('Пароль'), 'Nepravilnyy-1!')
    await user.click(screen.getByRole('button', { name: 'Подтвердить' }))

    expect(await screen.findByText('Неверный пароль.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Транзакция отправлена' })).not.toBeInTheDocument()
  })

  it('позволяет отказаться от подтверждения', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Подтверждение' })
    await user.click(screen.getByRole('button', { name: 'Подтвердить и отправить' }))
    await user.click(await screen.findByRole('button', { name: 'Отмена' }))

    expect(screen.getByRole('button', { name: 'Подтвердить и отправить' })).toBeInTheDocument()
  })
})

describe('Отправка: получатель-контракт', () => {
  it('предупреждает о переводе на адрес с кодом', async () => {
    /* Монеты, отправленные контракту, который их не принимает,
       теряются безвозвратно. */
    services.providerFactory.configure({ balance: BALANCE, contractAddresses: [RECIPIENT] })

    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Подтверждение' })

    expect(screen.getByText('Получатель — контракт')).toBeInTheDocument()
  })

  it('не предупреждает об обычном адресе', async () => {
    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Подтверждение' })

    expect(screen.queryByText('Получатель — контракт')).not.toBeInTheDocument()
  })
})

describe('Отправка: недостаток средств', () => {
  it('отвергает перевод, на который не хватает средств вместе с комиссией', async () => {
    services.providerFactory.configure({ balance: 1n as Wei })

    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    /* Проверка выполняется в ядре, а не в форме: в форме её забыли бы
       при появлении второго пути отправки. */
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Отправка' })).toBeInTheDocument()
    })
    expect(screen.getByText(/средств/i)).toBeInTheDocument()
  })
})
