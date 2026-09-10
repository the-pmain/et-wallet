import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { THEME_IDS, THEMES } from './themes'

const repositoryRoot = process.cwd()

describe('theme registry', () => {
  it('maps every theme to a complete isolated client root', () => {
    for (const theme of THEME_IDS) {
      const client = THEMES[theme]

      expect(client.root).toBe(`clients/${theme}`)
      expect(existsSync(resolve(repositoryRoot, client.root, 'index.html'))).toBe(true)
      expect(existsSync(resolve(repositoryRoot, client.root, 'src/app/main.tsx'))).toBe(true)
      expect(existsSync(resolve(repositoryRoot, client.root, 'public'))).toBe(true)
    }
  })

  it('does not reuse a browser-storage namespace', () => {
    const namespaces = THEME_IDS.map((theme) => THEMES[theme].storageNamespace)

    expect(new Set(namespaces).size).toBe(namespaces.length)
  })

  it('keeps the registry aligned with each client storage implementation', () => {
    for (const theme of THEME_IDS) {
      const client = THEMES[theme]
      const sourceRoot = resolve(repositoryRoot, client.root, 'src')
      const database = readFileSync(
        resolve(sourceRoot, 'core/storage/IndexedDbStorageService.ts'),
        'utf8',
      )
      const login = readFileSync(
        resolve(sourceRoot, 'features/onboarding/model/login-credentials.ts'),
        'utf8',
      )
      const admin = readFileSync(resolve(sourceRoot, 'features/admin/model/admin-pin.ts'), 'utf8')
      const broadcast = readFileSync(
        resolve(sourceRoot, 'features/onboarding/model/WalletBroadcast.ts'),
        'utf8',
      )

      expect(database).toContain(`DEFAULT_DATABASE_NAME = '${client.storageNamespace}'`)
      expect(login).toContain(`'${client.storageNamespace}.login-credentials'`)
      expect(admin).toContain(`'${client.storageNamespace}.admin-pin'`)
      expect(broadcast).toContain(`name = '${client.storageNamespace}'`)
    }
  })
})
