import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PasswordFields } from './PasswordFields'

function renderFields(password: string) {
  return render(
    <PasswordFields
      password={password}
      confirmation=""
      onPasswordChange={() => undefined}
      onConfirmationChange={() => undefined}
    />,
  )
}

/** Отклик о качестве пароля — единственный узел с этим текстом. */
function verdict(): HTMLElement {
  return screen.getByText(/^Password is/u)
}

describe('PasswordFields: цвет отклика', () => {
  it('принятый пароль подсвечивается зелёным, а не жёлтым', () => {
    /* ГЛАВНАЯ ПРОВЕРКА. Жёлтый — цвет предупреждения, а предупреждать
       здесь не о чем: пароль прошёл все правила и дальше пускают.
       Сигнал о несуществующей задаче приучает не читать настоящие. */
    renderFields('Reka-7Lu')

    expect(verdict()).toHaveTextContent('Password is acceptable')
    expect(verdict().className).toContain('text-risk-low')
    expect(verdict().className).not.toContain('text-risk-medium')
  })

  it('хороший пароль подсвечивается тем же зелёным', () => {
    /* Разницу между «приемлемым» и «хорошим» несёт слово: она про запас
       прочности, а не про то, можно ли продолжать. */
    renderFields('Korova-7-Luna-Reka!')

    expect(verdict()).toHaveTextContent('Password is strong')
    expect(verdict().className).toContain('text-risk-low')
  })

  it('отвергнутый пароль остаётся красным и называет причину', () => {
    renderFields('abc')

    expect(verdict().className).toContain('text-risk-high')
    expect(verdict()).toHaveTextContent('at least 8 characters')
  })

  it('до ввода не говорит ничего', () => {
    renderFields('')

    expect(screen.queryByText(/^Password is/u)).not.toBeInTheDocument()
  })

  it('поле помечается ошибочным только при непригодном пароле', () => {
    const view = renderFields('abc')

    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true')

    view.rerender(
      <PasswordFields
        password="Reka-7Lu"
        confirmation=""
        onPasswordChange={() => undefined}
        onConfirmationChange={() => undefined}
      />,
    )

    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'false')
  })
})
