import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BacklogItem, ClientSettings, Interview, Job, Learned, Option, Prefs, Recap, View, Win } from '../types'
import { builderView } from './builder'
import type { Send } from './builder'
import { DEFAULT_CLIENT, clientNote, diaryPage, forClient, simplerPrompt } from './client'
import { COMMAND_DESCRIPTION, FALLBACK_COMMAND, clientHint, fallbackNotice, noRecapToast, parseCommand } from './commands'
import { clientBoxView, headerView, tabsView } from './header'
import { interviewView } from './interview'
import type { Instance, ProjectLast } from './journal'
import {
  appendLine, dataDir, diaryEntry, diaryFile, diaryHeader, duplicateWarning, nextStreak, otherCopies, projectKey, projectName,
  reminderFor, skipReason, withHeader, withInstance,
} from './journal'
import type { Els } from './look'
import { VERDICT } from './look'
import { backlogView, optionsView } from './options'
import { moodFor, owlSvg } from './owl'
import type { HistoryRow, Takes, TurnLog } from './recap'
import {
  INTERVIEW_DESCRIPTION, INTERVIEW_SCHEMA, LANE_KEYS, SYSTEM, answer, answersText, bestInLane, borrowable, composePrompt,
  digestFrom, favourites, forkPrompt, isSaved, isWorthRecap, learnFrom, logTool, md, newInterview, parseQuestions,
  parseTakes, plain, promptFor, ranked, rememberWins, toggleSaved, topPicks, willInterview,
} from './recap'
import { DEFAULT_PREFS, EMPTY_LOG, PANE, PANE_ROWS, TITLE, TOOL, backlogKey, clientKey, freshPicks, here, streakKey } from './state'

const current = atom({ plugin: 'recap', key: 'current' } as const, null)
const lastJob = atom({ plugin: 'recap', key: 'job' } as const, null)
const picksAtom = atom({ plugin: 'recap', key: 'picks' } as const, null)
const prefsAtom = atom({ plugin: 'recap', key: 'prefs' } as const, DEFAULT_PREFS)
const backlogAtom = atom({ plugin: 'recap', key: 'backlog' } as const, [])
const learnedAtom = atom({ plugin: 'recap', key: 'learned' } as const, {})
const interviewAtom = atom({ plugin: 'recap', key: 'interview' } as const, null)
const viewAtom = atom({ plugin: 'recap', key: 'view' } as const, 'options')
const warningAtom = atom({ plugin: 'recap', key: 'warning' } as const, null)
const clientAtom = atom({ plugin: 'recap', key: 'client' } as const, false)
const clientSettingsAtom = atom({ plugin: 'recap', key: 'clientSettings' } as const, DEFAULT_CLIENT)
const simplerAtom = atom({ plugin: 'recap', key: 'simpler' } as const, null)
const streakAtom = atom({ plugin: 'recap', key: 'streak' } as const, 0)

// The engine side of the recap: hooks, model calls, files and state. The pane
// is drawn by header.tsx, interview.tsx, options.tsx and builder.tsx.

/** Appends one line to the debug log: every recap attempt, whether it worked, and why. Never throws. */
async function note($: EngineInterface, event: string, detail: Record<string, unknown> = {}) {
  if (!here.dir) return
  try {
    const path = `${here.dir}/log.jsonl`
    const existing = (await $.fs.exists(path)) ? String(await $.fs.read(path)) : ''
    const line = JSON.stringify({ at: new Date(await $.clock.now()).toISOString(), project: here.project, event, ...detail })
    await $.fs.write(path, appendLine(existing, line))
  } catch {
    // The log is a debugging aid; losing a line must never break the recap.
  }
}

/** The project's diary as a clean web page beside it, to send to the client. Returns its path. */
async function writePage($: EngineInterface, diary: string): Promise<string> {
  const path = diaryFile(here.dir, here.cwd).replace(/\.md$/, '.html')
  const settings = await read($, clientSettingsAtom)
  const updated = new Date(await $.clock.now()).toUTCString().replace(/ \d\d:\d\d:\d\d GMT$/, '')
  await $.fs.write(path, diaryPage(diary, projectName(here.cwd), settings.name, updated))
  return path
}

