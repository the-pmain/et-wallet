import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { EncryptionService, type Wei } from '@/core'
import { TEST_MODE } from '@/shared/config'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

const PASSWORD = 'Korova-7-Luna!'

const USERNAME = 'Дмитрий'

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

let services: ITestAppServices
let service: ITestAppServices['onboarding']

/**
 * Разворачивает приложение с настоящим ядром.
 *
 * Шифрование подменено ускоренным: боевые 600 000 итераций PBKDF2
 * превратили бы каждый тест в полсекунды ожидания. Узлы сети подменены
 * дублёром: обращение к настоящему публичному RPC сделало бы тест
 * медленным и зависящим от чужой доступности. Всё остальное —
 * BIP-39, BIP-32, AES-GCM, хранилище — работает по-настоящему.
 */
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
  services.providerFactory.configure({ balance: 0n as Wei })
  service = services.onboarding
})

describe('Экран приветствия', () => {
  it('предлагает создание кошелька', async () => {
    renderApp()

    expect(await screen.findByRole('link', { name: /создать новый кошелёк/i })).toBeInTheDocument()
  })

  it('показывает вход по seed-фразе в соответствии с режимом', async () => {
    renderApp()

    await screen.findByRole('link', { name: /создать новый кошелёк/i })

    /* Временное послабление снимает вход по seed-фразе целиком.
       Тест следует за флагом, а не закрепляет одно из двух состояний:
       иначе возврат защиты обратно уронил бы набор. */
    const importLink = screen.queryByRole('link', { name: /импортировать/i })

    expect(importLink === null).toBe(TEST_MODE.hideSeedImport)
  })

  it('предупреждает о невозможности восстановления', async () => {
    renderApp()

    await screen.findByRole('link', { name: /создать новый кошелёк/i })

    /* Проверяется суть, а не формулировка. При снятом входе по фразе
       предупреждение обязано стать ещё определённее: восстанавливать
       кошелёк сейчас нечем вообще. */
    expect(
      screen.getByText(
        TEST_MODE.hideSeedImport ? /восстановить кошелёк.*нечем/i : /означает попытку кражи/i,
      ),
    ).toBeInTheDocument()
  })
})

/** Заполняет первый шаг создания кошелька: имя и пароль. */
async function fillCreationForm(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByRole('link', { name: /создать новый кошелёк/i }))
  await user.type(screen.getByLabelText(/имя пользователя/i), USERNAME)
  await user.type(screen.getByLabelText('Пароль'), PASSWORD)
  await user.type(screen.getByLabelText('Повторите пароль'), PASSWORD)
}

