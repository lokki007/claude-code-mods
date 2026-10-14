// The Codex side of recap, the parts with no side effects beyond files: reading
// a Codex turn from its transcript, where things are kept, and the one store
// file the companion page and the hook share.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname } from 'node:path'

import { SYSTEM, dataDir, projectKey, promptFor } from './logic.mjs'

/** Where everything lives. The log, diaries and pages are shared with the Claude Code pane. */
export const places = (home = process.env.RECAP_HOME || homedir()) => {
  const dir = dataDir(home)
  return {
    dir,
    log: `${dir}/log.jsonl`,
    codex: `${dir}/codex`,
    store: `${dir}/codex/store.json`,
    server: `${dir}/codex/server.json`,
  }
}

/** The port the companion page is served on (127.0.0.1 only). */
export const port = () => Number(process.env.RECAP_PORT) || 47823

/** The recap's own settings (RECAP_*), carried to processes started outside Codex. */
export const recapEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('RECAP_')))

// ---- reading a Codex turn ------------------------------------------------------------------

/** Text Codex adds to user messages itself, which is not the person's ask. */
const INJECTED = /^\s*(# AGENTS\.md|<environment_context>|<user_instructions>|<app-context>|<permissions|<turn_aborted>)/

const textOf = content => (Array.isArray(content) ? content : [])
  .map(c => (typeof c?.text === 'string' ? c.text : ''))
  .join('\n')
  .trim()

const first = (s, n = 90) => {
  const line = String(s ?? '').split('\n').find(l => l.trim()) ?? ''
  return line.length > n ? `${line.slice(0, n - 1)}…` : line.trim()
}

const READING = /^\s*(rg|grep|cat|type|head|tail|ls|dir|find|fd|sed\s+-n|Get-Content|Get-ChildItem|Select-String|git\s+(log|show|diff|status|grep))\b/i
const EDITING = /apply_patch|\*\*\* (Update|Add|Delete) File:|Set-Content|Out-File|Add-Content|writeFile(Sync)?\(|\bcp\b|\bmv\b|\brm\b|>\s*[\w./\\-]+\.\w+/

/** Transcript items that are tool calls. */
const TOOL_ITEMS = new Set(['function_call', 'custom_tool_call', 'local_shell_call', 'web_search_call'])

/** Files an apply_patch touches. */
const patchedFiles = text => [...String(text).matchAll(/\*\*\* (?:Update|Add|Delete) File: (.+)/g)].map(m => m[1].trim().split(/[\\/]/).pop())

/** One tool call as recap counts it: a step line, and whether it edited or looked something up. */
export const toolOf = payload => {
  const name = String(payload?.name ?? '')
  let input = payload?.input ?? payload?.arguments ?? ''
  if (typeof input === 'string' && input.trim().startsWith('{')) {
    try { input = JSON.parse(input) } catch { /* left as text */ }
  }
  const command = typeof input === 'object' && input !== null
    ? [input.command, input.cmd, input.code].flat().filter(Boolean).join(' ')
    : String(input)
  if (name === 'apply_patch' || /\*\*\* Begin Patch/.test(command)) {
    const files = patchedFiles(command)
    return { step: `Edited ${files.length > 0 ? files.slice(0, 3).join(', ') : 'files'}`, edit: true, research: false }
  }
  if (/web_search|search_query|open_page|fetch/i.test(name) || payload?.type === 'web_search_call') {
    return { step: `Looked up ${first(input?.query ?? input?.url ?? command, 60) || 'the web'}`, edit: false, research: true }
  }
  if (/^(shell|exec|exec_command|shell_command|local_shell|container\.exec)$/.test(name) || command) {
    if (EDITING.test(command)) return { step: `Changed files: ${first(command, 60)}`, edit: true, research: false }
    if (READING.test(command)) return { step: `Read: ${first(command, 60)}`, edit: false, research: true }
    return { step: `Ran: ${first(command, 60)}`, edit: false, research: false }
  }
  return { step: `Used ${name || 'a tool'}`, edit: false, research: false }
}

/**
 * The turn the Stop hook fired for, from the Codex transcript (one JSON object
 * per line): what the person asked, the steps, and the last reply. Lines from
 * earlier turns are skipped (the turn starts at its task_started event, or else
 * at the person's last message).
 */
export const readTurn = (jsonl, turnId) => {
  const rows = String(jsonl).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  let start = turnId ? rows.findIndex(r => r.type === 'event_msg' && r.payload?.type === 'task_started' && r.payload?.turn_id === turnId) : -1
  if (start < 0) {
    for (let i = rows.length - 1; i >= 0; i--) {
      const p = rows[i].payload
      if (rows[i].type === 'response_item' && p?.type === 'message' && p.role === 'user' && !INJECTED.test(textOf(p.content))) { start = i; break }
    }
  }
  const log = { ask: '', steps: [], edits: 0, research: 0, tools: 0 }
  let answer = ''
  for (const r of rows.slice(Math.max(0, start))) {
    const p = r.payload ?? {}
    if (r.type !== 'response_item') continue
    if (p.type === 'message' && p.role === 'user') {
      const text = textOf(p.content)
      if (!INJECTED.test(text) && !log.ask) log.ask = text.slice(0, 1200)
    } else if (p.type === 'message' && p.role === 'assistant') {
      const text = textOf(p.content)
      if (text) answer = text
    } else if (TOOL_ITEMS.has(p.type)) {
      const t = toolOf(p)
      log.steps = [...log.steps, t.step].slice(-40)
      log.tools += 1
      if (t.edit) log.edits += 1
      if (t.research) log.research += 1
    }
  }
  return { log, answer }
}

// ---- the recap request --------------------------------------------------------------------

/** What Codex is asked: the recap's own instructions, the turn, and a reminder to answer in JSON only. */
export const recapPrompt = (log, answer, saved = [], ideas = []) =>
  `${SYSTEM}\n\n${promptFor(log, answer, saved, ideas)}\n\nDo not change any files and do not run commands: just read the above and reply with the JSON only.`

// ---- the store ----------------------------------------------------------------------------

/**
 * One small JSON file shared by the hook and the page:
 *   projects[key] = { name, cwd, at, recap, backlog, client, streak, status }
 *   wins = ideas sent from the page, for other projects to borrow
 *   learned = how often each lane was picked
 */
export const emptyStore = () => ({ version: 1, projects: {}, wins: [], learned: {} })

export const loadStore = path => {
  try {
    const s = JSON.parse(readFileSync(path, 'utf8'))
    return { ...emptyStore(), ...s, projects: s.projects ?? {} }
  } catch {
    return emptyStore()
  }
}

/** Written whole and swapped in, so a reader never sees half a file. */
export const saveStore = (path, store) => {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(store))
  renameSync(tmp, path)
}

/** Changes the store under a simple lock-free read-modify-write (the hook and page rarely write together). */
export const updateStore = (path, fn) => {
  const store = loadStore(path)
  const next = fn(store) ?? store
  saveStore(path, next)
  return next
}

export const projectOf = (store, cwd) => {
  const key = projectKey(cwd)
  return store.projects[key] ?? null
}

/** Appends one line to the shared debug log (never throws). */
export const note = (logPath, project, event, detail = {}) => {
  try {
    mkdirSync(dirname(logPath), { recursive: true })
    const existing = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
    const lines = existing.split('\n').filter(Boolean)
    lines.push(JSON.stringify({ at: new Date().toISOString(), project, event, app: 'codex', ...detail }))
    writeFileSync(logPath, `${lines.slice(-2000).join('\n')}\n`)
  } catch { /* the log is a debugging aid */ }
}
