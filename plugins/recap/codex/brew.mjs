#!/usr/bin/env node
// Turns one finished Codex turn into a recap, in the background:
//   node brew.mjs <pending turn file written by stop.mjs>
// It reads the turn, asks Codex for the options (the same request the Claude pane
// makes), keeps the result for the companion page, adds the client diary entry
// and progress page (shared with the Claude pane), and logs every step.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadStore, note, places, readTurn, recapPrompt, updateStore } from './core.mjs'
import {
  DEFAULT_CLIENT, borrowable, diaryEntry, diaryFile, diaryHeader, diaryPage, isWorthRecap, nextStreak, parseTakes, projectKey,
  projectName, ranked, skipReason, withHeader,
} from './logic.mjs'
import { askCodex, ensureServer, openPage } from './run.mjs'

/** The project's diary and its web page, with this recap added once. */
export const writeDiary = (dir, cwd, recap, client, at) => {
  const path = diaryFile(dir, cwd)
  mkdirSync(dirname(path), { recursive: true })
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const diary = withHeader(existing, diaryHeader(cwd, client.name)) + diaryEntry(recap, at, ranked(recap.options, {})[0]?.title)
  writeFileSync(path, diary)
  const updated = new Date(at).toUTCString().replace(/ \d\d:\d\d:\d\d GMT$/, '')
  writeFileSync(path.replace(/\.md$/, '.html'), diaryPage(diary, projectName(cwd), client.name, updated))
  return path
}

export const brew = async payload => {
  const P = places()
  const cwd = String(payload.cwd)
  const key = projectKey(cwd)
  const name = projectName(cwd)
  const turnId = String(payload.turn_id ?? `turn-${Date.now().toString(36)}`)
  const transcript = payload.transcript_path && existsSync(payload.transcript_path) ? readFileSync(payload.transcript_path, 'utf8') : ''
  const turn = readTurn(transcript, payload.turn_id)
  const answer = String(payload.last_assistant_message ?? '') || turn.answer
  const { log } = turn

  if (!isWorthRecap(log, answer, false)) {
    const why = skipReason(log, answer, false) ?? 'it did not qualify'
    note(P.log, key, 'turn-skipped', { turnId, why, edits: log.edits, research: log.research, tools: log.tools })
    updateStore(P.store, s => {
      s.projects[key] = { ...(s.projects[key] ?? {}), name, cwd, skipped: { at: Date.now(), why } }
    })
    return { status: 'skipped', why }
  }

  note(P.log, key, 'turn-recapped', { turnId, edits: log.edits, research: log.research, tools: log.tools })
  updateStore(P.store, s => {
    s.projects[key] = { ...(s.projects[key] ?? {}), name, cwd, at: Date.now(), status: 'brewing', turnId, ask: log.ask, skipped: null }
  })
  // The page comes up with the first recap (not in tests: RECAP_NO_SERVER=1).
  if (process.env.RECAP_NO_SERVER !== '1' && await ensureServer()) openPage()

  const store = loadStore(P.store)
  const saved = store.projects[key]?.backlog ?? []
  const ideas = borrowable(store.wins ?? [], name)
  const reply = await askCodex(recapPrompt(log, answer, saved, ideas), cwd)
  const takes = reply.isAnswered ? parseTakes(reply.text, [...new Set(ideas.map(i => i.project))]) : null
  const at = Date.now()

  if (takes === null) {
    const why = reply.isAnswered ? 'Codex answered, but not in a form the recap could read' : `Codex could not answer (${reply.why})`
    note(P.log, key, 'recap-failed', { turnId, why })
    updateStore(P.store, s => {
      const p = s.projects[key] ?? {}
      if (p.turnId === turnId) s.projects[key] = { ...p, status: 'error', error: why }
    })
    return { status: 'error', why }
  }

  const recap = { status: 'ready', turnId, ask: log.ask, error: '', ...takes }
  let client = DEFAULT_CLIENT
  let isNewEntry = false
  updateStore(P.store, s => {
    const p = s.projects[key] ?? {}
    if (p.turnId !== undefined && p.turnId !== turnId && (p.at ?? 0) > at) return // a newer turn took over
    client = { ...DEFAULT_CLIENT, ...(p.client ?? {}) }
    isNewEntry = p.diaryTurn !== turnId
    s.projects[key] = {
      ...p, name, cwd, at, status: 'ready', turnId, recap, error: '',
      streak: isNewEntry ? nextStreak(p.streak ?? 0, recap.verdict) : (p.streak ?? 0),
      diaryTurn: turnId, simpler: null,
    }
  })
  if (isNewEntry) {
    try {
      writeDiary(P.dir, cwd, recap, client, at)
    } catch (err) {
      note(P.log, key, 'diary-failed', { why: err instanceof Error ? err.message : String(err) })
    }
  }
  note(P.log, key, 'recap-ready', { turnId, source: 'codex', options: recap.options.length })
  return { status: 'ready', recap }
}

// Run as a script: the pending file is read once and removed.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2]) {
  const file = process.argv[2]
  let payload = null
  try {
    const handed = JSON.parse(readFileSync(file, 'utf8'))
    // The hook's RECAP_* settings: this process was started outside Codex and did not inherit them.
    Object.assign(process.env, handed.env ?? {})
    payload = handed.payload ?? null
  } catch { /* nothing to do */ }
  rmSync(file, { force: true })
  if (payload) {
    try {
      await brew(payload)
    } catch (err) {
      note(places().log, projectKey(String(payload.cwd ?? '')), 'recap-failed', { why: err instanceof Error ? err.message : String(err) })
    }
  }
}
