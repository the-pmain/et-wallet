import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveStaticRoot } from './staticRoot.ts'

describe('resolveStaticRoot', () => {
  it('без настроек и без поиска возвращает null', () => {
    expect(resolveStaticRoot({ configured: null, searchDefaults: false })).toBeNull()
  })

  it('принимает каталог с index.html', () => {
    const root = mkdtempSync(join(tmpdir(), 'wallet-static-'))

    writeFileSync(join(root, 'index.html'), '<html></html>')

    expect(resolveStaticRoot({ configured: root, searchDefaults: false })).toBe(root)
  })

  it('отвергает каталог без index.html', () => {
    const root = mkdtempSync(join(tmpdir(), 'wallet-static-empty-'))

    mkdirSync(join(root, 'assets'))

    expect(() => resolveStaticRoot({ configured: root, searchDefaults: false })).toThrow(/index\.html/u)
  })
})
