import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveStaticRoot } from './staticRoot.ts'

describe('resolveStaticRoot', () => {
  it('without config and without search returns null', () => {
    expect(resolveStaticRoot({ configured: null, searchDefaults: false })).toBeNull()
  })

  it('accepts a directory with index.html', () => {
    const root = mkdtempSync(join(tmpdir(), 'wallet-static-'))

    writeFileSync(join(root, 'index.html'), '<html></html>')

    expect(resolveStaticRoot({ configured: root, searchDefaults: false })).toBe(root)
  })

  it('rejects a directory without index.html', () => {
    const root = mkdtempSync(join(tmpdir(), 'wallet-static-empty-'))

    mkdirSync(join(root, 'assets'))

    expect(() => resolveStaticRoot({ configured: root, searchDefaults: false })).toThrow(/index\.html/u)
  })
})
