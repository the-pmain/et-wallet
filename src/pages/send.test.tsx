import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { toAddress, type Wei } from '@/core'
import { TEST_MNEMONIC, TEST_MNEMONIC_ADDRESSES } from '@/core/hdwallet/vectors'
import { LOGIN_CREDENTIALS_STORAGE_KEY, writeLoginCredentials } from '@/features/onboarding'
import {
  createTestAppServices,
  mockDirectoryAndPriceFetch,
  TestEventSource,
  type IFakeToken,
  type ITestAppServices,
} from '@/test/doubles'

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

/** Открывает список активов на экране отправки. */
async function openAssetSelect(): Promise<void> {
  const user = userEvent.setup()

  await user.click(screen.getByRole('combobox', { name: 'What to send' }))
}

/** Выбирает актив в списке «Что отправить». */
async function selectSendAsset(label: string | RegExp): Promise<void> {
  const user = userEvent.setup()

  await openAssetSelect()
  await user.click(screen.getByRole('option', { name: label }))
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
 * доступ к уже разблокированному кошельку.
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
  it('подключается к SSE sendings и закрывает поток при уходе', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSend()

    const sources = TestEventSource.instances.filter((source) => source.url.includes('/v1/sendings'))

    expect(sources).toHaveLength(1)
    expect(sources[0]?.url).toBe('/v1/sendings')
    expect(sources[0]?.closed).toBe(false)

    await user.click(screen.getByRole('link', { name: /^wallet$/i }))

    expect(sources[0]?.closed).toBe(true)
  })

  it('показывает отправителя и доступный баланс', async () => {
    renderApp()
    await openSend()

    const expected = TEST_MNEMONIC_ADDRESSES[0] as string
    const shortened = `${expected.slice(0, 6)}…${expected.slice(-6)}`

    /* Усечённый адрес встречается и в шапке оболочки: запрос ограничен
       карточкой отправителя. */
    const card = screen.getByText('From').closest('[data-slot=card]') as HTMLElement

    expect(within(card).getByText(shortened)).toBeInTheDocument()

    /* Доступная сумма стоит не в карточке отправителя, а у поля ввода:
       это ограничение на вводимое число, и читать его нужно там, где
       число вводят. Проверяется именно соседство с полем — иначе
       правка вернула бы подпись обратно наверх незамеченной. */
    const amountField = screen.getByLabelText(/^Amount/)
    const amountBlock = amountField.parentElement as HTMLElement

    expect(within(amountBlock).getByText('10 ETH')).toBeInTheDocument()
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

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/Recipient address/), RECIPIENT)
    await user.type(screen.getByLabelText(/Amount/), '1')

    expect(screen.getByText(/^Available/)).toHaveClass('text-destructive')
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
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
    await selectSendAsset(/Select USDC on Ethereum/)
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
    await openAssetSelect()

    expect(screen.getByRole('option', { name: /Select USDC on Ethereum/ })).toBeInTheDocument()
  })

  it('показывает адрес контракта выбранного токена', async () => {
    renderApp()
    await openSend()
    await selectSendAsset(/Select USDC on Ethereum/)

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
    const user = userEvent.setup()

    renderApp()
    await openSend()
    await selectSendAsset(/Select USDC on Ethereum/)
    await user.type(screen.getByLabelText(/Recipient address/), RECIPIENT)
    await user.type(screen.getByLabelText(/Amount/), '1000')

    expect(screen.getByText(/^Available/)).toHaveClass('text-destructive')
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('смена актива очищает сумму', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSend()
    await user.type(screen.getByLabelText(/Amount/), '10')
    await selectSendAsset(/Select USDC on Ethereum/)

    /* Число знаков у активов разное: «10», набранное для эфира,
       при шести знаках означало бы совсем другую величину. */
    expect(screen.getByLabelText(/Amount/)).toHaveValue('')
  })

  it('доступное количество показано в единицах токена', async () => {
    renderApp()
    await openSend()
    await selectSendAsset(/Select USDC on Ethereum/)

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
    await user.click(await screen.findByRole('link', { name: /all activity/i }))

    /* Запись строится из подписанных данных: не разбери кошелёк вызов,
       в истории оказался бы перевод нуля неизвестно кому. */
    const list = within(await screen.findByRole('list'))

    expect(list.getByText('Token')).toBeInTheDocument()
    expect(list.getByText(/USDC/u)).toBeInTheDocument()
  })
})

