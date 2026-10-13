#!/usr/bin/env node
// Copies the shared test helpers into each mod's hooks folder.
//
//   node scripts/sync-shared.mjs           copy where missing or different
//   node scripts/sync-shared.mjs --check   only report; exit 1 if any copy drifted
//
// Each mod is installed on its own, so it carries its own copy; this keeps
// every copy identical to shared/.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHARED = [{ from: 'shared/test-helpers.ts', to: 'hooks/test-helpers.ts' }]
const BANNER = '// Copied from shared/ by scripts/sync-shared.mjs: edit the original there, not this copy.\n'

/** The mods that use the shared helpers: the ones whose tests import them. */
export const modsUsingShared = () =>
  readdirSync(join(ROOT, 'plugins')).filter(mod => {
    const hooks = join(ROOT, 'plugins', mod, 'hooks')
    return existsSync(hooks) && readdirSync(hooks).some(f => f.endsWith('.test.ts') && readFileSync(join(hooks, f), 'utf8').includes("from './test-helpers'"))
  })

/** Syncs one mod (or checks it); returns the files that were, or would be, changed. */
export const syncShared = (mod, { check = false } = {}) => {
  const changed = []
  for (const { from, to } of SHARED) {
    const want = BANNER + readFileSync(join(ROOT, from), 'utf8')
    const path = join(ROOT, 'plugins', mod, to)
    const have = existsSync(path) ? readFileSync(path, 'utf8') : null
    if (have === want) continue
    changed.push(join('plugins', mod, to))
    if (!check) writeFileSync(path, want)
  }
  return changed
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes('--check')
  const changed = modsUsingShared().flatMap(mod => syncShared(mod, { check }))
  if (changed.length === 0) console.log('✔ shared helpers are in sync')
  else console.log(`${check ? '✘ out of sync' : '✔ synced'}: ${changed.join(', ')}`)
  process.exit(check && changed.length > 0 ? 1 : 0)
}
