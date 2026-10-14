#!/usr/bin/env node
// The companion page for Codex: a tiny server on 127.0.0.1 that serves the page
// and the recap's state. Started by brew.mjs or open.mjs when needed.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadStore, note, places, port, updateStore } from './core.mjs'
import {
  DEFAULT_CLIENT, TONES, diaryFile, diaryHeader, diaryPage, forClient, learnFrom, plain, projectName, rememberWins, simplerPrompt,
  withHeader,
} from './logic.mjs'
import { askCodex } from './run.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
// Started outside Codex, the port comes as an argument.
const portArg = process.argv.indexOf('--port')
if (portArg > 0 && process.argv[portArg + 1]) process.env.RECAP_PORT = process.argv[portArg + 1]
const PORT = port()
const P = places()

/** Only this machine's browser, by name: no other site can talk to the server (DNS rebinding included). */
const LOCAL_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`])

const send = (res, status, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  })
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
}

const readBody = req => new Promise((resolve, reject) => {
  let raw = ''
  req.on('data', chunk => {
    raw += chunk
    if (raw.length > 200_000) reject(new Error('too large'))
  })
  req.on('end', () => {
    try { resolve(JSON.parse(raw || '{}')) } catch (err) { reject(err) }
  })
})

/** The project's diary header and web page, after the client's name changed. */
const refreshDiary = (cwd, client) => {
  const path = diaryFile(P.dir, cwd)
  if (!existsSync(path)) return
  const diary = withHeader(readFileSync(path, 'utf8'), diaryHeader(cwd, client.name))
  writeFileSync(path, diary)
  writeFileSync(path.replace(/\.md$/, '.html'), diaryPage(diary, projectName(cwd), client.name, new Date().toUTCString().replace(/ \d\d:\d\d:\d\d GMT$/, '')))
}

/** A saved option as the page sends it, tidied: never trust the shape. */
const tidyOption = o => ({
  id: plain(o?.id, 40), title: plain(o?.title, 90), detail: plain(o?.detail, 200), prompt: plain(o?.prompt, 300),
  lanes: Array.isArray(o?.lanes) ? o.lanes.filter(l => typeof l === 'string').slice(0, 3) : ['feature'],
  impact: Math.min(5, Math.max(1, Number(o?.impact) || 3)), effort: ['S', 'M', 'L'].includes(o?.effort) ? o.effort : 'M',
  needsYou: o?.needsYou === true, ...(o?.borrowed ? { borrowed: plain(o.borrowed, 60) } : {}),
  ...(o?.savedAt ? { savedAt: Number(o.savedAt) || Date.now() } : {}), ...(o?.pack ? { pack: plain(o.pack, 40) } : {}),
})

const routes = {
  'GET /': (req, res) => send(res, 200, readFileSync(join(HERE, 'page.html')), 'text/html; charset=utf-8'),
  'GET /page.js': (req, res) => send(res, 200, readFileSync(join(HERE, 'page.js')), 'text/javascript; charset=utf-8'),
  'GET /logic.mjs': (req, res) => send(res, 200, readFileSync(join(HERE, 'logic.mjs')), 'text/javascript; charset=utf-8'),
  'GET /api/ping': (req, res) => send(res, 200, { ok: true }),
  'GET /api/state': (req, res) => {
    const rev = existsSync(P.store) ? statSync(P.store).mtimeMs : 0
    send(res, 200, { rev, store: loadStore(P.store) })
  },
  'POST /api/backlog': async (req, res) => {
    const { key, backlog } = await readBody(req)
    updateStore(P.store, s => {
      if (s.projects[key]) s.projects[key].backlog = (Array.isArray(backlog) ? backlog : []).slice(0, 100).map(tidyOption)
    })
    send(res, 200, { ok: true })
  },
  'POST /api/client': async (req, res) => {
    const { key, name, signoff, tone } = await readBody(req)
    let project = null
    updateStore(P.store, s => {
      const p = s.projects[key]
      if (!p) return
      const was = { ...DEFAULT_CLIENT, ...(p.client ?? {}) }
      p.client = {
        name: name === undefined ? was.name : plain(name, 80),
        signoff: signoff === undefined ? was.signoff : plain(signoff, 80),
        tone: tone in TONES ? tone : was.tone,
      }
      project = p
    })
    if (project && name !== undefined) refreshDiary(project.cwd, project.client)
    send(res, 200, { ok: true })
  },
  'POST /api/sent': async (req, res) => {
    const { key, picked } = await readBody(req)
    const options = (Array.isArray(picked) ? picked : []).slice(0, 20).map(tidyOption)
    updateStore(P.store, s => {
      const p = s.projects[key]
      if (!p) return
      s.wins = rememberWins(s.wins ?? [], options, p.name, Date.now())
      s.learned = learnFrom(s.learned ?? {}, options)
    })
    note(P.log, key, 'prompt-copied', { options: options.length })
    send(res, 200, { ok: true })
  },
  'POST /api/learned/reset': async (req, res) => {
    updateStore(P.store, s => { s.learned = {} })
    send(res, 200, { ok: true })
  },
  'POST /api/simpler': async (req, res) => {
    const { key } = await readBody(req)
    const p = loadStore(P.store).projects[key]
    if (!p?.recap) return send(res, 404, { error: 'no recap' })
    if (p.simpler?.turnId === p.turnId && p.simpler.text) return send(res, 200, { text: p.simpler.text })
    const body = (p.recap.client && p.recap.client.trim()) || forClient(p.recap.tldr)
    const reply = await askCodex(simplerPrompt(body), p.cwd, { timeoutMs: 3 * 60_000 })
    const text = reply.isAnswered ? forClient(plain(reply.text.replace(/^"+|"+$/g, ''), 700)) : ''
    if (!text) {
      note(P.log, key, 'simpler-failed', { why: reply.why })
      return send(res, 502, { error: 'Codex could not rewrite it this time' })
    }
    updateStore(P.store, s => { if (s.projects[key]) s.projects[key].simpler = { turnId: p.turnId, text } })
    note(P.log, key, 'simpler-ready', {})
    send(res, 200, { text })
  },
  'GET /api/page': (req, res, url) => {
    const p = loadStore(P.store).projects[url.searchParams.get('key') ?? '']
    const path = p ? diaryFile(P.dir, p.cwd).replace(/\.md$/, '.html') : ''
    if (!path || !existsSync(path)) return send(res, 404, 'No progress page yet.', 'text/plain; charset=utf-8')
    send(res, 200, readFileSync(path), 'text/html; charset=utf-8')
  },
}

export const server = createServer(async (req, res) => {
  try {
    if (!LOCAL_HOSTS.has(String(req.headers.host))) return send(res, 403, { error: 'local only' })
    // Writes must come from the page itself.
    if (req.method !== 'GET') {
      const origin = String(req.headers.origin ?? '')
      if (origin && !LOCAL_HOSTS.has(origin.replace(/^https?:\/\//, ''))) return send(res, 403, { error: 'local only' })
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return send(res, 415, { error: 'json only' })
    }
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const route = routes[`${req.method} ${url.pathname}`]
    if (!route) return send(res, 404, { error: 'not found' })
    await route(req, res, url)
  } catch (err) {
    send(res, 500, { error: err instanceof Error ? err.message : String(err) })
  }
})

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.on('error', err => {
    // Another copy already serves the page: nothing to do.
    if (err.code === 'EADDRINUSE') process.exit(0)
    throw err
  })
  server.listen(PORT, '127.0.0.1', () => {
    mkdirSync(P.codex, { recursive: true })
    writeFileSync(P.server, JSON.stringify({ pid: process.pid, port: PORT, at: Date.now() }))
  })
}