/** Rewrites the diary's header (the client's name may have changed) and its web page. */
async function refreshDiary($: EngineInterface): Promise<string | null> {
  const path = diaryFile(here.dir, here.cwd)
  if (!here.dir || !(await $.fs.exists(path))) return null
  const settings = await read($, clientSettingsAtom)
  const diary = withHeader(String(await $.fs.read(path)), diaryHeader(here.cwd, settings.name))
  await $.fs.write(path, diary)
  return writePage($, diary)
}

/** Saves this project's client name, sign-off or tone. */
async function setClient($: EngineInterface, patch: Partial<ClientSettings>) {
  let saved: ClientSettings = DEFAULT_CLIENT
  await update($, clientSettingsAtom, s => (saved = { ...s, ...patch }))
  await $.store.set(clientKey(here.project), saved)
}

/** What the command does: open the pane, show the project's latest, brew fresh options, or the client and diary words. */
async function runCommand($: EngineInterface, args: string): Promise<{ text: string }> {
  const cmd = parseCommand(args)
  if (cmd.kind === 'client' || cmd.kind === 'signoff') {
    await setClient($, cmd.kind === 'client' ? { name: cmd.value } : { signoff: cmd.value })
    if (cmd.kind === 'client') await refreshDiary($)
    const what = cmd.kind === 'client' ? 'Client name' : 'Sign-off'
    return { text: cmd.value ? `${what} for this project: ${cmd.value}` : `${what} cleared for this project.` }
  }
  if (cmd.kind === 'log') return { text: `The recap log: ${here.dir}/log.jsonl` }
  if (cmd.kind === 'diary' || cmd.kind === 'page') {
    const page = await refreshDiary($)
    if (page === null) return { text: 'No progress updates yet: one is added each time a recap finishes.' }
    return {
      text: cmd.kind === 'page'
        ? `This project's progress page, ready to send to the client: ${page}`
        : `This project's progress updates: ${diaryFile(here.dir, here.cwd)} (as a web page to send: ${page})`,
    }
  }
  const job = await read($, lastJob)
  const backlog = await read($, backlogAtom)
  await $.ui.open({ id: PANE, title: TITLE, rows: PANE_ROWS, focus: true })
  let hasRecap = (await read($, current)) !== null
  // No recap in this chat yet, but the project has one from an earlier chat: show it straight away.
  if (!hasRecap && cmd.kind !== 'again') {
    const last = (await $.store.get(`last:${here.project}`)) as ProjectLast | undefined
    if (last && Array.isArray(last.recap?.options)) {
      const earlier: Recap = { ...last.recap, origin: 'earlier' }
      await update($, current, () => earlier)
      await update($, picksAtom, () => freshPicks(earlier.turnId))
      await update($, viewAtom, () => 'options')
      await note($, 'shown-earlier', { turnId: earlier.turnId })
      hasRecap = true
      return { text: 'Showing this project\'s latest recap. ↻ New options brews fresh ones for this chat.' }
    }
  }
  // No recap yet (the last turn was small, or the chat began before the mod loaded): recap the chat as it stands.
  if (cmd.kind === 'again' || !hasRecap) {
    const now = await $.clock.now()
    const target: Job = job ?? { turnId: `manual-${now.toString(36)}`, log: { ...EMPTY_LOG, ask: 'this conversation so far' }, answer: '' }
    if (job === null) await update($, lastJob, () => target)
    await update($, viewAtom, () => 'options')
    $.clock.after(0, () => void brew($, target.turnId, target.log, target.answer))
    return { text: hasRecap ? 'Brewing fresh options…' : 'Brewing options for this chat…' }
  }
  if (backlog.length > 0 && (await read($, current))?.status !== 'ready') await update($, viewAtom, () => 'backlog')
  return { text: 'Next-prompt pane opened.' }
}

