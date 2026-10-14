// Tests for the Codex side of recap:  node --test codex/test/
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CODEX = join(HERE, '..')
const PLUGIN = join(CODEX, '..')

// Every test works in its own throwaway home, with a fake Codex and no browser.
const home = mkdtempSync(join(tmpdir(), 'recap-codex-test-'))
const port = 47900 + Math.floor(Math.random() * 90)
Object.assign(process.env, { RECAP_HOME: home, RECAP_NO_OPEN: '1', RECAP_NO_SERVER: '1', RECAP_PORT: String(port) })

const { places, readTurn, toolOf, loadStore, recapPrompt } = await import('../core.mjs')
const { writeFakeCodex } = await import('../run.mjs')
const { brew } = await import('../brew.mjs')

const OPTIONS = [
  { title: 'Add opening hours to the page', detail: 'Visitors look for them first.', lanes: ['feature', 'design'], impact: 5, effort: 'S', needs_you: true, prompt: 'Add the bakery opening hours to the welcome page' },
  { title: 'Check the page on phones', detail: 'Most visitors use a phone.', lanes: ['fix', 'design'], impact: 4, effort: 'S', needs_you: false, prompt: 'Check the welcome page on a phone-sized screen and fix anything cramped' },
  { title: 'Weekly specials email', detail: 'Brings people back.', lanes: ['growth', 'money'], impact: 4, effort: 'M', needs_you: true, prompt: 'Add a sign-up for a weekly specials email', borrowed: 'shop' },
]
const REPLY = JSON.stringify({
  tldr: 'Wrote the welcome page for the bakery site.', verdict: 'done', verdict_why: 'Page created and checked.',
  client: 'Your website now has a warm welcome page. It greets visitors in index.html and invites them in.', options: OPTIONS,
})
const fakeDir = mkdtempSync(join(tmpdir(), 'recap-fake-codex-'))
process.env.RECAP_CODEX_BIN = writeFakeCodex(fakeDir, REPLY)

