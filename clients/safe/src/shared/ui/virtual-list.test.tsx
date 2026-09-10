import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { VirtualList } from './virtual-list'

function items(count: number): readonly string[] {
  return Array.from({ length: count }, (_value, index) => `record ${String(index + 1)}`)
}

function renderList(count: number, threshold?: number) {
  return render(
    <VirtualList
      items={items(count)}
      itemHeight={64}
      renderItem={(item) => <span>{item}</span>}
      getKey={(item) => item}
      {...(threshold === undefined ? {} : { threshold })}
    />,
  )
}

describe('VirtualList: short list', () => {
  it('draws every record in full', () => {
    /* Below the virtualization threshold the list stays ordinary:
       browser find, print, and mouse selection still work. */
    renderList(10)

    expect(screen.getAllByRole('listitem')).toHaveLength(10)
    expect(screen.getByText('record 10')).toBeInTheDocument()
  })

  it('does not set list size with extra attributes', () => {
    /* A full list the screen reader counts itself; `aria-setsize`
       is needed only where some items are missing from the document. */
    renderList(3)

    expect(screen.getAllByRole('listitem')[0]).not.toHaveAttribute('aria-setsize')
  })
})

describe('VirtualList: long list', () => {
  it('does not draw every record', () => {
    renderList(500)

    const rendered = screen.getAllByRole('listitem')

    expect(rendered.length).toBeGreaterThan(0)
    expect(rendered.length).toBeLessThan(500)
  })

  it('starts at the first record', () => {
    renderList(500)

    expect(screen.getByText('record 1')).toBeInTheDocument()
  })

  it('tells the screen reader the full list size', () => {
    /* Without this the reader would announce “list of twenty items”
       where there are five hundred. */
    renderList(500)

    const first = screen.getAllByRole('listitem')[0]

    expect(first).toHaveAttribute('aria-setsize', '500')
    expect(first).toHaveAttribute('aria-posinset', '1')
  })

  it('keeps the full list height with padding', () => {
    /* The scrollbar must match the full record count: otherwise the
       page “jumps” as rows are drawn. */
    const { container } = renderList(500)
    const list = container.querySelector('ul')

    expect(list?.style.paddingBottom).not.toBe('')
    expect(Number.parseInt(list?.style.paddingBottom ?? '0', 10)).toBeGreaterThan(0)
  })

  it('lets the caller set the threshold', () => {
    renderList(20, 100)

    expect(screen.getAllByRole('listitem')).toHaveLength(20)
  })

  it('does not lose row content', () => {
    renderList(500)

    const first = screen.getAllByRole('listitem')[0] as HTMLElement

    expect(within(first).getByText('record 1')).toBeInTheDocument()
  })
})