/** Registers /recap, or /next when the name is taken; returns the name that works. */
async function registerCommand($: EngineInterface): Promise<string> {
  try {
    await $.command.register({ name: 'recap', description: COMMAND_DESCRIPTION })
    return 'recap'
  } catch (err) {
    await note($, 'command-refused', { name: 'recap', why: err instanceof Error ? err.message : String(err) })
  }
  try {
    await $.command.register({ name: FALLBACK_COMMAND, description: COMMAND_DESCRIPTION })
    return FALLBACK_COMMAND
  } catch (err) {
    await note($, 'command-refused', { name: FALLBACK_COMMAND, why: err instanceof Error ? err.message : String(err) })
    return ''
  }
}

/** Keeps a ready recap: as the project's latest (for the command in any chat), in the diary and its page, and in the streak. */
async function keep($: EngineInterface, r: Recap) {
  if (!here.project) return
  const at = await $.clock.now()
  await $.store.set(`last:${here.project}`, { recap: { ...r, origin: undefined }, at } satisfies ProjectLast)
  // One diary entry per finished piece of work: a fresh take on the same turn does not add another.
  const seenKey = `diary-turn:${here.project}`
  if ((await $.store.get(seenKey)) === r.turnId) return
  await $.store.set(seenKey, r.turnId)
  const streak = nextStreak(Number(await $.store.get(streakKey(here.project))) || 0, r.verdict)
  await $.store.set(streakKey(here.project), streak)
  await update($, streakAtom, () => streak)
  try {
    const path = diaryFile(here.dir, here.cwd)
    const settings = await read($, clientSettingsAtom)
    const existing = (await $.fs.exists(path)) ? String(await $.fs.read(path)) : ''
    const diary = withHeader(existing, diaryHeader(here.cwd, settings.name)) + diaryEntry(r, at, ranked(r.options, {})[0]?.title)
    await $.fs.write(path, diary)
    await writePage($, diary)
  } catch (err) {
    await note($, 'diary-failed', { why: err instanceof Error ? err.message : String(err) })
  }
}

/**
 * Asks for the recap. A fork reads the real conversation (code, decisions), so
 * the options can be specific to what was seen; if there is nothing to fork or
 * it fails, the small model works from the turn's digest instead.
 */
async function brew($: EngineInterface, turnId: string, turnLog: TurnLog, answerText: string) {
  await update($, current, () => ({
    status: 'brewing', turnId, ask: turnLog.ask, tldr: '', verdict: 'in_progress', verdictWhy: '', options: [], error: '',
  }) satisfies Recap)
  let takes: Takes | null = null
  let why = ''
  let source = 'conversation'
  try {
    const saved = await read($, backlogAtom)
    const wins = (await $.store.get('wins')) as Win[] | undefined
    const ideas = borrowable(Array.isArray(wins) ? wins : [], projectName(here.cwd))
    const projects = [...new Set(ideas.map(i => i.project))]
    const forked = await $.model.fork({ prompt: forkPrompt(answerText, saved, ideas) })
    takes = forked.isAnswered ? parseTakes(forked.text, projects) : null
    if (takes === null) {
      source = 'history fallback'
      await note($, 'fork-skipped', { turnId, why: forked.isAnswered ? 'reply was not readable' : forked.reason })
      // The fork could not answer. Without a recorded turn (a recap right after the mod loaded) the
      // small model would know nothing, so give it the chat's real history instead.
      let digest = { log: turnLog, answer: answerText }
      if (turnLog.steps.length === 0 || !answerText.trim()) {
        const rows = await $.session.messages()
        if (Array.isArray(rows)) digest = digestFrom(rows as unknown as HistoryRow[])
      }
      const reply = await $.model.complete({
        model: 'haiku', system: SYSTEM, prompt: promptFor(digest.log, digest.answer, saved, ideas), maxTokens: 8000, effort: 'low',
      })
      takes = reply.isAnswered ? parseTakes(reply.text, projects) : null
      why = reply.isAnswered ? 'the owl mumbled something unreadable' : `the model said no (${reply.reason})`
    }
  } catch (err) {
    why = `the request was refused (${err instanceof Error ? err.message : String(err)})`
  }
  let ready: Recap | null = null
  await update($, current, r => {
    if (r === null || r.turnId !== turnId) return r // a newer turn took over
    if (takes === null) return { ...r, status: 'error' as const, error: why }
    ready = { ...r, status: 'ready' as const, ...takes }
    return ready
  })
  await note($, ready === null ? 'recap-failed' : 'recap-ready', ready === null ? { turnId, why } : { turnId, source, options: (ready as Recap).options.length })
  if (ready !== null) {
    await keep($, ready)
    const fresh = freshPicks(turnId)
    await update($, picksAtom, () => fresh)
    await update($, viewAtom, v => (v === 'interview' ? v : 'options'))
    // The top pick waits in the prompt box as the dim suggestion (Tab takes it).
    const top = ranked((ready as Recap).options, await read($, learnedAtom))[0]
    if (top) void $.prompt.suggest({ text: top.prompt })
  }
}

