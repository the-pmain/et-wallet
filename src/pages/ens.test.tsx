import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { BUILT_IN_CHAIN_ID, toAddress, type Wei } from '@/core'
import { TEST_MNEMONIC, TEST_MNEMONIC_ADDRESSES } from '@/core/hdwallet/vectors'
import { createTestAppServices, type IFakeEnsRecord, type ITestAppServices } from '@/test/doubles'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

const PASSWORD = 'Korova-7-Luna!'

/** Первый адрес тестовой фразы — им владеет кошелёк. */
const OWNER = toAddress(TEST_MNEMONIC_ADDRESSES[0] as string)

/** Посторонний адрес. Используется как получатель и как самозванец. */
const OUTSIDER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

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

/** Настраивает дублёр узла с заданными записями ENS. */
function withEns(records: readonly IFakeEnsRecord[]): void {
  services.providerFactory.configure({ balance: BALANCE, ensRecords: records })
}

/** Открывает экран отправки. */
async function openSend(): Promise<void> {
  const user = userEvent.setup()

  await screen.findByText('Account 1')
  await user.click(screen.getByRole('link', { name: /send/i }))
  await screen.findByRole('heading', { name: 'Send' })
}

/** Вводит получателя и дожидается окончания разбора. */
async function typeRecipient(value: string): Promise<void> {
  const user = userEvent.setup()

  await user.type(screen.getByLabelText(/Recipient address/), value)

  await waitFor(() => {
    expect(screen.queryByText('Checking…')).not.toBeInTheDocument()
  })
}

beforeEach(async () => {
  window.location.hash = ''
  services = createTestAppServices()
  services.providerFactory.configure({ balance: BALANCE })

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
})

describe('ENS: прямое разрешение в форме отправки', () => {
  it('показывает адрес, в который разрешилось имя', async () => {
    /* Имя удобно, но подписывается адрес. Пользователь обязан увидеть
       его до того, как нажмёт «Далее». */
    withEns([{ name: 'shop.eth', address: OUTSIDER }])

    renderApp()
    await openSend()
    await typeRecipient('shop.eth')

    expect(await screen.findByText(OUTSIDER)).toBeInTheDocument()
  })

  it('разрешает имя, введённое в верхнем регистре', async () => {
    withEns([{ name: 'shop.eth', address: OUTSIDER }])

    renderApp()
    await openSend()
    await typeRecipient('SHOP.ETH')

    expect(await screen.findByText(OUTSIDER)).toBeInTheDocument()
  })

  it('несуществующее имя не пускает дальше', async () => {
    withEns([])

    renderApp()
    await openSend()
    await typeRecipient('nobody.eth')

    expect(await screen.findByText(/There is no record for this name/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('имя с подменённой буквой отвергается с объяснением', async () => {
    /* Кириллическая «а» неотличима от латинской на экране. Разрешив
       такое имя, кошелёк отправил бы средства владельцу похожего
       имени. Символ собирается из кода: литералом он был бы
       непроверяем при чтении. */
    const spoofed = `vit${String.fromCodePoint(0x0430)}lik.eth`

    withEns([{ name: 'vitalik.eth', address: OUTSIDER }])

    renderApp()
    await openSend()
    await typeRecipient(spoofed)

    expect(await screen.findByText(/mixes different scripts/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('имя с эмодзи разрешается и помечается как нелатинское', async () => {
    /* ENSIP-15 такое имя принимает, и кошелёк обязан его отправлять.
       Но имя, записанное не латиницей, может выглядеть как чужое —
       об этом сказано прямо, без запрета. */
    withEns([{ name: '\u{1F600}.eth', address: OUTSIDER }])

    renderApp()
    await openSend()
    await typeRecipient('\u{1F600}.eth')

    expect(await screen.findByText(OUTSIDER)).toBeInTheDocument()
    expect(screen.getByText(/The name is not written in Latin script/i)).toBeInTheDocument()
  })

  it('латинское имя оговоркой о письменности не сопровождается', async () => {
    /* Ложные тревоги учат не читать настоящие: оговорка появляется
       только там, где для неё есть основание. */
    withEns([{ name: 'shop.eth', address: OUTSIDER }])

    renderApp()
    await openSend()
    await typeRecipient('shop.eth')

    await screen.findByText(OUTSIDER)

    expect(screen.queryByText(/The name is not written in Latin script/i)).not.toBeInTheDocument()
  })

  it('на подтверждении имя показывается вместе с адресом, а не вместо него', async () => {
    const user = userEvent.setup()

    withEns([{ name: 'shop.eth', address: OUTSIDER }])

    renderApp()
    await openSend()
    await typeRecipient('shop.eth')
    await user.type(screen.getByLabelText(/Amount/), '1')

    const next = screen.getByRole('button', { name: 'Next' })

    await waitFor(() => {
      expect(next).toBeEnabled()
    })

    await user.click(next)

    await screen.findByRole('heading', { name: 'Confirmation' })

    expect(screen.getByText('shop.eth')).toBeInTheDocument()
    expect(screen.getByText(OUTSIDER)).toBeInTheDocument()
    expect(screen.getByText(/The address came from an ENS name/i)).toBeInTheDocument()
  })
})

describe('ENS: обратное разрешение', () => {
  it('подписывает свой аккаунт именем вместо адреса', async () => {
    withEns([{ name: 'me.eth', address: OWNER, reverseFor: OWNER }])

    renderApp()

    expect(await screen.findByText('me.eth')).toBeInTheDocument()
  })

  it('не показывает имя, которое указывает на чужой адрес', async () => {
    /* САМАЯ ВАЖНАЯ ПРОВЕРКА. Обратную запись задаёт владелец адреса,
       и объявить себя `vitalik.eth` вправе кто угодно. Показав её
       без сверки, кошелёк подписал бы подделку своим интерфейсом. */
    withEns([{ name: 'vitalik.eth', address: OUTSIDER, reverseFor: OWNER }])

    renderApp()
    await screen.findByText('Account 1')

    /* Ждём завершения загрузки данных аккаунта: имя, если бы оно
       показывалось, появилось бы к этому моменту. */
    await waitFor(() => {
      expect(services.session.getSnapshot().isEnsSupported).toBe(true)
    })

    expect(screen.queryByText('vitalik.eth')).not.toBeInTheDocument()
  })

  it('называет имя адреса, введённого в поле получателя', async () => {
    withEns([{ name: 'shop.eth', address: OUTSIDER, reverseFor: OUTSIDER }])

    renderApp()
    await openSend()
    await typeRecipient(OUTSIDER)

    expect(await screen.findByText(/The name of this address/i)).toBeInTheDocument()
  })
})

describe('ENS: другие сети', () => {
  it('в сети без реестра имя не разрешается и это сказано прямо', async () => {
    /* Разрешить имя из Polygon можно было бы, лишь открыв второе
       соединение с узлом Ethereum — незаметно для владельца,
       считающего, что он в другой сети. */
    const user = userEvent.setup()

    withEns([{ name: 'shop.eth', address: OUTSIDER }])

    renderApp()
    await screen.findByText('Account 1')

    await services.session.switchNetwork(BUILT_IN_CHAIN_ID.Polygon)
    await openSend()
    await typeRecipient('shop.eth')

    expect(await screen.findByText(/only in the Ethereum network/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()

    /* Адрес в той же сети принимается: ENS ограничивает разбор имён,
       а не отправку. */
    await user.clear(screen.getByLabelText(/Recipient address/))
    await typeRecipient(OUTSIDER)
    await user.type(screen.getByLabelText(/Amount/), '1')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
    })
  })
})
