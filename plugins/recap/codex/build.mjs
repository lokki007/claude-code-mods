#!/usr/bin/env node
// Bundles the recap's pure logic (hooks/recap.ts, client.ts, journal.ts) into
// codex/logic.mjs for the Codex companion, so both apps share one copy of it.
//
//   node codex/build.mjs           rebuild
//   node codex/build.mjs --check   exit 1 if logic.mjs is out of date
import { execSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, 'logic.mjs')
const BANNER = '// Built by codex/build.mjs from hooks/recap.ts, client.ts and journal.ts: edit those, then rebuild.\n'

const work = mkdtempSync(join(tmpdir(), 'recap-codex-build-'))
try {
  const tmp = join(work, 'logic.mjs')
  const q = s => `"${s}"`
  // One command line: npx is a .cmd script on Windows, which only runs through a shell.
  execSync([
    'npx', '-y', 'esbuild@0.24.0', q(join(HERE, 'src', 'logic.ts')),
    '--bundle', '--format=esm', '--platform=neutral', '--target=es2022', `--outfile=${q(tmp)}`, '--log-level=warning',
  ].join(' '), { stdio: ['ignore', 'inherit', 'inherit'], cwd: HERE })
  const built = BANNER + readFileSync(tmp, 'utf8').replace(/\r\n/g, '\n')
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : ''
  if (process.argv.includes('--check')) {
    if (built !== current) {
      console.error('✘ codex/logic.mjs is out of date: run node codex/build.mjs')
      process.exit(1)
    }
    console.log('✔ codex/logic.mjs is up to date')
  } else {
    writeFileSync(OUT, built)
    console.log(`✔ built ${OUT}`)
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
