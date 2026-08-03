import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { toAddress, type Wei } from '@/core'
import { TEST_MNEMONIC, TEST_MNEMONIC_ADDRESSES } from '@/core/hdwallet/vectors'
import { createTestAppServices, type IFakeToken, type ITestAppServices } from '@/test/doubles'

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

  await screen.findByText('Account 1')
  await user.click(screen.getByRole('link', { name: /send/i }))
  await screen.findByRole('heading', { name: 'Send' })
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

  await user.type(screen.getByLabelText(/Recipient address/), recipient)
  await user.type(screen.getByLabelText(/Amount/), amount)

  const next = screen.getByRole('button', { name: 'Next' })

  await waitFor(() => {
    expect(next).toBeEnabled()
  })

  await user.click(next)
}

/**
 * Проходит подтверждение отправки целиком, включая повторный ввод пароля.
 *
 * Пароль спрашивается по умолчанию: он защищает от того, кто получил
 * access to an already unlocked wallet.
 */
async function confirmAndSend(): Promise<void> {
  const user = userEvent.setup()

  await user.click(screen.getByRole('button', { name: 'Confirm and send' }))
  await user.type(await screen.findByLabelText('Password'), PASSWORD)
  await user.click(screen.getByRole('button', { name: 'Confirm' }))
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
    const card = screen.getByText('From').closest('[data-slot=card]') as HTMLElement

    expect(within(card).getByText(shortened)).toBeInTheDocument()
    expect(within(card).getByText('10 ETH')).toBeInTheDocument()
  })

  it('не пускает дальше без адреса получателя', async () => {
    renderApp()
    await openSend()

    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('не пускает дальше с некорректным адресом', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSend()

    await user.type(screen.getByLabelText(/Recipient address/), '0x123')
    await user.type(screen.getByLabelText(/Amount/), '1')

    /* Ожидание нужно и здесь: разбор идёт с задержкой, и проверка
       сразу после ввода застала бы кнопку заблокированной по другой
       причине — потому что разбор ещё не закончился. */
    expect(await screen.findByText(/Enter a 42-character address/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('сообщает о недопустимой сумме', async () => {
    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '0')

    /* Ноль отвергается до обращения к сети: незачем оценивать газ
       для перевода, которого не будет. */
    expect(await screen.findByText(/greater than zero/i)).toBeInTheDocument()
  })

  it('предлагает три уровня срочности', async () => {
    renderApp()
    await openSend()

    for (const label of ['Normal', 'Fast', 'Urgent']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })
})

describe('Отправка: подтверждение', () => {
  it('показывает поля подписываемой транзакции', async () => {
    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Confirmation' })

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

    await screen.findByRole('heading', { name: 'Confirmation' })

    /* Усечённый адрес невозможно сверить посимвольно, а именно сверка
       защищает от подмены содержимого буфера обмена. */
    expect(screen.getByText(RECIPIENT)).toBeInTheDocument()
  })

  it('показывает chainId, nonce и лимит газа', async () => {
    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Confirmation' })

    expect(screen.getByText('chainId')).toBeInTheDocument()
    expect(screen.getByText('Nonce')).toBeInTheDocument()
    expect(screen.getByText('Gas limit')).toBeInTheDocument()
  })

  it('предупреждает о необратимости перевода', async () => {
    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Confirmation' })

    expect(screen.getByText(/A transfer on the blockchain cannot be undone/i)).toBeInTheDocument()
  })

  it('предупреждает об адресе без контрольной суммы', async () => {
    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT.toLowerCase(), '1')

    await screen.findByRole('heading', { name: 'Confirmation' })

    expect(screen.getByText(/a typo in it goes unnoticed/i)).toBeInTheDocument()
  })

  it('предупреждает о переводе самому себе', async () => {
    renderApp()
    await openSend()
    await fillAndContinue(TEST_MNEMONIC_ADDRESSES[0] as string, '1')

    await screen.findByRole('heading', { name: 'Confirmation' })

    expect(screen.getByText(/The recipient is the same as the sender/i)).toBeInTheDocument()
  })

  it('позволяет вернуться к правке', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Confirmation' })
    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(await screen.findByRole('heading', { name: 'Send' })).toBeInTheDocument()
  })
})

describe('Отправка: результат', () => {
  it('показывает хэш опубликованной транзакции', async () => {
    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Confirmation' })
    await confirmAndSend()

    expect(await screen.findByRole('heading', { name: 'Transaction sent' })).toBeInTheDocument()
    expect(screen.getByText(/^0x[0-9a-fA-F]+$/)).toBeInTheDocument()
  })

  it('оговаривает, что принятие узлом не означает включения в блок', async () => {
    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Confirmation' })
    await confirmAndSend()

    await waitFor(() => {
      expect(screen.getByText(/does not mean inclusion in a block/i)).toBeInTheDocument()
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

    await screen.findByRole('heading', { name: 'Confirmation' })
    await user.click(screen.getByRole('button', { name: 'Confirm and send' }))

    expect(await screen.findByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByText(/sending the transfer/i)).toBeInTheDocument()
  })

  it('не отправляет при неверном пароле', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Confirmation' })
    await user.click(screen.getByRole('button', { name: 'Confirm and send' }))
    await user.type(await screen.findByLabelText('Password'), 'Nepravilnyy-1!')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText('Wrong password.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Transaction sent' })).not.toBeInTheDocument()
  })

  it('позволяет отказаться от подтверждения', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Confirmation' })
    await user.click(screen.getByRole('button', { name: 'Confirm and send' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'Confirm and send' })).toBeInTheDocument()
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

    await screen.findByRole('heading', { name: 'Confirmation' })

    expect(screen.getByText('The recipient is a contract')).toBeInTheDocument()
  })

  it('не предупреждает об обычном адресе', async () => {
    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Confirmation' })

    expect(screen.queryByText('The recipient is a contract')).not.toBeInTheDocument()
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
      expect(screen.getByRole('heading', { name: 'Send' })).toBeInTheDocument()
    })
    expect(screen.getByText(/funds/i)).toBeInTheDocument()
  })
})