describe('Создание кошелька', () => {
  it('не пускает дальше со слабым паролем', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('link', { name: /создать новый кошелёк/i }))
    /* Экран создания грузится отдельным чанком: до его появления
       поля в документе нет. */
    await user.type(await screen.findByLabelText('Пароль'), '123')

    expect(screen.getByRole('button', { name: 'Далее' })).toBeDisabled()
  })

  it('не пускает дальше при несовпадении паролей', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('link', { name: /создать новый кошелёк/i }))
    await user.type(await screen.findByLabelText('Пароль'), PASSWORD)
    await user.type(screen.getByLabelText('Повторите пароль'), 'Korova-7-Luna?')

    expect(screen.getByText('Пароли не совпадают')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Далее' })).toBeDisabled()
  })

  it('не пускает дальше без имени пользователя', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('link', { name: /создать новый кошелёк/i }))
    await user.type(await screen.findByLabelText('Пароль'), PASSWORD)
    await user.type(screen.getByLabelText('Повторите пароль'), PASSWORD)

    expect(screen.getByRole('button', { name: 'Далее' })).toBeDisabled()
  })

  it('не пускает дальше с непригодным именем', async () => {
    /* Один символ именем не считается: подпись кошелька из единственной
       буквы не отличает его ни от чего. */
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('link', { name: /создать новый кошелёк/i }))
    await user.type(await screen.findByLabelText(/имя пользователя/i), 'Д')
    await user.type(screen.getByLabelText('Пароль'), PASSWORD)
    await user.type(screen.getByLabelText('Повторите пароль'), PASSWORD)

    expect(screen.getByRole('button', { name: 'Далее' })).toBeDisabled()
  })

  it('называет имя меткой, а не учётной записью', async () => {
    /* Человек, привыкший к обычным сервисам, принимает имя за учётную
       запись и ждёт восстановления доступа. Узнать, что восстанавливать
       некому, он обязан здесь, а не после потери средств. */
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('link', { name: /создать новый кошелёк/i }))

    expect(await screen.findByText(/это не учётная запись/i)).toBeInTheDocument()
  })

  it('показывает фразу только после явного действия', async () => {
    const user = userEvent.setup()
    renderApp()

    await fillCreationForm(user)
    await user.click(screen.getByRole('button', { name: 'Далее' }))

    /* Слова присутствуют в разметке, но скрыты до нажатия: случайный
       взгляд через плечо не раскроет фразу. */
    expect(screen.getByRole('button', { name: /показать фразу/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /показать фразу/i }))

    expect(screen.getByRole('button', { name: /скрыть/i })).toBeInTheDocument()
  })

  it('требует отметки о записи фразы', async () => {
    const user = userEvent.setup()
    renderApp()

    await fillCreationForm(user)
    await user.click(screen.getByRole('button', { name: 'Далее' }))

    /* Подпись кнопки зависит от режима: при снятой проверке она сразу
       создаёт кошелёк, при включённой ведёт к вопросам о словах.
       Отметка о записи фразы обязательна в обоих случаях. */
    const submitName = TEST_MODE.skipSeedConfirmation ? 'Создать кошелёк' : 'Далее'

    expect(screen.getByRole('button', { name: submitName })).toBeDisabled()

    await user.click(screen.getByRole('checkbox'))

    expect(screen.getByRole('button', { name: submitName })).toBeEnabled()
  })

  it('предупреждает о необратимости потери фразы', async () => {
    const user = userEvent.setup()
    renderApp()

    await fillCreationForm(user)
    await user.click(screen.getByRole('button', { name: 'Далее' }))

    expect(screen.getByText(/не сохраняйте фразу в заметках/i)).toBeInTheDocument()
  })

  it('показывает фразу и при снятой проверке записи', async () => {
    /* Послабление снимает вопросы о словах, но не показ фразы:
       возможность её записать обязана остаться. */
    const user = userEvent.setup()
    renderApp()

    await fillCreationForm(user)
    await user.click(screen.getByRole('button', { name: 'Далее' }))

    expect(screen.getByRole('button', { name: /показать фразу/i })).toBeInTheDocument()
  })

  it('предупреждает о снятой проверке, когда она снята', async () => {
    const user = userEvent.setup()
    renderApp()

    await fillCreationForm(user)
    await user.click(screen.getByRole('button', { name: 'Далее' }))

    const notice = screen.queryByText(/проверка записанной фразы временно отключена/i)

    expect(notice !== null).toBe(TEST_MODE.skipSeedConfirmation)
  })

  it('создаёт кошелёк и подписывает его именем пользователя', async () => {
    const user = userEvent.setup()
    renderApp()

    await fillCreationForm(user)
    await user.click(screen.getByRole('button', { name: 'Далее' }))
    await user.click(screen.getByRole('checkbox'))

    if (!TEST_MODE.skipSeedConfirmation) {
      /* Полный путь с вопросами о словах проверяется отдельным набором:
         здесь важно только имя аккаунта после создания. */
      return
    }

    await user.click(screen.getByRole('button', { name: 'Создать кошелёк' }))

    /* Вместо безликого «Аккаунт 1» в шапке стоит имя владельца. */
    expect(await screen.findByText(USERNAME)).toBeInTheDocument()
  })
})

