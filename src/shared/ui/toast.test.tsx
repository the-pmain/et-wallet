import { render, screen, act, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Toaster as ToasterComponent } from './toast'
import type { toast as toastFn } from './toast-store'

/* Модуль хранит уведомления на своём уровне. Чтобы состояние одного
   теста не протекало в следующий, модули переимпортируются заново
   в каждом. */
let Toaster: typeof ToasterComponent
let toast: typeof toastFn

beforeEach(async () => {
  vi.useFakeTimers()
  vi.resetModules()
  Toaster = (await import('./toast')).Toaster
  toast = (await import('./toast-store')).toast
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Уведомления', () => {
  it('показанное уведомление появляется в области', () => {
    render(<Toaster />)

    act(() => {
      toast('Готово')
    })

    expect(screen.getByRole('status')).toHaveTextContent('Готово')
  })

  it('уведомление само исчезает по времени', () => {
    /* Иначе они копятся на экране и перекрывают то, ради чего человек
       смотрит на страницу. */
    render(<Toaster />)

    act(() => {
      toast('Исчезнет')
    })

    expect(screen.queryByRole('status')).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(4500)
    })

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('уведомление можно закрыть раньше срока', () => {
    render(<Toaster />)

    act(() => {
      toast('Закрой меня')
    })

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('область объявляется программам чтения с экрана', () => {
    /* Уведомление сообщает об уже случившемся; незрячий пользователь
       узнаёт о нём только через живую область. */
    render(<Toaster />)

    expect(document.querySelector('[aria-live="polite"]')).not.toBeNull()
  })
})
