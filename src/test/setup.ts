import '@testing-library/jest-dom/vitest'

/*
  IndexedDB в jsdom отсутствует, а постоянное хранилище кошелька
  построено на нём. Без этой подстановки любой тест, собирающий боевую
  связку сервисов, падал бы на открытии базы — то есть проверял бы
  отсутствие IndexedDB в jsdom, а не работу кошелька.

  Подставляется реализация из `fake-indexeddb`: она следует
  спецификации, включая структурное клонирование значений и откат
  транзакций. Заглушка, отвечающая «успех» на любой запрос, скрыла бы
  именно те ошибки, ради которых проверки и написаны.
*/
import 'fake-indexeddb/auto'

import { cleanup, configure } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

/**
 * Глобальная подготовка тестовой среды.
 */

/*
  Порог ожидания асинхронных запросов поднят с одной секунды до пяти.

  Причина не в медленном коде: открытие сессии кошелька выводит ключи
  из seed-фразы (PBKDF2, пусть и с уменьшенным числом итераций), поднимает
  сервисы и опрашивает дублёр узла. При полном прогоне на загруженной
  машине это не укладывалось в секунду, и набор давал случайные отказы
  в разных файлах.

  Мигающий тест хуже отсутствующего: он приучает не смотреть на красный
  цвет. Завышенный порог замедляет только настоящие падения — успешное
  ожидание завершается сразу, как только условие выполнено.
*/
configure({ asyncUtilTimeout: 5000 })

/*
  jsdom не реализует window.matchMedia. Без заглушки падает любой компонент,
  который реагирует на системные настройки (тема, prefers-reduced-motion).
  Заглушка по умолчанию сообщает «условие не выполнено» — это соответствует
  светлой теме и отсутствию особых предпочтений пользователя.
*/
vi.stubGlobal(
  'matchMedia',
  vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
)

/*
  jsdom не реализует модальный режим `<dialog>`: `showModal` и `close`
  отсутствуют даже в 30-й версии. Без подстановки любой тест, задевающий
  модальное окно, падал бы на отсутствии метода — то есть проверял бы
  полноту jsdom, а не поведение кошелька.

  Подставляется минимум, достаточный для проверок разметки: открытие
  выставляет атрибут `open`, закрытие снимает его и рассылает событие
  `close`, а Escape закрывает окно — ровно то, чем пользуется компонент.
  Настоящая модальность (верхний слой, удержание фокуса, отключение
  остального документа) остаётся за браузером и здесь не изображается:
  заглушка, делающая вид, что фокус удержан, скрыла бы именно те
  ошибки, ради которых такие проверки и пишутся.
*/
if (
  typeof HTMLDialogElement !== 'undefined' &&
  HTMLDialogElement.prototype.showModal === undefined
) {
  const open = function open(this: HTMLDialogElement): void {
    this.setAttribute('open', '')
  }

  const close = function close(this: HTMLDialogElement, returnValue?: string): void {
    if (!this.hasAttribute('open')) {
      return
    }

    this.removeAttribute('open')

    if (returnValue !== undefined) {
      this.returnValue = returnValue
    }

    this.dispatchEvent(new Event('close'))
  }

  HTMLDialogElement.prototype.showModal = open
  HTMLDialogElement.prototype.show = open
  HTMLDialogElement.prototype.close = close

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
      return
    }

    document.querySelectorAll('dialog[open]').forEach((dialog) => {
      ;(dialog as HTMLDialogElement).close()
    })
  })
}

/*
  Язык интерфейса фиксируется русским.

  Приложение определяет язык по настройкам браузера, и это правильное
  поведение для продукта — но не для тестов: jsdom сообщает `en-US`,
  а у разработчика с английской системой набор падал бы там же, где
  у разработчика с русской проходит. Тест, зависящий от локали машины,
  проверяет машину, а не приложение.

  Свойство подменяется целиком, а не через `vi.stubGlobal('navigator')`:
  подмена всего объекта навигатора лишила бы среду `clipboard`, которым
  пользуется экран получения средств.
*/
Object.defineProperty(navigator, 'languages', {
  value: ['ru-RU', 'ru'],
  configurable: true,
})

/*
  Размонтирование React-дерева после каждого теста обязательно: иначе состояние
  провайдеров протекает между тестами и делает результаты недетерминированными.
*/
afterEach(() => {
  cleanup()
  sessionStorage.clear()
  localStorage.clear()
})

/*
  Запрос публичного рынка на главном экране не должен уходить в сеть
  из юнит-тестов: это медленно, недетерминированно и добавляет в
  документ тикер ETH, из-за которого проверка баланса находит два
  узла вместо одного.

  Перехватывается только `/coins/markets`. Остальные обращения — к
  своему серверу, к узлу — проходят как были. Проверки, которые
  подменяют `fetch` целиком, перекрывают эту заглушку сами.
*/
const originalFetch = globalThis.fetch.bind(globalThis)

vi.stubGlobal('fetch', ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

  if (url.includes('/coins/markets')) {
    return Promise.resolve(
      new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  }

  return originalFetch(input, init)
}) as typeof fetch)