/*
  Экран импорта временно скрыт флагом послаблений. Набор следует
  за флагом, а не удалён: возврат защиты обратно вернёт и эти проверки,
  а не потребует восстанавливать их по памяти.
*/
describe.skipIf(TEST_MODE.hideSeedImport)('Импорт кошелька', () => {
  it('сообщает о недопустимом числе слов', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('link', { name: /импортировать/i }))
    await user.type(await screen.findByLabelText('Мнемоническая фраза'), 'abandon abandon about')

    expect(await screen.findByText(/допустимо 12, 15, 18, 21, 24 слов/i)).toBeInTheDocument()
  })

  it('указывает позиции слов вне словаря', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('link', { name: /импортировать/i }))
    await user.type(
      screen.getByLabelText('Мнемоническая фраза'),
      TEST_MNEMONIC.replace('about', 'xyzzy'),
    )

    expect(await screen.findByText(/проверьте слова на позициях: 12/i)).toBeInTheDocument()
  })

  it('подтверждает корректность фразы', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('link', { name: /импортировать/i }))
    await user.type(await screen.findByLabelText('Мнемоническая фраза'), TEST_MNEMONIC)

    expect(await screen.findByText('Фраза корректна')).toBeInTheDocument()
  })

  it('предупреждает о фишинге', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('link', { name: /импортировать/i }))

    expect(await screen.findByText(/не имеет права её запрашивать/i)).toBeInTheDocument()
  })

  it('предупреждает об общеизвестной тестовой фразе', async () => {
    /* Человек, взявший фразу из статьи или примера, обязан узнать
       об этом до того, как переведёт на её адрес средства: приватные
       ключи такой фразы вычисляет любой желающий. */
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('link', { name: /импортировать/i }))
    await user.type(await screen.findByLabelText('Мнемоническая фраза'), TEST_MNEMONIC)

    expect(await screen.findByText(/общеизвестная тестовая фраза/i)).toBeInTheDocument()
  })

  it('предупреждение не мешает импортировать', async () => {
    /* Импорт тестовой фразы — обычная работа разработчика. Запрет
       вместо предупреждения был бы решением за владельца. */
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('link', { name: /импортировать/i }))
    await user.type(await screen.findByLabelText('Мнемоническая фраза'), TEST_MNEMONIC)
    await user.type(screen.getByLabelText('Пароль'), PASSWORD)
    await user.type(screen.getByLabelText('Повторите пароль'), PASSWORD)

    expect(await screen.findByText(/общеизвестная тестовая фраза/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Импортировать' })).toBeEnabled()
  })

  it('импортирует кошелёк и переводит в разблокированное состояние', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('link', { name: /импортировать/i }))
    await user.type(await screen.findByLabelText('Мнемоническая фраза'), TEST_MNEMONIC)
    await user.type(screen.getByLabelText('Пароль'), PASSWORD)
    await user.type(screen.getByLabelText('Повторите пароль'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Импортировать' }))

    /* Признак разблокировки — появление панели кошелька с созданным
       из seed-фразы аккаунтом в шапке. */
    expect(await screen.findByText('Аккаунт 1')).toBeInTheDocument()
  })
})

describe('Скрытый вход по seed-фразе', () => {
  it('маршрут импорта закрыт вместе с кнопкой', async () => {
    /* Скрытая кнопка при открытом адресе означала бы, что путь всё ещё
       доступен любому, кто наберёт его руками. */
    window.location.hash = '#/import'

    renderApp()

    if (TEST_MODE.hideSeedImport) {
      expect(
        await screen.findByRole('link', { name: /создать новый кошелёк/i }),
      ).toBeInTheDocument()
      expect(screen.queryByLabelText('Мнемоническая фраза')).not.toBeInTheDocument()
    } else {
      expect(await screen.findByLabelText('Мнемоническая фраза')).toBeInTheDocument()
    }
  })
})

describe('Разблокировка', () => {
  beforeEach(async () => {
    await service.importWallet(TEST_MNEMONIC, PASSWORD, USERNAME)
    service.lock()
  })

  /** Заполняет форму входа. */
  async function signIn(user: ReturnType<typeof userEvent.setup>, password: string): Promise<void> {
    await user.type(await screen.findByLabelText('Пароль'), password)
    await user.click(screen.getByRole('button', { name: 'Разблокировать' }))
  }

  it('открывается по верному паролю', async () => {
    const user = userEvent.setup()
    renderApp()

    await signIn(user, PASSWORD)

    /* Признак разблокировки — появление панели кошелька, подписанной
       именем владельца. */
    expect(await screen.findByText(USERNAME)).toBeInTheDocument()
  })

  it('вход не требует ничего, кроме пароля', async () => {
    /* Имя лежит в том же зашифрованном хранилище и сверяться может лишь
       после того, как пароль уже подошёл. Второе поле создавало бы
       впечатление второго фактора, которого нет. */
    renderApp()

    await screen.findByLabelText('Пароль')

    expect(screen.queryByLabelText(/имя пользователя/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/электронной почты/i)).not.toBeInTheDocument()
  })

  it('сообщает об ошибке при неверном пароле', async () => {
    const user = userEvent.setup()
    renderApp()

    await signIn(user, 'Nepravilnyy-1!')

    expect(await screen.findByRole('alert')).toHaveTextContent(/неверный пароль/i)
  })

  it('не раскрывает, что именно не сошлось', async () => {
    /* Отличие «неверный пароль» от «хранилище повреждено» — информация
       для подбирающего, а не для владельца. */
    const user = userEvent.setup()
    renderApp()

    await signIn(user, 'Nepravilnyy-1!')

    const alert = await screen.findByRole('alert')

    expect(alert.textContent).not.toMatch(/повреждено|контрольная сумма|тег/i)
  })

  it('ведёт на страницу сброса', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('link', { name: /забыли пароль/i }))

    expect(await screen.findByText('Стереть кошелёк с этого устройства')).toBeInTheDocument()
  })
})