/** A Codex transcript: an earlier turn, then this one with a patch, a search and a reply. */
const transcript = (turnId, { edits = true } = {}) => [
  { type: 'event_msg', payload: { type: 'task_started', turn_id: 'old-turn' } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'an older ask' }] } },
  { type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch\n*** Update File: old.txt\n*** End Patch' } },
  { type: 'event_msg', payload: { type: 'task_started', turn_id: turnId } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions\n<INSTRUCTIONS>be nice</INSTRUCTIONS>' }] } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Make a welcome page for the bakery' }] } },
  { type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['rg', 'welcome'] }) } },
  ...(edits ? [{ type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch\n*** Add File: site/index.html\n+hi\n*** End Patch' } }] : []),
  { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done: the welcome page is in place.' }] } },
].map(r => JSON.stringify(r)).join('\n')

const project = mkdtempSync(join(tmpdir(), 'bakery-'))
const turnFile = (turnId, opts) => {
  const path = join(fakeDir, `${turnId}.jsonl`)
  writeFileSync(path, transcript(turnId, opts))
  return path
}

after(() => {
  for (const dir of [home, fakeDir, project]) rmSync(dir, { recursive: true, force: true })
})

describe('reading a Codex turn', () => {
  test('only this turn counts: the ask, a search, an edit and the reply', () => {
    const { log, answer } = readTurn(transcript('t1'), 't1')
    assert.equal(log.ask, 'Make a welcome page for the bakery')
    assert.deepEqual(log.steps, ['Read: rg welcome', 'Edited index.html'])
    assert.deepEqual([log.edits, log.research, log.tools], [1, 1, 2])
    assert.equal(answer, 'Done: the welcome page is in place.')
  })

  test('without a turn id the last real ask starts the turn', () => {
    const { log } = readTurn(transcript('t1'), undefined)
    assert.equal(log.ask, 'Make a welcome page for the bakery')
    assert.equal(log.edits, 1)
  })

  test('tool calls read as plain steps', () => {
    assert.deepEqual(toolOf({ name: 'shell', arguments: '{"command":["Get-Content","a.md"]}' }), { step: 'Read: Get-Content a.md', edit: false, research: true })
    assert.equal(toolOf({ name: 'exec_command', arguments: '{"cmd":"npm test"}' }).step, 'Ran: npm test')
    assert.equal(toolOf({ name: 'shell', arguments: '{"command":"Set-Content x.txt hi"}' }).edit, true)
    assert.equal(toolOf({ type: 'web_search_call', name: 'web_search', arguments: '{"query":"bakery hours"}' }).research, true)
    assert.equal(toolOf({ name: 'spawn_agent', arguments: '{}' }).step, 'Used spawn_agent')
  })

  test('the request asks for JSON only and never for changes', () => {
    const p = recapPrompt({ ask: 'x', steps: ['Edited a'], edits: 1, research: 0, tools: 1 }, 'done', [], [{ title: 'Weekly specials email', project: 'shop' }])
    assert.match(p, /Reply with JSON only/)
    assert.match(p, /Do not change any files/)
    assert.match(p, /- Weekly specials email \(from shop\)/)
  })
})

describe('a finished Codex turn', () => {
  test('becomes a recap, a client diary entry and a progress page, once', async () => {
    const P = places()
    const result = await brew({ cwd: project, turn_id: 't1', transcript_path: turnFile('t1'), last_assistant_message: 'Done: the welcome page is in place.' })
    assert.equal(result.status, 'ready')
    const store = loadStore(P.store)
    const p = Object.values(store.projects)[0]
    assert.equal(p.status, 'ready')
    assert.equal(p.recap.options.length, 3)
    assert.equal(p.recap.options[2].borrowed, undefined, 'only projects the model was shown may be credited')
    assert.equal(p.streak, 1)
    // The client note is cleaned of file names.
    assert.equal(p.recap.client, 'Your website now has a warm welcome page. It greets visitors and invites them in.')
    // What Codex was asked.
    assert.match(readFileSync(join(fakeDir, 'asked.txt'), 'utf8'), /Make a welcome page for the bakery/)

    const diaryDir = join(P.dir, 'diary')
    const md = readdirSync(diaryDir).find(f => f.endsWith('.md'))
    const diary = readFileSync(join(diaryDir, md), 'utf8')
    assert.match(diary, /\*\*✅ Done\.\*\* Your website now has a warm welcome page\./)
    assert.match(diary, /\*\*Coming up next:\*\* /)
    assert.ok(existsSync(join(diaryDir, md.replace(/\.md$/, '.html'))))

    // The same turn again (Codex retried the hook) adds no second entry.
    await brew({ cwd: project, turn_id: 't1', transcript_path: turnFile('t1'), last_assistant_message: 'Done.' })
    assert.equal(readFileSync(join(diaryDir, md), 'utf8').match(/\n## /g).length, 1)

    const log = readFileSync(P.log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    assert.deepEqual(log.slice(0, 2).map(l => l.event), ['turn-recapped', 'recap-ready'])
    assert.ok(log.every(l => l.app === 'codex'))
  })

  test('a turn with nothing changed gets no recap, and says why', async () => {
    const result = await brew({ cwd: project, turn_id: 't2', transcript_path: turnFile('t2', { edits: false }), last_assistant_message: 'Here is what I found.' })
    assert.deepEqual(result, { status: 'skipped', why: 'too little was changed or looked up' })
    const p = Object.values(loadStore(places().store).projects)[0]
    assert.equal(p.skipped.why, 'too little was changed or looked up')
    assert.equal(p.status, 'ready', 'the last recap stays on show')
  })

  test('when Codex cannot answer, the page says so and the log says why', async () => {
    const before = process.env.RECAP_CODEX_BIN
    process.env.RECAP_CODEX_BIN = writeFakeCodex(mkdtempSync(join(tmpdir(), 'recap-fake-bad-')), 'not json at all')
    try {
      const result = await brew({ cwd: project, turn_id: 't3', transcript_path: turnFile('t3'), last_assistant_message: 'Done.' })
      assert.equal(result.status, 'error')
      const p = Object.values(loadStore(places().store).projects)[0]
      assert.equal(p.status, 'error')
      assert.match(p.error, /not in a form the recap could read/)
    } finally {
      process.env.RECAP_CODEX_BIN = before
    }
  })
})

describe('the Stop hook', () => {
  const runHook = (payload, env = {}) => spawnSync(process.execPath, [join(CODEX, 'stop.mjs')], {
    input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, ...env }, timeout: 15_000,
  })

  test('returns at once and leaves the recap to the background', async () => {
    const started = Date.now()
    const run = runHook({ cwd: project, turn_id: 't4', transcript_path: turnFile('t4'), last_assistant_message: 'Done.', hook_event_name: 'Stop' })
    assert.equal(run.status, 0)
    assert.equal(run.stdout, '')
    assert.ok(Date.now() - started < 5000)
    for (let i = 0; i < 60; i++) {
      if (loadStore(places().store).projects[Object.keys(loadStore(places().store).projects)[0]]?.turnId === 't4'
        && loadStore(places().store).projects[Object.keys(loadStore(places().store).projects)[0]]?.status === 'ready') break
      await new Promise(r => setTimeout(r, 250))
    }
    const p = Object.values(loadStore(places().store).projects)[0]
    assert.deepEqual([p.turnId, p.status], ['t4', 'ready'])
  })

  test('stays quiet for the recap\'s own question to Codex, and on a repeated stop', () => {
    const pending = join(places().codex, 'pending')
    const count = () => (existsSync(pending) ? readdirSync(pending).length : 0)
    const was = count()
    assert.equal(runHook({ cwd: project, turn_id: 't5' }, { RECAP_CODEX_INNER: '1' }).status, 0)
    assert.equal(runHook({ cwd: project, turn_id: 't6', stop_hook_active: true }).status, 0)
    assert.equal(runHook('not json').status, 0)
    assert.equal(count(), was)
  })
})

describe('the companion page server', () => {
  let server
  const call = (method, path, body, headers = {}) => new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body)
    const req = request({ host: '127.0.0.1', port, path, method, headers: { host: `127.0.0.1:${port}`, ...(data ? { 'content-type': 'application/json' } : {}), ...headers } }, res => {
      let text = ''
      res.on('data', d => { text += d })
      res.on('end', () => resolve({ status: res.statusCode, text, type: res.headers['content-type'], csp: res.headers['content-security-policy'] }))
    })
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })

  before(async () => {
    ({ server } = await import('../server.mjs'))
    await new Promise(r => server.listen(port, '127.0.0.1', r))
  })
  after(() => server.close())

  test('serves the page, its script and the shared logic, locked to this machine', async () => {
    const page = await call('GET', '/')
    assert.equal(page.status, 200)
    assert.match(page.text, /<script type="module" src="\/page.js">/)
    assert.match(page.csp, /default-src 'self'/)
    assert.equal((await call('GET', '/page.js')).status, 200)
    assert.match((await call('GET', '/logic.mjs')).text, /export \{/)
    assert.equal((await call('GET', '/', undefined, { host: 'evil.example' })).status, 403)
    assert.equal((await call('POST', '/api/client', { key: 'x' }, { origin: 'https://evil.example' })).status, 403)
    assert.equal((await call('POST', '/api/client', undefined, { 'content-type': 'text/plain' })).status, 415)
  })

  test('the state, client settings, saved options and sent ideas round-trip', async () => {
    const state = JSON.parse((await call('GET', '/api/state')).text)
    const [key, p] = Object.entries(state.store.projects)[0]
    assert.equal(p.status, 'ready')

    assert.equal((await call('POST', '/api/client', { key, name: 'Maya <b>', tone: 'formal' })).status, 200)
    const after1 = loadStore(places().store).projects[key]
    assert.deepEqual(after1.client, { name: 'Maya', signoff: '', tone: 'formal' })
    const md = readdirSync(join(places().dir, 'diary')).find(f => f.endsWith('.md'))
    assert.match(readFileSync(join(places().dir, 'diary', md), 'utf8'), /^# bakery-\w+: progress updates for Maya\n/)

    await call('POST', '/api/backlog', { key, backlog: [{ ...p.recap.options[0], savedAt: 5, title: '<i>Hours</i>' }] })
    assert.equal(loadStore(places().store).projects[key].backlog[0].title, 'Hours')

    await call('POST', '/api/sent', { key, picked: [p.recap.options[2]] })
    const s = loadStore(places().store)
    assert.equal(s.wins[0].title, 'Weekly specials email')
    assert.ok((s.learned.growth ?? 0) >= 1)

    const page = await call('GET', `/api/page?key=${encodeURIComponent(key)}`)
    assert.equal(page.status, 200)
    assert.match(page.text, /For Maya/)
  })
})

describe('the plugin', () => {
  test('Codex and Claude see the same version, and Codex runs the Stop hook', () => {
    const claude = JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8'))
    const codex = JSON.parse(readFileSync(join(PLUGIN, '.codex-plugin', 'plugin.json'), 'utf8'))
    assert.equal(codex.version, claude.version)
    assert.equal(codex.hooks, './codex/hooks.json')
    const hooks = JSON.parse(readFileSync(join(CODEX, 'hooks.json'), 'utf8'))
    assert.match(hooks.hooks.Stop[0].hooks[0].command, /stop\.mjs/)
    assert.equal(existsSync(join(CODEX, 'logic.mjs')), true)
  })
})

mkdirSync(home, { recursive: true })