describe('Отправка: токен ERC-20', () => {
  const TOKEN = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

  /** Токен с шестью знаками: подстановка привычных восемнадцати заметна. */
  const USDC: IFakeToken = {
    address: TOKEN,
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    balance: 250_000_000n,
  }

  /** Выбирает токен в списке активов и заполняет форму. */
  async function fillTokenForm(amount: string): Promise<void> {
    const user = userEvent.setup()

    await user.selectOptions(screen.getByLabelText('What to send'), TOKEN)
    await fillAndContinue(RECIPIENT, amount)
  }

  beforeEach(async () => {
    services.providerFactory.configure({ balance: BALANCE, tokens: [USDC] })

    /* Токен добавляется до рендера: экран отправки берёт список активов
       из снимка, а наполняет его сессия. */
    await services.session.open()
    await services.session.addToken(TOKEN)
  })

  it('токен доступен для отправки в списке активов', async () => {
    renderApp()
    await openSend()

    expect(
      within(screen.getByLabelText('What to send')).getByRole('option', { name: /USDC/ }),
    ).toBeInTheDocument()
  })

  it('показывает адрес контракта выбранного токена', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSend()
    await user.selectOptions(screen.getByLabelText('What to send'), TOKEN)

    /* Символ задаёт автор контракта, и выпустить токен с символом USDC
       может кто угодно. Адрес — единственное, что отличает настоящий
       от поддельного. */
    expect(screen.getByText(TOKEN)).toBeInTheDocument()
  })

  it('сумма считается по числу знаков токена, а не по восемнадцати', async () => {
    renderApp()
    await openSend()
    await fillTokenForm('10')

    await screen.findByRole('heading', { name: 'Confirmation' })

    /* Десять USDC — это 10 000 000 единиц, а не 10^19. Подстановка
       привычных восемнадцати знаков занизила бы перевод в триллион раз. */
    expect(screen.getByText('10 USDC')).toBeInTheDocument()
  })

  it('транзакция адресована контракту, и это сказано прямо', async () => {
    renderApp()
    await openSend()
    await fillTokenForm('1')

    await screen.findByRole('heading', { name: 'Confirmation' })

    /* Человек, сверяющий адреса, обязан понимать, почему их два: иначе
       он решит, что кошелёк подменил получателя. */
    expect(screen.getByText(/will be sent to the token contract/i)).toBeInTheDocument()
    expect(screen.getByText(TOKEN)).toBeInTheDocument()
  })

  it('получатель показан настоящий, а не адрес контракта', async () => {
    renderApp()
    await openSend()
    await fillTokenForm('1')

    await screen.findByRole('heading', { name: 'Confirmation' })

    expect(screen.getByText(RECIPIENT)).toBeInTheDocument()
  })

  it('не даёт отправить больше, чем есть токенов', async () => {
    renderApp()
    await openSend()
    await fillTokenForm('1000')

    /* Иначе контракт откатил бы вызов, газ списался, а перевода
       не случилось бы. */
    expect(await screen.findByText(/The token balance is lower/i)).toBeInTheDocument()
  })

  it('смена актива очищает сумму', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSend()
    await user.type(screen.getByLabelText(/Amount/), '10')
    await user.selectOptions(screen.getByLabelText('What to send'), TOKEN)

    /* Число знаков у активов разное: «10», набранное для эфира,
       при шести знаках означало бы совсем другую величину. */
    expect(screen.getByLabelText(/Amount/)).toHaveValue('')
  })

  it('доступное количество показано в единицах токена', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSend()
    await user.selectOptions(screen.getByLabelText('What to send'), TOKEN)

    expect(await screen.findByText('250 USDC')).toBeInTheDocument()
  })

  it('отправленный токен попадает в историю как перевод токена', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSend()
    await fillTokenForm('10')

    await screen.findByRole('heading', { name: 'Confirmation' })
    await confirmAndSend()
    await screen.findByRole('heading', { name: 'Transaction sent' })

    await user.click(screen.getByRole('link', { name: /back to the wallet/i }))
    await user.click(await screen.findByRole('link', { name: /full history/i }))

    /* Запись строится из подписанных данных: не разбери кошелёк вызов,
       в истории оказался бы перевод нуля неизвестно кому. */
    const list = within(await screen.findByRole('list'))

    expect(list.getByText('Token')).toBeInTheDocument()
    expect(list.getByText(/USDC/u)).toBeInTheDocument()
  })
})