describe('Забыли пароль', () => {
  beforeEach(async () => {
    await service.importWallet(TEST_MNEMONIC, PASSWORD)
    service.lock()
    window.location.hash = '#/forgot-password'
  })

  it('сразу сообщает, что восстановление невозможно', async () => {
    renderApp()

    expect(await screen.findByText(/Восстановить его\s+нельзя/i)).toBeInTheDocument()

    expect(await screen.findByText('Стереть кошелёк с этого устройства')).toBeInTheDocument()
  })

  it('предупреждает о безвозвратной потере средств', async () => {
    renderApp()

    expect(await screen.findByText(/средства будут потеряны безвозвратно/i)).toBeInTheDocument()
  })

  it('требует двух подтверждений', async () => {
    const user = userEvent.setup()
    renderApp()

    const resetButton = await screen.findByRole('button', { name: 'Стереть кошелёк' })

    expect(resetButton).toBeDisabled()

    await user.click(screen.getByRole('checkbox'))

    /* Флажок отсекает случайное нажатие, ввод слова — механическое
       проставление галочек не читая. */
    expect(resetButton).toBeDisabled()

    await user.type(screen.getByLabelText(/введите слово/i), 'СТЕРЕТЬ')

    expect(resetButton).toBeEnabled()
  })

  it('не даёт ввести слово до отметки о наличии фразы', async () => {
    renderApp()

    expect(await screen.findByLabelText(/введите слово/i)).toBeDisabled()
  })

  it('стирает кошелёк и возвращает к приветствию', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('checkbox'))
    await user.type(screen.getByLabelText(/введите слово/i), 'СТЕРЕТЬ')
    await user.click(screen.getByRole('button', { name: 'Стереть кошелёк' }))

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /создать новый кошелёк/i })).toBeInTheDocument()
    })
  })
})

describe('Маршрутизация по состоянию', () => {
  it('показывает приветствие для несозданного кошелька', async () => {
    renderApp()

    expect(await screen.findByRole('link', { name: /создать новый кошелёк/i })).toBeInTheDocument()
  })

  it('перенаправляет на разблокировку для созданного кошелька', async () => {
    await service.importWallet(TEST_MNEMONIC, PASSWORD)
    service.lock()

    renderApp()

    /* Заблокированный кошелёк не должен показывать экран создания:
       иначе пользователь создаст второй кошелёк поверх первого. */
    expect(await screen.findByText('С возвращением')).toBeInTheDocument()
  })
})

describe('Боевые параметры шифрования', () => {
  it('шифрование по умолчанию остаётся боевым', () => {
    /* Ускоренное шифрование существует только в тестах. Проверка
       фиксирует, что понижение стойкости не просочилось в значения
       по умолчанию, которыми пользуется composition root. */
    expect(new EncryptionService().createKdfParams().iterations).toBe(600_000)
  })
})

describe('Путь к другому кошельку', () => {
  beforeEach(async () => {
    await service.importWallet(TEST_MNEMONIC, PASSWORD, USERNAME)
    service.lock()
  })

  it('экран входа предлагает завести другой кошелёк', async () => {
    /* Человек, который пароль помнит, но хочет другой кошелёк, за ссылку
       «забыли пароль» не нажмёт — и решит, что кошелёк его никуда
       не пускает. */
    renderApp()

    expect(
      await screen.findByRole('link', { name: /создать другой кошелёк|восстановить по seed/i }),
    ).toBeInTheDocument()
  })

  it('ведёт на экран стирания, который объясняет оба случая', async () => {
    const user = userEvent.setup()

    renderApp()
    await user.click(
      await screen.findByRole('link', { name: /создать другой кошелёк|восстановить по seed/i }),
    )

    expect(await screen.findByText(/Забыт пароль/i)).toBeInTheDocument()
    expect(screen.getByText(/Нужен другой кошелёк/i)).toBeInTheDocument()
  })

  it('называет главное ограничение: кошелёк на устройстве один', async () => {
    /* Иначе непонятно, почему нельзя просто создать второй. */
    const user = userEvent.setup()

    renderApp()
    await user.click(
      await screen.findByRole('link', { name: /создать другой кошелёк|восстановить по seed/i }),
    )

    expect(await screen.findByText(/На одном устройстве кошелёк один/i)).toBeInTheDocument()
  })
})
