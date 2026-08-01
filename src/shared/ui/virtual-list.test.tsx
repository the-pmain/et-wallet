import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { VirtualList } from './virtual-list'

/** Строит список записей заданной длины. */
function items(count: number): readonly string[] {
  return Array.from({ length: count }, (_value, index) => `запись ${String(index + 1)}`)
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

describe('VirtualList: короткий список', () => {
  it('рисует все записи целиком', () => {
    /* До порога виртуализации список остаётся обычным: у него работают
       поиск браузера, печать и выделение мышью. */
    renderList(10)

    expect(screen.getAllByRole('listitem')).toHaveLength(10)
    expect(screen.getByText('запись 10')).toBeInTheDocument()
  })

  it('не выставляет размер списка отдельными признаками', () => {
    /* Полный список экранный диктор считает сам; `aria-setsize`
       нужен только там, где часть элементов отсутствует в документе. */
    renderList(3)

    expect(screen.getAllByRole('listitem')[0]).not.toHaveAttribute('aria-setsize')
  })
})

describe('VirtualList: длинный список', () => {
  it('рисует не все записи', () => {
    renderList(500)

    const rendered = screen.getAllByRole('listitem')

    expect(rendered.length).toBeGreaterThan(0)
    expect(rendered.length).toBeLessThan(500)
  })

  it('начинает с первой записи', () => {
    renderList(500)

    expect(screen.getByText('запись 1')).toBeInTheDocument()
  })

  it('сообщает экранному диктору полный размер списка', () => {
    /* Без этого диктор объявил бы «список из двадцати элементов» там,
       где их пятьсот. */
    renderList(500)

    const first = screen.getAllByRole('listitem')[0]

    expect(first).toHaveAttribute('aria-setsize', '500')
    expect(first).toHaveAttribute('aria-posinset', '1')
  })

  it('держит общую высоту списка отступами', () => {
    /* Полоса прокрутки обязана соответствовать полному числу записей:
       иначе страница «подпрыгивает» по мере отрисовки. */
    const { container } = renderList(500)
    const list = container.querySelector('ul')

    expect(list?.style.paddingBottom).not.toBe('')
    expect(Number.parseInt(list?.style.paddingBottom ?? '0', 10)).toBeGreaterThan(0)
  })

  it('порог задаётся вызывающим', () => {
    renderList(20, 100)

    expect(screen.getAllByRole('listitem')).toHaveLength(20)
  })

  it('не теряет содержимое строки', () => {
    renderList(500)

    const first = screen.getAllByRole('listitem')[0] as HTMLElement

    expect(within(first).getByText('запись 1')).toBeInTheDocument()
  })
})
