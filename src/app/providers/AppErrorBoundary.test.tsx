import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppErrorBoundary } from './AppErrorBoundary'

/** Компонент, ломающийся при отрисовке. */
function Broken(): never {
  throw new Error('Сломался список активов')
}

beforeEach(() => {
  /* React печатает сбой сам, и вывод перехватчика добавляется сверху.
     Заглушка убирает шум, не скрывая самой проверки: факт вызова
     проверяется отдельным тестом. */
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Перехват сбоя отрисовки', () => {
  it('исправное дерево показывается без изменений', () => {
    render(
      <AppErrorBoundary>
        <p>Balance</p>
      </AppErrorBoundary>,
    )

    expect(screen.getByText('Balance')).toBeInTheDocument()
  })

  it('сбой не оставляет пустой экран', () => {
    /* Белый экран для владельца средств неотличим от пропажи денег. */
    render(
      <AppErrorBoundary>
        <Broken />
      </AppErrorBoundary>,
    )

    expect(screen.getByRole('heading', { name: 'The application stopped' })).toBeInTheDocument()
  })

  it('прямо говорит, что средства целы', () => {
    /* Это единственный вопрос, который возникает у человека, увидевшего
       отказ кошелька. «Что-то пошло не так» на него не отвечает. */
    render(
      <AppErrorBoundary>
        <Broken />
      </AppErrorBoundary>,
    )

    expect(screen.getByText(/Your funds are safe/i)).toBeInTheDocument()
    expect(screen.getByText(/neither the/i)).toBeInTheDocument()
  })

  it('называет причину дословно', () => {
    /* Без причины владелец не поймёт, повторяется ли сбой, и не сможет
       о нём рассказать. */
    render(
      <AppErrorBoundary>
        <Broken />
      </AppErrorBoundary>,
    )

    expect(screen.getByText('Сломался список активов')).toBeInTheDocument()
  })

  it('предлагает перезагрузку и объясняет, что фраза не понадобится', () => {
    render(
      <AppErrorBoundary>
        <Broken />
      </AppErrorBoundary>,
    )

    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(screen.getByText(/The seed phrase is not needed to reload/i)).toBeInTheDocument()
  })

  it('сведения о сбое попадают в консоль', () => {
    /* Иначе они исчезают вместе с деревом компонентов, и разобраться
       в повторяющемся отказе нечем. */
    render(
      <AppErrorBoundary>
        <Broken />
      </AppErrorBoundary>,
    )

    expect(console.error).toHaveBeenCalled()
  })
})
