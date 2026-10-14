#!/usr/bin/env node
// Codex's Stop hook: Codex runs this when it finishes a turn. It hands the turn
// to brew.mjs in the background and returns at once, so Codex is never held up.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { places, recapEnv } from './core.mjs'
import { launch } from './run.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

let payload = {}
try {
  payload = JSON.parse(readFileSync(0, 'utf8') || '{}')
} catch {
  process.exit(0)
}

// The recap's own question to Codex must not set off another recap, and a Stop hook
// that already ran for this stop leaves it alone.
if (process.env.RECAP_CODEX_INNER === '1' || payload.stop_hook_active === true || !payload.cwd) process.exit(0)

const { codex } = places()
const pending = join(codex, 'pending')
mkdirSync(pending, { recursive: true })
const file = join(pending, `${Date.now()}-${String(payload.turn_id ?? 'turn').replace(/[^\w-]/g, '')}.json`)
writeFileSync(file, JSON.stringify({ payload, env: recapEnv() }))
launch(join(HERE, 'brew.mjs'), [file])
process.exit(0)
