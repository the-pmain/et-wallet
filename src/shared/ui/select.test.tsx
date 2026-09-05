import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { Label } from './label'
import { Select, type ISelectOption } from './select'

const OPTIONS: readonly ISelectOption[] = [
  { value: 'pending', label: 'pending' },
  { value: 'success', label: 'success' },
  { value: 'failure', label: 'failure' },
]

function BoundSelect() {
  const [value, setValue] = useState('success')

  return (
    <>
      <Label htmlFor="status">status</Label>
      <Select id="status" value={value} options={OPTIONS} onChange={setValue} />
    </>
  )
}

describe('Select', () => {
  it('opens the app list, not a native select', async () => {
    const user = userEvent.setup()

    render(<BoundSelect />)

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(document.querySelector('select')).toBeNull()

    await user.click(screen.getByLabelText('status'))

    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'success' })).toHaveAttribute('aria-selected', 'true')

    await user.click(screen.getByRole('option', { name: 'failure' }))

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByLabelText('status')).toHaveTextContent('failure')
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()

    render(<BoundSelect />)

    await user.click(screen.getByLabelText('status'))
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('selects an option with arrows and Enter', async () => {
    const user = userEvent.setup()

    render(<BoundSelect />)

    const trigger = screen.getByLabelText('status')
    trigger.focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    await user.keyboard('{ArrowDown}{Enter}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger).toHaveTextContent('failure')
  })
})
