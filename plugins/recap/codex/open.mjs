#!/usr/bin/env node
// Opens the Codex companion page, starting its little server if needed.
//   node codex/open.mjs
import { port } from './core.mjs'
import { ensureServer, openPage } from './run.mjs'

await ensureServer()
openPage()
console.log(`✨ Next for Codex: http://127.0.0.1:${port()}/`)
