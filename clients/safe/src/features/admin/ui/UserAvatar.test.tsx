import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { UserAvatar } from './UserAvatar'

function avatarSignature(element: HTMLElement): string {
  return Array.from(element.querySelectorAll('rect'))
    .map(
      (rect) =>
        `${rect.getAttribute('x') ?? ''}:${rect.getAttribute('y') ?? ''}:${rect.getAttribute('fill') ?? ''}`,
    )
    .join('|')
}

describe('UserAvatar', () => {
  it('draws the same pattern for the same record', () => {
    const first = render(<UserAvatar userId="51" email="james@example.com" />)
    const firstSignature = avatarSignature(first.container)
    first.unmount()

    const second = render(<UserAvatar userId="51" email="james@example.com" />)

    expect(avatarSignature(second.container)).toBe(firstSignature)
    expect(second.getByRole('img', { name: 'Avatar for james@example.com' })).toBeInTheDocument()
  })

  it('distinguishes different records', () => {
    const first = render(<UserAvatar userId="51" email="james@example.com" />)
    const firstSignature = avatarSignature(first.container)
    first.unmount()

    const second = render(<UserAvatar userId="52" email="james@example.com" />)

    expect(avatarSignature(second.container)).not.toBe(firstSignature)
  })
})
