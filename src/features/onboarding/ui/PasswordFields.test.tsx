import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PasswordFields } from './PasswordFields'

function renderFields(password: string, confirmation = '') {
  return render(
    <PasswordFields
      password={password}
      confirmation={confirmation}
      onPasswordChange={() => undefined}
      onConfirmationChange={() => undefined}
    />,
  )
}

describe('PasswordFields', () => {
  it('не помечает простой пароль ошибкой', () => {
    renderFields('123456')

    expect(screen.getByLabelText('Password')).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText(/^Password is/u)).not.toBeInTheDocument()
  })

  it('до ввода не говорит ничего', () => {
    renderFields('')

    expect(screen.getByLabelText('Password')).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText(/do not match/i)).not.toBeInTheDocument()
  })

  it('сообщает о несовпадении подтверждения', () => {
    renderFields('123456', '123457')

    expect(screen.getByLabelText('Repeat the password')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('The passwords do not match')).toBeInTheDocument()
  })
})
