import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const script = process.argv[2]

if (script === undefined || script.endsWith(':themes')) {
  throw new Error('Pass a non-matrix npm script, for example: test or build.')
}

const themes = JSON.parse(await readFile(resolve(root, 'build/themes.json'), { encoding: 'utf8' }))
const npmCli = process.env.npm_execpath

if (npmCli === undefined) {
  throw new Error('This script must be started through npm.')
}

for (const theme of Object.keys(themes)) {
  console.log(`\n> THEME=${theme} npm run ${script}`)

  const result = spawnSync(process.execPath, [npmCli, 'run', script], {
    cwd: root,
    env: { ...process.env, THEME: theme },
    stdio: 'inherit',
  })

  if (result.error !== undefined) {
    throw result.error
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}