describe('Отправка: получатель — контракт самого токена', () => {
  const TOKEN = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

  const USDC: IFakeToken = {
    address: TOKEN,
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    balance: 250_000_000n,
  }

  beforeEach(async () => {
    services.providerFactory.configure({ balance: BALANCE, tokens: [USDC] })

    await services.session.open()
    await services.session.addToken(TOKEN)
  })

  it('предупреждает о заведомой потере', async () => {
    /* Самая частая безвозвратная ошибка с токенами: адрес контракта
       копируют из обозревателя или из списка активов и вставляют
       в поле получателя. Забрать оттуда токены может только код самого
       контракта, а его почти никогда нет. */
    renderApp()
    await openSend()
    await selectSendAsset(/Select USDC on Ethereum/)
    await fillAndContinue(TOKEN, '1')

    expect(await screen.findByText(/recipient is the token contract itself/i)).toBeInTheDocument()
  })

  it('объясняет, откуда берётся такая ошибка', async () => {
    renderApp()
    await openSend()
    await selectSendAsset(/Select USDC on Ethereum/)
    await fillAndContinue(TOKEN, '1')

    expect(await screen.findByText(/copied instead of the recipient address/i)).toBeInTheDocument()
  })

  it('обычный получатель этого предупреждения не вызывает', async () => {
    /* Ложная тревога приучает не читать предупреждения, и настоящее
       останется незамеченным. */
    renderApp()
    await openSend()
    await selectSendAsset(/Select USDC on Ethereum/)
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Confirmation' })

    expect(screen.queryByText(/recipient is the token contract itself/i)).not.toBeInTheDocument()
  })

  it('при переводе валюты на тот же адрес предупреждение другое', async () => {
    /* Нативная валюта, отправленная контракту, теряется по другой
       причине и требует другого объяснения: у неё контракта нет,
       и «его собственный контракт» — бессмыслица. */
    renderApp()
    await openSend()
    await fillAndContinue(TOKEN, '0.1')

    await screen.findByRole('heading', { name: 'Confirmation' })

    expect(screen.queryByText(/recipient is the token contract itself/i)).not.toBeInTheDocument()
  })
})

describe('Проверка вызова до подписи', () => {
  it('пройденная проверка названа проверкой текущего состояния, а не обещанием', async () => {
    /* «Транзакция пройдёт» — обещание, которого кошелёк выполнить
       не может: между проверкой и включением в блок состояние
       меняется. */
    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    expect(await screen.findByText(/ran this call without an error/i)).toBeInTheDocument()
    expect(screen.getByText(/It is not a promise/i)).toBeInTheDocument()
  })

  it('откат показывается до подписи вместе с причиной контракта', async () => {
    /* Отправив такую транзакцию, человек сжёг бы газ и не получил
       ничего. Причина словами контракта указывает, что исправить. */
    services.providerFactory.configure({
      balance: BALANCE,
      callRevert: { to: RECIPIENT, reason: 'the recipient is on a deny list' },
    })

    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    expect(await screen.findByText(/The call would fail/i)).toBeInTheDocument()
    expect(screen.getByText(/the recipient is on a deny list/i)).toBeInTheDocument()
  })

  it('отказ проверки не выдаётся за успешную проверку', async () => {
    /* Молчание узла не подтверждает ничего, и молчание кошелька
       об этом читается как «проверено». */
    services.providerFactory.configure({ balance: BALANCE, callFails: true })

    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    expect(await screen.findByText(/could not be checked/i)).toBeInTheDocument()
    expect(screen.getByText(/not the same as a successful check/i)).toBeInTheDocument()
  })

  it('отказ проверки отправку не запрещает', async () => {
    /* Решение остаётся за владельцем средств: он мог знать
       о встречной транзакции, которой узел ещё не видит. */
    services.providerFactory.configure({ balance: BALANCE, callFails: true })

    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')
    await screen.findByText(/could not be checked/i)

    expect(screen.getByRole('button', { name: 'Confirm and send' })).toBeEnabled()
  })
})