/** The "even simpler" rewrite of the current client note: asked once per recap, then toggled. */
async function simplify($: EngineInterface, r: Recap) {
  const s = await read($, simplerAtom)
  if (s !== null && s.turnId === r.turnId) {
    if (s.status === 'writing') return
    if (s.status === 'ready') {
      await update($, simplerAtom, x => (x === null ? x : { ...x, isOn: !x.isOn }))
      return
    }
  }
  await update($, simplerAtom, () => ({ turnId: r.turnId, status: 'writing' as const, text: '', isOn: true }))
  const body = (r.client && r.client.trim()) || forClient(r.tldr)
  let text = ''
  try {
    const reply = await $.model.complete({
      model: 'haiku', system: 'You rewrite progress notes for clients in the plainest, friendliest words.', prompt: simplerPrompt(body), maxTokens: 400, effort: 'low',
    })
    text = reply.isAnswered ? forClient(plain(reply.text.replace(/^"+|"+$/g, ''), 700)) : ''
  } catch {
    text = ''
  }
  await update($, simplerAtom, x => (x === null || x.turnId !== r.turnId ? x : { ...x, status: text ? 'ready' as const : 'error' as const, text }))
  await note($, text ? 'simpler-ready' : 'simpler-failed', { turnId: r.turnId })
}

