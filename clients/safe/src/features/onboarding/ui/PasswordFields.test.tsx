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
  it('does not mark a simple password as an error', () => {
    renderFields('123456')

    expect(screen.getByLabelText('Password')).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText(/^Password is/u)).not.toBeInTheDocument()
  })

  it('says nothing before input', () => {
    renderFields('')

    expect(screen.getByLabelText('Password')).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText(/do not match/i)).not.toBeInTheDocument()
  })

  it('reports a confirmation mismatch', () => {
    renderFields('123456', '123457')

    expect(screen.getByLabelText('Repeat the password')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('The passwords do not match')).toBeInTheDocument()
  })
})
