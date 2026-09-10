import { describe, expect, it } from 'vitest'

import { SecretBufferWipedError } from '@/core/errors'

import { SecretBuffer } from './SecretBuffer'

describe('SecretBuffer: создание', () => {
  it('принимает владение переданным массивом', () => {
    const source = new Uint8Array([1, 2, 3])
    const buffer = SecretBuffer.own(source)

    expect(buffer.bytes).toBe(source)
  })

  it('затирает исходный массив при own', () => {
    const source = new Uint8Array([1, 2, 3])
    SecretBuffer.own(source).wipe()

    expect([...source]).toEqual([0, 0, 0])
  })

  it('создаёт независимую копию при copyOf', () => {
    const source = new Uint8Array([1, 2, 3])
    const buffer = SecretBuffer.copyOf(source)
    buffer.wipe()

    expect([...source]).toEqual([1, 2, 3])
  })

  /* Сравнение через развёртывание в обычный массив, а не toEqual
     на Uint8Array: TextEncoder в jsdom возвращает типизированный массив
     из другого realm, и прямое сравнение объектов даёт ложный отказ.
     В браузере такой проблемы нет — это особенность тестовой среды. */
  it('кодирует текст в UTF-8', () => {
    const buffer = SecretBuffer.fromUtf8('abc')

    expect([...buffer.bytes]).toEqual([97, 98, 99])
  })

  it('корректно кодирует многобайтовые символы', () => {
    const buffer = SecretBuffer.fromUtf8('тест')

    expect(buffer.byteLength).toBe(8)
  })

  it('выделяет нулевой буфер заданного размера', () => {
    expect([...SecretBuffer.allocate(4).bytes]).toEqual([0, 0, 0, 0])
  })
})

describe('SecretBuffer: затирание', () => {
  it('обнуляет содержимое', () => {
    const source = new Uint8Array([9, 9, 9, 9])
    SecretBuffer.own(source).wipe()

    expect(source.every((byte) => byte === 0)).toBe(true)
  })

  it('помечает буфер затёртым', () => {
    const buffer = SecretBuffer.fromUtf8('секрет')
    buffer.wipe()

    expect(buffer.isWiped).toBe(true)
  })

  it('отказывает в доступе к содержимому после затирания', () => {
    const buffer = SecretBuffer.fromUtf8('секрет')
    buffer.wipe()

    expect(() => buffer.bytes).toThrow(SecretBufferWipedError)
  })

  it('допускает повторное затирание', () => {
    const buffer = SecretBuffer.fromUtf8('секрет')
    buffer.wipe()

    expect(() => {
      buffer.wipe()
    }).not.toThrow()
  })

  it('сообщает нулевой размер после затирания', () => {
    const buffer = SecretBuffer.fromUtf8('секрет')
    buffer.wipe()

    expect(buffer.byteLength).toBe(0)
  })
})

describe('SecretBuffer: защита от случайной утечки', () => {
  /* Прямая подстановка `${buffer}` в шаблон здесь не проверяется:
     правило ESLint `restrict-template-expressions` запрещает подставлять
     в шаблонную строку значение, не являющееся строкой или числом.
     То есть от этого конкретного способа утечки защищает линтер, а
     переопределённый toString закрывает остальные пути — String(),
     конкатенацию и Array.prototype.join. */
  it('не раскрывает содержимое при приведении к строке', () => {
    const buffer = SecretBuffer.fromUtf8('очень секретная фраза')

    expect(String(buffer)).toBe('[SECRET]')
    expect(buffer.toString()).not.toContain('секретная')
  })

  it('не раскрывает содержимое при конкатенации', () => {
    const buffer = SecretBuffer.fromUtf8('очень секретная фраза')

    expect(['seed:', buffer].join(' ')).toBe('seed: [SECRET]')
  })

  it('не раскрывает содержимое при JSON.stringify', () => {
    const buffer = SecretBuffer.fromUtf8('очень секретная фраза')
    const state = { mnemonic: buffer, other: 1 }

    expect(JSON.stringify(state)).not.toContain('секретная')
    expect(JSON.stringify(state)).toContain('[SECRET]')
  })

  it('не раскрывает содержимое в массиве', () => {
    const buffers = [SecretBuffer.fromUtf8('слово')]

    expect(JSON.stringify(buffers)).toBe('["[SECRET]"]')
  })
})