export const register: Register = on => {
  let log: TurnLog = EMPTY_LOG
  let storeKey = backlogKey('')

  on('session.start', async ($, e, next) => {
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
    here.cwd = await $.session.cwd()
    here.project = projectKey(here.cwd)
    here.dir = home ? dataDir(home) : ''
    here.command = await registerCommand($)
    // Said once: Claude has a /recap of its own now, so the pane answers to /next.
    if (here.command === FALLBACK_COMMAND && (await $.store.get('told-fallback')) !== true) {
      await $.store.set('told-fallback', true)
      $.ui.toast(fallbackNotice(), { timeoutMs: 12000 })
    }
    try {
      await $.tool.register({ name: 'interview', description: INTERVIEW_DESCRIPTION, inputSchema: INTERVIEW_SCHEMA, isDeferred: false })
    } catch (err) {
      await note($, 'tool-refused', { why: err instanceof Error ? err.message : String(err) })
    }
    storeKey = backlogKey(await $.session.cwd())
    const prefs = (await $.store.get('prefs')) as Partial<Prefs> | undefined
    if (prefs) await update($, prefsAtom, p => ({ ...p, ...prefs }))
    const learned = (await $.store.get('learned')) as Learned | undefined
    if (learned) await update($, learnedAtom, () => learned)
    const backlog = (await $.store.get(storeKey)) as BacklogItem[] | undefined
    if (Array.isArray(backlog)) await update($, backlogAtom, () => backlog)
    const client = (await $.store.get(clientKey(here.project))) as Partial<ClientSettings> | undefined
    if (client) await update($, clientSettingsAtom, () => ({ ...DEFAULT_CLIENT, ...client }))
    const streak = Number(await $.store.get(streakKey(here.project))) || 0
    await update($, streakAtom, () => streak)
    await update($, warningAtom, () => null)
    await note($, 'session-start', { root: $.plugin.root, command: here.command })

    // A second copy of this mod in the same chat: each copy announces itself, then looks for the other.
    if (here.dir) {
      const me: Instance = { session: await $.session.id(), token: crypto.randomUUID(), root: $.plugin.root, at: await $.clock.now() }
      const registry = `${here.dir}/instances.json`
      const announce = async () => {
        const raw = (await $.fs.exists(registry)) ? String(await $.fs.read(registry)) : '[]'
        await $.fs.write(registry, JSON.stringify(withInstance(raw, me)))
      }
      await announce().catch(err => note($, 'registry-failed', { why: err instanceof Error ? err.message : String(err) }))
      // Two copies writing at the same instant can drop each other: write again twice, a little apart.
      $.clock.after(300 + Math.floor(Math.random() * 300), () => void announce())
      $.clock.after(900 + Math.floor(Math.random() * 400), () => void announce())
      $.clock.after(2000, async () => {
        const raw = (await $.fs.exists(registry)) ? String(await $.fs.read(registry)) : '[]'
        const others = otherCopies(withInstance(raw, me), me)
        if (others.length === 0) return
        const warning = duplicateWarning('recap', me, others)
        await update($, warningAtom, () => warning)
        await note($, 'duplicate-copy', { roots: [me.root, ...others.map(o => o.root)] })
        // Every copy sees the others; the one that started last says so (its check runs last), so the warning shows once.
        if ([me, ...others].sort((a, b) => b.at - a.at || a.token.localeCompare(b.token))[0]!.token === me.token) {
          $.ui.toast(warning, { timeoutMs: 12000 })
        }
      })
    }

    // Unfinished work from an earlier chat in this project: one gentle nudge with one next step.
    const last = (await $.store.get(`last:${here.project}`)) as ProjectLast | undefined
    const top = last && Array.isArray(last.recap?.options) ? ranked(last.recap.options, await read($, learnedAtom))[0] : undefined
    const nudge = reminderFor(last, await $.clock.now(), top?.title, here.command)
    if (nudge) {
      $.ui.toast(nudge, { timeoutMs: 10000 })
      await note($, 'reminder', { tldr: last!.recap.tldr })
    }
    return next(e)
  })

  on('turn.start', ($, e, next) => {
    log = { ...EMPTY_LOG, ask: e.text }
    return next(e)
  })

  // Claude's interview questions land in the pane as buttons; the answers come back as the person's next message.
  on('tool.call', { tool: TOOL as 'Read' }, async ($, e) => {
    const questions = parseQuestions(e as unknown)
    if (questions === null) {
      return { result: 'No questions were shown: give 1 to 5 questions, each with at least 2 answer options.' }
    }
    const iv = newInterview(questions, await $.clock.now())
    await update($, interviewAtom, () => iv)
    await update($, viewAtom, () => 'interview')
    void $.ui.open({ id: PANE, title: TITLE, rows: PANE_ROWS })
    return {
      result: `Showed ${questions.length} question${questions.length === 1 ? '' : 's'} in the person's recap pane. `
        + 'End your turn now without doing the work; their answers arrive as their next message.',
    }
  })

  on('tool.call', ($, e, next) => {
    if (e.agentId === undefined && (e.tool as string) !== TOOL) log = logTool(log, e as any)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    // A run with no screen (claude -p, a script) has no pane to show: the recap stays out of its way,
    // unless RECAP_HEADLESS=1 asks for it (the nightly check does).
    const surfaces = await $.session.surfaces()
    if (Array.isArray(surfaces) && surfaces.length === 0 && (await $.env.get('RECAP_HEADLESS')) !== '1') {
      await note($, 'turn-skipped', { turnId: e.turnId, why: 'a run with no screen, so no pane to show' })
      return next(e)
    }
    if (isWorthRecap(log, e.answer, e.isAborted)) {
      const job: Job = { turnId: e.turnId, log, answer: e.answer }
      await update($, lastJob, () => job)
      void $.ui.open({ id: PANE, title: TITLE, rows: PANE_ROWS })
      // Brew after the turn has handed control back, so the prompt is never held up.
      $.clock.after(0, () => void brew($, job.turnId, job.log, job.answer))
      await note($, 'turn-recapped', { turnId: e.turnId, edits: log.edits, research: log.research, tools: log.tools })
    } else {
      const why = skipReason(log, e.answer, e.isAborted) ?? 'it did not qualify'
      $.ui.toast(noRecapToast(why, here.command), { timeoutMs: 5000 })
      await note($, 'turn-skipped', { turnId: e.turnId, why, edits: log.edits, research: log.research, tools: log.tools })
    }
    return next(e)
  })

  on('command.run', { command: 'recap' }, ($, e) => runCommand($, e.args))
  on('command.run', { command: FALLBACK_COMMAND }, ($, e) => runCommand($, e.args))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const saved = await read($, current)
    // Anything malformed in state (it should not happen) shows as no recap rather than breaking the pane.
    const r: Recap | null = saved !== null && Array.isArray(saved.options) ? saved : null
    const prefs: Prefs = { ...DEFAULT_PREFS, ...(await read($, prefsAtom)) }
    const backlog = await read($, backlogAtom)
    const learned = await read($, learnedAtom)
    const iv = await read($, interviewAtom)
    const warning = await read($, warningAtom)
    const isClientOpen = await read($, clientAtom)
    const settings = await read($, clientSettingsAtom)
    const simpler = await read($, simplerAtom)
    const streak = await read($, streakAtom)
    const hasInterview = iv !== null && iv.status === 'open'
    const hasOptions = r !== null && r.status === 'ready'
    let view: View = await read($, viewAtom)
    if (view === 'interview' && !hasInterview) view = hasOptions ? 'options' : 'backlog'
    if (view === 'options' && !hasOptions && (backlog.length > 0 || r === null)) view = 'backlog'

    const isDesktop = e.surface === 'desktop'
    const els = $.ui.resolve(e) as unknown as Els
    // The mobile app draws no text field yet.
    const canType = 'Input' in els && Boolean(els.Input)
    const isWide = e.props.bodyColumns >= 120
    const isNarrow = !isDesktop || e.props.bodyColumns < 70

    const setPrefs = async (patch: Partial<Prefs>) => {
      const nextPrefs = { ...prefs, ...patch }
      await update($, prefsAtom, () => nextPrefs)
      await $.store.set('prefs', nextPrefs)
    }
    const setView = (v: View) => update($, viewAtom, () => v)

    // ---- header: the owl, one line of status, the buttons ---------------------------------
    const status = r === null ? 'none' : r.status
    const owl = owlSvg(hasInterview ? 'happy' : moodFor(status, streak))
    let mascot: unknown = <els.Text>🦉</els.Text>
    if (isDesktop) {
      const { Svg } = $.ui.resolve({ ...e, surface: e.surface })
      mascot = <Svg source={owl.source} alt={owl.alt} width={32} height={32} />
    }
    const headline = hasInterview
      ? 'Claude has a few questions for you'
      : r === null
        ? backlog.length > 0 ? 'Your saved options' : 'Nothing to plan yet'
        : r.status === 'brewing'
          ? 'Brewing options…'
          : r.status === 'error'
            ? `Couldn't plan: ${md(r.error)}`
            : `${VERDICT[r.verdict]} ${md(r.tldr)}${r.origin === 'earlier' ? ' _(from an earlier chat)_' : ''}`
    const header = headerView(els, {
      mascot, headline, size: prefs.size, streak: hasOptions ? streak : 0, warning, isNarrow, hasOptions, isClientOpen,
      canAgain: r !== null && r.status !== 'brewing',
      onClient: () => void update($, clientAtom, x => !x),
      onSmaller: () => void setPrefs({ size: Math.max(1, prefs.size - 1) as Prefs['size'] }),
      onBigger: () => void setPrefs({ size: Math.min(3, prefs.size + 1) as Prefs['size'] }),
      onAgain: async () => {
        // No turn recorded in this chat (say, a recap from an earlier chat): recap this chat as it stands.
        const job = (await read($, lastJob))
          ?? { turnId: `manual-${(await $.clock.now()).toString(36)}`, log: { ...EMPTY_LOG, ask: 'this conversation so far' }, answer: '' }
        $.clock.after(0, () => void brew($, job.turnId, job.log, job.answer))
      },
    })

    // ---- "Explain to client": a short, jargon-free note about the latest work, ready to copy ----
    let clientBox = null
    if (hasOptions && isClientOpen) {
      const mine = simpler !== null && simpler.turnId === r!.turnId ? simpler : null
      const body = mine !== null && mine.status === 'ready' && mine.isOn ? mine.text : undefined
      const text = clientNote(r!, ranked(r!.options, learned)[0]?.title, settings, body)
      clientBox = clientBoxView(els, {
        note: text,
        settings,
        simpler: mine === null ? 'none' : mine.status === 'writing' ? 'writing' : mine.status === 'error' ? 'error' : mine.isOn ? 'on' : 'off',
        hint: clientHint(here.command),
        canType,
        onCopy: async press => {
          const copied = await $.ui.copy({ text, surface: press.surface })
          $.ui.toast(copied.isCopied ? 'Copied: paste it into your email or chat' : "Couldn't copy here: select the text instead")
        },
        onSimpler: () => void simplify($, r!),
        onTone: tone => void setClient($, { tone }),
        onName: async (value, isDone) => {
          await setClient($, { name: plain(value, 80) })
          if (isDone) await refreshDiary($)
        },
        onSignoff: (value, isDone) => void setClient($, { signoff: plain(value, 80) }),
        onClose: () => void update($, clientAtom, () => false),
      })
    }
    const top = <els.Box flexDirection="column" gap={1}>{header}{clientBox}</els.Box>

    const tabs = tabsView(els, {
      view, hasInterview, optionsCount: hasOptions ? r!.options.length : null, savedCount: backlog.length, onView: v => void setView(v),
    })

    // ---- the interview: Claude's questions as buttons ----------------------------------------
    if (view === 'interview' && iv !== null) {
      const setIv = (fn: (x: Interview) => Interview) => update($, interviewAtom, x => (x === null ? x : fn(x)))
      return (
        <els.Box flexDirection="column" gap={1} paddingX={isDesktop ? 1 : 0}>
          {top}
          {tabs}
          {interviewView(els, {
            iv, size: prefs.size, canType,
            onAnswer: (qi, oi) => void setIv(x => answer(x, qi, oi)),
            onNote: value => void setIv(x => ({ ...x, note: value })),
            onSend: async () => {
              const text = answersText(iv)
              await setIv(x => ({ ...x, status: 'sent' }))
              await setView(hasOptions ? 'options' : 'backlog')
              void $.prompt.submit({ text })
            },
            onDismiss: () => void setIv(x => ({ ...x, status: 'sent' })),
          })}
        </els.Box>
      )
    }

    if (!hasOptions && backlog.length === 0) {
      return <els.Box flexDirection="column" gap={1} paddingX={isDesktop ? 1 : 0}>{top}{r === null ? null : tabs}</els.Box>
    }

    // ---- picking: options or the saved backlog, then the builder ---------------------------
    const turnId = hasOptions ? r!.turnId : ''
    const stored = await read($, picksAtom)
    const picks = stored !== null && stored.turnId === turnId ? stored : freshPicks(turnId)
    const setPicks = (fn: (p: typeof picks) => typeof picks) =>
      update($, picksAtom, p => fn(p !== null && p.turnId === turnId ? p : freshPicks(turnId)))
    const togglePick = (id: string) =>
      void setPicks(p => ({ ...p, chosen: p.chosen.includes(id) ? p.chosen.filter(x => x !== id) : [...p.chosen, id] }))
    const toggleSave = async (o: Option) => {
      const now = await $.clock.now()
      const nextBacklog = toggleSaved(backlog, o, now)
      await update($, backlogAtom, () => nextBacklog)
      await $.store.set(storeKey, nextBacklog)
    }

    const options = hasOptions ? r!.options : []
    const pool: Option[] = [...options, ...backlog]
    const picked = picks.chosen.map(id => pool.find(o => o.id === id)).filter((o): o is Option => o !== undefined)
    const composed = composePrompt(pool, picks.chosen, prefs.deploy, prefs.autonomy)

    const send = async (how: Send) => {
      if (!composed) {
        $.ui.toast('Pick at least one option first')
        return
      }
      const nextLearned = learnFrom(learned, picked)
      await update($, learnedAtom, () => nextLearned)
      await $.store.set('learned', nextLearned)
      const wins = (await $.store.get('wins')) as Win[] | undefined
      await $.store.set('wins', rememberWins(Array.isArray(wins) ? wins : [], picked, projectName(here.cwd), await $.clock.now()))
      if (how === 'submit') {
        void $.prompt.submit({ text: composed })
        return
      }
      const draft = how === 'append' ? (await $.prompt.read()).text.trimEnd() : ''
      await $.prompt.fill({ text: draft ? `${draft}\n\n${composed}` : composed, mode: 'replace' })
      $.ui.toast('In your prompt box: edit it or press Enter')
    }

    const rowActions = { orderOf: (id: string) => picks.chosen.indexOf(id), onPick: togglePick }
    let listing
    if (view === 'backlog') {
      listing = backlogView(els, { ...rowActions, backlog, size: prefs.size, isNarrow, onUnsave: o => void toggleSave(o) })
    } else {
      const all = ranked(options, learned)
      listing = optionsView(els, {
        ...rowActions,
        all,
        shown: picks.lane === 'all' ? all : all.filter(o => o.lanes.includes(picks.lane as never)),
        options,
        picks,
        lanesPresent: LANE_KEYS.filter(l => all.some(o => o.lanes.includes(l))),
        top: topPicks(options, learned),
        best: bestInLane(options, learned),
        favourites: favourites(learned),
        hasLearned: Object.values(learned).some(n => (n ?? 0) > 0),
        size: prefs.size,
        isNarrow,
        isSaved: o => isSaved(backlog, o),
        onSave: o => void toggleSave(o),
        onLane: lane => void setPicks(p => ({ ...p, lane })),
        onResetLearning: async () => {
          await update($, learnedAtom, () => ({}))
          await $.store.set('learned', {})
          $.ui.toast('Ranking reset: no more nudges from past picks')
        },
      })
    }

    const builder = builderView(els, {
      picked,
      prefs,
      composed,
      willAsk: willInterview(picked, prefs.autonomy),
      onMakeMain: id => void setPicks(p => ({ ...p, chosen: [id, ...p.chosen.filter(x => x !== id)] })),
      onRemove: togglePick,
      onDeploy: d => void setPrefs({ deploy: d }),
      onAutonomy: a => void setPrefs({ autonomy: a }),
      onSend: how => void send(how),
      onClear: () => void setPicks(p => ({ ...p, chosen: [] })),
    })

    return (
      <els.Box flexDirection="column" gap={1} paddingX={isDesktop ? 1 : 0}>
        {top}
        {tabs}
        <els.Box flexDirection={isWide ? 'row' : 'column'} gap={2}>
          <els.Box flexDirection="column" gap={1} width={isWide ? '60%' : '100%'}>{listing}</els.Box>
          <els.Box flexDirection="column" width={isWide ? '38%' : '100%'}>{builder}</els.Box>
        </els.Box>
      </els.Box>
    )
  })
}
