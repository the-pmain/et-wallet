import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { PasswordInput } from './password-input'

describe('PasswordInput', () => {
  it('toggles password visibility', async () => {
    const user = userEvent.setup()
    render(<PasswordInput id="pw" value="secret" onChange={() => undefined} />)

    const field = screen.getByLabelText('Show password')
    expect(screen.getByDisplayValue('secret')).toHaveAttribute('type', 'password')

    await user.click(field)

    expect(screen.getByDisplayValue('secret')).toHaveAttribute('type', 'text')
    expect(screen.getByLabelText('Hide password')).toBeInTheDocument()
  })
})
