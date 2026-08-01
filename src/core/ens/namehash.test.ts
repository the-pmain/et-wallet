import { describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'

import { namehash, reverseNode } from './namehash'

/**
 * Эталонные значения из текста EIP-137.
 *
 * Стандарт приводит их как проверочные для реализации namehash. Это
 * единственные константы здесь, записанные строкой: всё остальное
 * вычисляется. Их правильность подтверждена живым запросом к реестру
 * ENS — вызов `resolver(namehash('vitalik.eth'))` возвращает
 * действующий резолвер, а тот даёт адрес, который обратным разрешением
 * возвращает то же имя.
 */
const VECTORS: readonly { name: string; node: string }[] = [
  { name: '', node: `0x${'0'.repeat(64)}` },
  { name: 'eth', node: '0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae' },
]

describe('namehash', () => {
  it.each(VECTORS)('соответствует эталону EIP-137 для "$name"', ({ name, node }) => {
    expect(namehash(name)).toBe(node)
  })

  it('различает имена, отличающиеся регистром', () => {
    /* Нормализация — задача отдельной функции. Хэш обязан оставаться
       чувствительным к байтам: скрыв здесь разницу регистра, мы
       спрятали бы и разницу между латинской и кириллической буквой. */
    expect(namehash('Vitalik.eth')).not.toBe(namehash('vitalik.eth'))
  })

  it('вложенное имя не совпадает с родительским', () => {
    expect(namehash('a.eth')).not.toBe(namehash('eth'))
  })

  it('порядок меток значим', () => {
    expect(namehash('a.b')).not.toBe(namehash('b.a'))
  })
})

describe('reverseNode', () => {
  it('не зависит от регистра адреса', () => {
    /* EIP-181 требует нижнего регистра. Адрес в записи EIP-55 дал бы
       другой узел — и «обратной записи нет» у адреса, у которого она
       есть. */
    const checksummed = toAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')

    expect(reverseNode(checksummed)).toBe(
      namehash('d8da6bf26964af9d7eed9e03e53415d37aa96045.addr.reverse'),
    )
  })

  it('разные адреса дают разные узлы', () => {
    const first = toAddress(`0x${'11'.repeat(20)}`)
    const second = toAddress(`0x${'22'.repeat(20)}`)

    expect(reverseNode(first)).not.toBe(reverseNode(second))
  })
})