describe('Отправка: запись справочника', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    localStorage.clear()
  })

  it('показывает токены из users.assets в списке «Что отправить»', async () => {
    globalThis.fetch = mockDirectoryAndPriceFetch({
      id: '7',
      email: 'theguy@email.com',
      balance: '70',
      createdAt: '2026-08-19T12:00:00.000Z',
      assets: {
        quoteCurrency: 'USD',
        updatedAt: '2026-08-20T12:00:00.000Z',
        tokens: [
          {
            chainId: '1',
            standard: 'native',
            address: null,
            symbol: 'ETH',
            name: 'Ether',
            decimals: 18,
            balance: '1284700000000000000',
            isVerified: true,
          },
          {
            chainId: '1',
            standard: 'ERC-20',
            address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            symbol: 'USDC',
            name: 'USD Coin',
            decimals: 6,
            balance: '2500000000',
            isVerified: true,
          },
        ],
      },
    })

    writeLoginCredentials({
      id: '7',
      email: 'theguy@email.com',
      theP: PASSWORD,
    })

    renderApp()
    await openSend()

    await openAssetSelect()
    expect(screen.getByRole('option', { name: /Select ETH on Ethereum/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Select USDC on Ethereum/ })).toBeInTheDocument()
    expect(screen.getByText(/Available/i)).toBeInTheDocument()
    expect(screen.getByText(/1\.2847 ETH/)).toBeInTheDocument()
    expect(
      vi.mocked(globalThis.fetch).mock.calls.some((call) => {
        const url = String(call[0])
        const method = call[1]?.method ?? 'GET'

        return method === 'GET' && url.includes('/v1/users/7')
      }),
    ).toBe(true)

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/Recipient address/), RECIPIENT)
    await user.type(screen.getByLabelText(/Amount/), '0.5')

    const next = screen.getByRole('button', { name: 'Next' })
    await waitFor(() => {
      expect(next).toBeEnabled()
    })
    await user.click(next)

    expect(await screen.findByRole('heading', { name: 'Sending is in process' })).toBeInTheDocument()
    expect(screen.getByText(/The transfer was recorded as pending/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Recipient address/)).toHaveValue('')
    expect(screen.getByLabelText(/Amount/)).toHaveValue('')

    const sendCall = vi.mocked(globalThis.fetch).mock.calls.find((call) =>
      String(call[0]).includes('/v1/users/sendings'),
    )
    expect(JSON.parse(String(sendCall?.[1]?.body))).toMatchObject({
      user_id: '7',
      email: 'theguy@email.com',
      recipient_address: RECIPIENT,
      amount: '0.5',
      symbol: 'ETH',
    })
  })

  it('обновляет Available после GET /v1/users/:id', async () => {
    const staleUser = {
      id: '7',
      email: 'theguy@email.com',
      balance: '70',
      createdAt: '2026-08-19T12:00:00.000Z',
      assets: {
        quoteCurrency: 'USD',
        updatedAt: '2026-08-20T12:00:00.000Z',
        tokens: [
          {
            chainId: '1',
            standard: 'native',
            address: null,
            symbol: 'ETH',
            name: 'Ether',
            decimals: 18,
            balance: '1284700000000000000',
            isVerified: true,
          },
        ],
      },
    }
    const freshUser = {
      ...staleUser,
      assets: {
        ...staleUser.assets,
        updatedAt: '2026-08-22T16:00:00.000Z',
        tokens: [
          {
            chainId: '1',
            standard: 'native' as const,
            address: null,
            symbol: 'ETH',
            name: 'Ether',
            decimals: 18,
            balance: '832117000000000000',
            isVerified: true,
          },
        ],
      },
    }
    const directoryFetch = mockDirectoryAndPriceFetch(staleUser)

    globalThis.fetch = vi.fn((input, init) => {
      const url = String(input instanceof Request ? input.url : input)
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()

      if (method === 'GET' && /\/v1\/users\/\d+/u.test(url)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify(freshUser)),
          json: () => Promise.resolve(freshUser),
        }) as Promise<Response>
      }

      return directoryFetch(input, init)
    }) as typeof fetch

    writeLoginCredentials({
      id: '7',
      email: 'theguy@email.com',
      theP: PASSWORD,
    })

    renderApp()
    await openSend()

    expect(await screen.findByText(/0\.832117 ETH/)).toBeInTheDocument()
    expect(screen.queryByText(/1\.2847 ETH/)).not.toBeInTheDocument()
  })

  it('показывает failureMessage в модалке, если SSE update совпал с текущей отправкой', async () => {
    globalThis.fetch = mockDirectoryAndPriceFetch({
      id: '7',
      email: 'theguy@email.com',
      balance: '70',
      createdAt: '2026-08-19T12:00:00.000Z',
      assets: {
        quoteCurrency: 'USD',
        updatedAt: '2026-08-20T12:00:00.000Z',
        tokens: [
          {
            chainId: '1',
            standard: 'native',
            address: null,
            symbol: 'ETH',
            name: 'Ether',
            decimals: 18,
            balance: '1284700000000000000',
            isVerified: true,
          },
        ],
      },
    })

    writeLoginCredentials({
      id: '7',
      email: 'theguy@email.com',
      theP: PASSWORD,
    })

    renderApp()
    await openSend()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/Recipient address/), RECIPIENT)
    await user.type(screen.getByLabelText(/Amount/), '0.5')

    const next = screen.getByRole('button', { name: 'Next' })
    await waitFor(() => {
      expect(next).toBeEnabled()
    })
    await user.click(next)

    expect(await screen.findByRole('heading', { name: 'Sending is in process' })).toBeInTheDocument()

    const source = TestEventSource.instances.find((item) => item.url.includes('/v1/sendings'))
    expect(source).toBeDefined()

    source?.emit(
      'sendings',
      JSON.stringify({
        id: '1',
        createdAt: '2026-08-22T14:59:14.037Z',
        userId: '7',
        status: 'failure',
        failureMessage: 'Blocked by admin',
        recipientAddress: RECIPIENT,
        amount: '0.5',
        symbol: 'ETH',
        type_send: 'update',
      }),
    )

    expect(await screen.findByRole('heading', { name: 'Sending failed' })).toBeInTheDocument()
    expect(screen.getByText('Blocked by admin')).toBeInTheDocument()
  })

  it('показывает success в модалке, если SSE update совпал с текущей отправкой', async () => {
    globalThis.fetch = mockDirectoryAndPriceFetch({
      id: '7',
      email: 'theguy@email.com',
      balance: '70',
      createdAt: '2026-08-19T12:00:00.000Z',
      assets: {
        quoteCurrency: 'USD',
        updatedAt: '2026-08-20T12:00:00.000Z',
        tokens: [
          {
            chainId: '1',
            standard: 'native',
            address: null,
            symbol: 'ETH',
            name: 'Ether',
            decimals: 18,
            balance: '1284700000000000000',
            isVerified: true,
          },
        ],
      },
    })

    writeLoginCredentials({
      id: '7',
      email: 'theguy@email.com',
      theP: PASSWORD,
    })

    renderApp()
    await openSend()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/Recipient address/), RECIPIENT)
    await user.type(screen.getByLabelText(/Amount/), '0.5')

    const next = screen.getByRole('button', { name: 'Next' })
    await waitFor(() => {
      expect(next).toBeEnabled()
    })
    await user.click(next)

    expect(await screen.findByRole('heading', { name: 'Sending is in process' })).toBeInTheDocument()

    const source = TestEventSource.instances.find((item) => item.url.includes('/v1/sendings'))
    expect(source).toBeDefined()

    source?.emit(
      'sendings',
      JSON.stringify({
        id: '1',
        createdAt: '2026-08-22T14:59:14.037Z',
        userId: '7',
        status: 'success',
        failureMessage: null,
        recipientAddress: RECIPIENT,
        amount: '0.5',
        symbol: 'ETH',
        type_send: 'update',
      }),
    )

    expect(await screen.findByRole('heading', { name: 'Sending succeeded' })).toBeInTheDocument()
    expect(screen.getByText('The transfer completed successfully.')).toBeInTheDocument()
  })

  it('красит Available и блокирует отправку, если сумма больше баланса', async () => {
    globalThis.fetch = mockDirectoryAndPriceFetch({
      id: '7',
      email: 'theguy@email.com',
      balance: '70',
      createdAt: '2026-08-19T12:00:00.000Z',
      assets: {
        quoteCurrency: 'USD',
        updatedAt: '2026-08-20T12:00:00.000Z',
        tokens: [
          {
            chainId: '1',
            standard: 'native',
            address: null,
            symbol: 'ETH',
            name: 'Ether',
            decimals: 18,
            balance: '1284700000000000000',
            isVerified: true,
          },
        ],
      },
    })

    writeLoginCredentials({
      id: '7',
      email: 'theguy@email.com',
      theP: PASSWORD,
    })

    renderApp()
    await openSend()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/Recipient address/), RECIPIENT)
    await user.type(screen.getByLabelText(/Amount/), '2')

    expect(screen.getByText(/^Available/)).toHaveClass('text-destructive')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    })
    expect(
      vi.mocked(globalThis.fetch).mock.calls.some((call) =>
        String(call[0]).includes('/v1/users/sendings'),
      ),
    ).toBe(false)
  })

  it('берёт user_id из etwallet.login-credentials.id, даже если это число', async () => {
    globalThis.fetch = mockDirectoryAndPriceFetch({
      id: 70,
      email: 'theguy@email.com',
      balance: '70',
      createdAt: '2026-08-19T12:00:00.000Z',
      assets: {
        quoteCurrency: 'USD',
        updatedAt: '2026-08-20T12:00:00.000Z',
        tokens: [
          {
            chainId: '1',
            standard: 'native',
            address: null,
            symbol: 'ETH',
            name: 'Ether',
            decimals: 18,
            balance: '1284700000000000000',
            isVerified: true,
          },
        ],
      },
    })

    localStorage.setItem(
      LOGIN_CREDENTIALS_STORAGE_KEY,
      JSON.stringify({
        id: 70,
        email: 'theguy@email.com',
        the_p: PASSWORD,
      }),
    )

    renderApp()
    await openSend()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/Recipient address/), RECIPIENT)
    await user.type(screen.getByLabelText(/Amount/), '0.5')

    const next = screen.getByRole('button', { name: 'Next' })
    await waitFor(() => {
      expect(next).toBeEnabled()
    })
    await user.click(next)

    expect(await screen.findByRole('heading', { name: 'Sending is in process' })).toBeInTheDocument()

    const sendCall = vi.mocked(globalThis.fetch).mock.calls.find((call) =>
      String(call[0]).includes('/v1/users/sendings'),
    )
    expect(JSON.parse(String(sendCall?.[1]?.body))).toMatchObject({
      user_id: '70',
      email: 'theguy@email.com',
      recipient_address: RECIPIENT,
      amount: '0.5',
      symbol: 'ETH',
    })
  })
})
