import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Autonomy, BacklogItem, Deploy, Interview, Job, Lane, Learned, Option, Picks, Prefs, Recap, View } from '../types'
import { owlSvg } from './owl'
import type { Takes, TurnLog } from './recap'
import {
  AUTONOMY, DEPLOY, INTERVIEW_DESCRIPTION, INTERVIEW_SCHEMA, LANES, LANE_KEYS, SYSTEM, answer, answersText,
  bestInLane, composePrompt, favourites, forkPrompt, isSaved, isWorthRecap, learnFrom, logTool, newInterview,
  parseQuestions, parseTakes, promptFor, ranked, toggleSaved, topPicks, willInterview,
} from './recap'

const PANE = 'recap'
const TITLE = '✨ Next'
const PANE_ROWS = 30
const TOOL = 'mcp__recap__interview'
const DEFAULT_PREFS: Prefs = { size: 2, deploy: 'local', autonomy: 'auto' }

const current = atom({ plugin: 'recap', key: 'current' } as const, null)
const lastJob = atom({ plugin: 'recap', key: 'job' } as const, null)
const picksAtom = atom({ plugin: 'recap', key: 'picks' } as const, null)
const prefsAtom = atom({ plugin: 'recap', key: 'prefs' } as const, DEFAULT_PREFS)
const backlogAtom = atom({ plugin: 'recap', key: 'backlog' } as const, [])
const learnedAtom = atom({ plugin: 'recap', key: 'learned' } as const, {})
const interviewAtom = atom({ plugin: 'recap', key: 'interview' } as const, null)
const viewAtom = atom({ plugin: 'recap', key: 'view' } as const, 'options')

const EMPTY_LOG: TurnLog = { ask: '', steps: [], edits: 0, research: 0, tools: 0 }
const VERDICT = { done: '💚', in_progress: '🟡', blocked: '🟥' } as const
const EFFORT = { S: 'quick', M: 'medium', L: 'big' } as const
/** Heading level per text size: the only way to draw larger text in the pane. */
const TITLE_H = { 1: '', 2: '#### ', 3: '### ' } as const
const HEAD_H = { 1: '#### ', 2: '### ', 3: '## ' } as const
const ORDINAL = '②③④⑤⑥⑦⑧⑨'

/** The store key of this project's backlog: one list per folder the chat runs in. */
const backlogKey = (cwd: string) => `backlog:${cwd.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()}`

const freshPicks = (turnId: string): Picks => ({ turnId, chosen: [], lane: 'all' })

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
  try {
    const forked = await $.model.fork({ prompt: forkPrompt(answerText) })
    takes = forked.isAnswered ? parseTakes(forked.text) : null
    if (takes === null) {
      const reply = await $.model.complete({
        model: 'haiku', system: SYSTEM, prompt: promptFor(turnLog, answerText), maxTokens: 3000, effort: 'low',
      })
      takes = reply.isAnswered ? parseTakes(reply.text) : null
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
  if (ready !== null) {
    const fresh = freshPicks(turnId)
    await update($, picksAtom, () => fresh)
    await update($, viewAtom, v => (v === 'interview' ? v : 'options'))
    // The top pick waits in the prompt box as the dim suggestion (Tab takes it).
    const top = ranked((ready as Recap).options, await read($, learnedAtom))[0]
    if (top) void $.prompt.suggest({ text: top.prompt })
  }
}

export const register: Register = on => {
  let log: TurnLog = EMPTY_LOG
  let storeKey = backlogKey('')

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'recap', description: 'Show the next-prompt pane; "/recap again" brews new options' })
    await $.tool.register({ name: 'interview', description: INTERVIEW_DESCRIPTION, inputSchema: INTERVIEW_SCHEMA, isDeferred: false })
    storeKey = backlogKey(await $.session.cwd())
    const prefs = (await $.store.get('prefs')) as Partial<Prefs> | undefined
    if (prefs) await update($, prefsAtom, p => ({ ...p, ...prefs }))
    const learned = (await $.store.get('learned')) as Learned | undefined
    if (learned) await update($, learnedAtom, () => learned)
    const backlog = (await $.store.get(storeKey)) as BacklogItem[] | undefined
    if (Array.isArray(backlog)) await update($, backlogAtom, () => backlog)
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
    if (e.agentId === undefined && isWorthRecap(log, e.answer, e.isAborted)) {
      const job: Job = { turnId: e.turnId, log, answer: e.answer }
      await update($, lastJob, () => job)
      void $.ui.open({ id: PANE, title: TITLE, rows: PANE_ROWS })
      // Brew after the turn has handed control back, so the prompt is never held up.
      $.clock.after(0, () => void brew($, job.turnId, job.log, job.answer))
    }
    return next(e)
  })

  on('command.run', { command: 'recap' }, async ($, e) => {
    const job = await read($, lastJob)
    const backlog = await read($, backlogAtom)
    if (job === null && backlog.length === 0) {
      return { text: 'Nothing yet: the pane appears after a turn that edits files or digs through research.' }
    }
    await $.ui.open({ id: PANE, title: TITLE, rows: PANE_ROWS })
    if (e.args.trim() === 'again' && job !== null) {
      $.clock.after(0, () => void brew($, job.turnId, job.log, job.answer))
      return { text: 'Brewing fresh options…' }
    }
    if (job === null) await update($, viewAtom, () => 'backlog')
    return { text: 'Next-prompt pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const saved = await read($, current)
    // A recap saved by an older version lacks the options.
    const isStale = saved !== null && saved.status === 'ready' && !Array.isArray(saved.options)
    const r: Recap | null = saved === null ? null : isStale
      ? { ...saved, status: 'error', error: 'this one is from the old version; the next piece of work brings the new pane', options: [] }
      : saved
    const prefs: Prefs = { ...DEFAULT_PREFS, ...(await read($, prefsAtom)) }
    const backlog = await read($, backlogAtom)
    const learned = await read($, learnedAtom)
    const iv = await read($, interviewAtom)
    const hasInterview = iv !== null && iv.status === 'open'
    const hasOptions = r !== null && r.status === 'ready'
    let view: View = await read($, viewAtom)
    if (view === 'interview' && !hasInterview) view = hasOptions ? 'options' : 'backlog'
    if (view === 'options' && !hasOptions && (backlog.length > 0 || r === null)) view = 'backlog'

    const isDesktop = e.surface === 'desktop'
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = els
    // The mobile app draws no text field yet.
    const Input = 'Input' in els ? els.Input : null

    const setPrefs = async (patch: Partial<Prefs>) => {
      const nextPrefs = { ...prefs, ...patch }
      await update($, prefsAtom, () => nextPrefs)
      await $.store.set('prefs', nextPrefs)
    }
    const setView = (v: View) => update($, viewAtom, () => v)

    // ---- header: one line of status, text size, new options --------------------------------
    const mood = r === null || r.status === 'error' ? 'oops' : r.status === 'brewing' ? 'brewing' : 'happy'
    let mascot = <Text>🦉</Text>
    if (isDesktop) {
      const { Svg } = $.ui.resolve({ ...e, surface: e.surface })
      const owl = owlSvg(hasInterview ? 'happy' : mood)
      mascot = <Svg source={owl.source} alt={owl.alt} width={32} height={32} />
    }
    const headline = hasInterview
      ? 'Claude has a few questions for you'
      : r === null
        ? backlog.length > 0 ? 'Your saved options' : 'Nothing to plan yet'
        : r.status === 'brewing'
          ? 'Brewing options…'
          : r.status === 'error'
            ? `Couldn't plan: ${r.error}`
            : `${VERDICT[r.verdict]} ${r.tldr}`
    const header = (
      <Box flexDirection="row" alignItems="center" gap={1}>
        {mascot}
        <Box flexShrink={1} flexGrow={1}>
          <Markdown text={`${HEAD_H[prefs.size]}${headline}`} />
        </Box>
        <Button key="smaller" variant="secondary" onPress={() => setPrefs({ size: Math.max(1, prefs.size - 1) as Prefs['size'] })}>A−</Button>
        <Button key="bigger" variant="secondary" onPress={() => setPrefs({ size: Math.min(3, prefs.size + 1) as Prefs['size'] })}>A+</Button>
        {r !== null && r.status !== 'brewing'
          ? (
            <Button key="again" variant="secondary" onPress={async () => {
              const job = await read($, lastJob)
              if (job !== null) $.clock.after(0, () => void brew($, job.turnId, job.log, job.answer))
            }}>
              ↻ New options
            </Button>
          )
          : null}
      </Box>
    )

    const tabs = (
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        {hasInterview
          ? <Button key="tab-interview" variant={view === 'interview' ? 'primary' : 'secondary'} onPress={() => setView('interview')}>💬 Questions</Button>
          : null}
        {hasOptions
          ? <Button key="tab-options" variant={view === 'options' ? 'primary' : 'secondary'} onPress={() => setView('options')}>{`Options ${r!.options.length}`}</Button>
          : null}
        <Button key="tab-backlog" variant={view === 'backlog' ? 'primary' : 'secondary'} onPress={() => setView('backlog')}>{`☆ Saved ${backlog.length}`}</Button>
      </Box>
    )

    // ---- the interview: Claude's questions as buttons --------------------------------------
    if (view === 'interview' && iv !== null) {
      const setIv = (fn: (x: Interview) => Interview) => update($, interviewAtom, x => (x === null ? x : fn(x)))
      const answered = iv.answers.filter(a => a.length > 0).length
      return (
        <Box flexDirection="column" gap={1} paddingX={isDesktop ? 1 : 0}>
          {header}
          {tabs}
          {iv.questions.map((q, qi) => (
            <Box key={`q${qi}`} flexDirection="column">
              <Markdown text={`${TITLE_H[prefs.size] || '**'}${qi + 1}. ${q.question}${TITLE_H[prefs.size] ? '' : '**'}`} />
              <Box flexDirection="row" flexWrap="wrap" gap={1}>
                {q.options.map((o, oi) => {
                  const isChosen = (iv.answers[qi] ?? []).includes(oi)
                  return (
                    <Button key={`q${qi}-o${oi}`} variant={isChosen ? 'primary' : 'secondary'} onPress={() => setIv(x => answer(x, qi, oi))}>
                      {`${isChosen ? (q.isMulti ? '☑' : '●') : (q.isMulti ? '☐' : '○')} ${o.label}${o.isRecommended ? ' ★' : ''}`}
                    </Button>
                  )
                })}
                <Button key={`q${qi}-x`} variant={(iv.answers[qi] ?? []).includes(-1) ? 'primary' : 'secondary'} onPress={() => setIv(x => answer(x, qi, -1))}>
                  You decide
                </Button>
              </Box>
              {q.options.some(o => o.hint)
                ? <Markdown dimColor text={q.options.filter(o => o.hint).map(o => `**${o.label}**: ${o.hint}`).join(' · ')} />
                : null}
            </Box>
          ))}
          {Input
            ? (
              <Input
                key="iv-note"
                placeholder="Anything to add? (optional)"
                value={iv.note}
                onInput={(value: string) => setIv(x => ({ ...x, note: value }))}
                onSubmit={(value: string) => setIv(x => ({ ...x, note: value }))}
              />
            )
            : null}
          <Box flexDirection="row" gap={1}>
            <Button key="iv-send" variant="primary" onPress={async () => {
              const text = answersText(iv)
              await setIv(x => ({ ...x, status: 'sent' }))
              await setView(hasOptions ? 'options' : 'backlog')
              void $.prompt.submit({ text })
            }}>
              {`Send answers ▶  (${answered}/${iv.questions.length})`}
            </Button>
            <Button key="iv-dismiss" variant="secondary" onPress={() => setIv(x => ({ ...x, status: 'sent' }))}>Dismiss</Button>
          </Box>
          <Text dimColor>Unanswered questions are left to Claude.</Text>
        </Box>
      )
    }

    if (!hasOptions && backlog.length === 0) {
      return <Box flexDirection="column" gap={1} paddingX={isDesktop ? 1 : 0}>{header}{r === null ? null : tabs}</Box>
    }

    // ---- picking: options or the saved backlog, then the builder ---------------------------
    const turnId = hasOptions ? r!.turnId : ''
    const stored = await read($, picksAtom)
    const picks = stored !== null && stored.turnId === turnId ? stored : freshPicks(turnId)
    const setPicks = (fn: (p: Picks) => Picks) =>
      update($, picksAtom, p => fn(p !== null && p.turnId === turnId ? p : freshPicks(turnId)))
    const togglePick = (id: string) =>
      setPicks(p => ({ ...p, chosen: p.chosen.includes(id) ? p.chosen.filter(x => x !== id) : [...p.chosen, id] }))
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

    const send = async (how: 'replace' | 'append' | 'submit') => {
      if (!composed) return
      const nextLearned = learnFrom(learned, picked)
      await update($, learnedAtom, () => nextLearned)
      await $.store.set('learned', nextLearned)
      if (how === 'submit') {
        void $.prompt.submit({ text: composed })
        return
      }
      const draft = how === 'append' ? (await $.prompt.read()).text.trimEnd() : ''
      await $.prompt.fill({ text: draft ? `${draft}\n\n${composed}` : composed, mode: 'replace' })
      $.ui.toast('In your prompt box: edit it or press Enter')
    }

    const pickButton = (o: Option) => {
      const order = picks.chosen.indexOf(o.id)
      const label = order === -1 ? '+ Pick' : order === 0 ? '✓ 1 main' : `✓ ${order + 1}`
      return (
        <Button key={`pick-${o.id}`} variant={order === -1 ? 'secondary' : 'primary'} onPress={() => togglePick(o.id)}>
          {label}
        </Button>
      )
    }
    const optionBody = (o: Option, badges: string, extra?: string) => (
      <Box flexDirection="column" flexShrink={1}>
        <Markdown key={`opt-${o.id}`} text={`${TITLE_H[prefs.size]}${o.title}${badges ? `  ${badges}` : ''}`} />
        <Markdown
          dimColor
          text={`${o.lanes.map(l => LANES[l].icon).join('')} ${o.detail} · ${EFFORT[o.effort]} · ${o.needsYou ? '💬 your call' : '🤖 Claude can decide'}${extra ? ` · ${extra}` : ''}`}
        />
      </Box>
    )
    const bars = (o: Option) => (
      <Box flexDirection="row">
        {o.lanes.map(l => <Text key={`${o.id}-${l}`} color={LANES[l].color}>▌</Text>)}
      </Box>
    )

    let listing
    if (view === 'backlog') {
      listing = backlog.length === 0
        ? <Text dimColor>Nothing saved yet. Press ☆ Save on any option to keep it here for this project, across chats.</Text>
        : (
          <Box flexDirection="column" gap={1}>
            {backlog.map(o => (
              <Box key={`row-${o.id}`} flexDirection="row" gap={1} alignItems="flex-start">
                {pickButton(o)}
                <Button key={`unsave-${o.id}`} variant="secondary" onPress={() => toggleSave(o)}>✕</Button>
                {bars(o)}
                {optionBody(o, '', `saved ${new Date(o.savedAt).toISOString().slice(0, 10)}`)}
              </Box>
            ))}
          </Box>
        )
    } else {
      const all = ranked(options, learned)
      const top = topPicks(options, learned)
      const best = bestInLane(options, learned)
      const lanesPresent = LANE_KEYS.filter(l => all.some(o => o.lanes.includes(l)))
      const shown = picks.lane === 'all' ? all : all.filter(o => o.lanes.includes(picks.lane as Lane))
      const fav = favourites(learned)
      const hasLearned = Object.values(learned).some(n => (n ?? 0) > 0)
      listing = (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            <Button key="lane-all" variant={picks.lane === 'all' ? 'primary' : 'secondary'} onPress={() => setPicks(p => ({ ...p, lane: 'all' }))}>
              {`All ${all.length}`}
            </Button>
            {lanesPresent.map(l => (
              <Button key={`lane-${l}`} variant={picks.lane === l ? 'primary' : 'secondary'} onPress={() => setPicks(p => ({ ...p, lane: p.lane === l ? 'all' : l }))}>
                {`${LANES[l].icon} ${LANES[l].name} ${all.filter(o => o.lanes.includes(l)).length}`}
              </Button>
            ))}
          </Box>
          {hasLearned
            ? (
              <Box flexDirection="row" gap={1} alignItems="center">
                <Box flexShrink={1} flexGrow={1}>
                  <Text dimColor>
                    {fav.length > 0
                      ? `Learned from your picks: ${fav.map(l => `${LANES[l].icon} ${LANES[l].name}`).join(', ')} rank a little higher`
                      : 'Learning which directions you pick…'}
                  </Text>
                </Box>
                <Button key="reset-learning" variant="secondary" onPress={async () => {
                  await update($, learnedAtom, () => ({}))
                  await $.store.set('learned', {})
                  $.ui.toast('Ranking reset: no more nudges from past picks')
                }}>
                  Reset learning
                </Button>
              </Box>
            )
            : null}
          {shown.map(o => {
            const badges = [
              top.has(o.id) ? '⭐ 80/20' : '',
              picks.lane !== 'all' && best.get(picks.lane as Lane) === o.id ? '★ best here' : '',
            ].filter(Boolean).join('  ')
            const isKept = isSaved(backlog, o)
            return (
              <Box key={`row-${o.id}`} flexDirection="row" gap={1} alignItems="flex-start">
                {pickButton(o)}
                <Button key={`save-${o.id}`} variant={isKept ? 'primary' : 'secondary'} onPress={() => toggleSave(o)}>
                  {isKept ? '★ Saved' : '☆ Save'}
                </Button>
                {bars(o)}
                {optionBody(o, badges)}
              </Box>
            )
          })}
        </Box>
      )
    }

    const willAsk = willInterview(picked, prefs.autonomy)
    const builder = (
      <Box flexDirection="column" borderStyle="round" borderColor="#A487E0" borderDimColor paddingX={1}>
        <Markdown text={`${HEAD_H[prefs.size]}Your next prompt`} />
        {picked.length === 0
          ? <Text dimColor>Press + Pick on options or saved ones. The first one you pick is the main job; the rest ride along.</Text>
          : picked.map((o, i) => (
            <Box key={`pk-${o.id}`} flexDirection="row" gap={1}>
              <Text>{i === 0 ? '① main' : `${ORDINAL[i - 1] ?? '•'} also`}</Text>
              <Box flexShrink={1} flexGrow={1}><Text>{o.title}</Text></Box>
              {i > 0
                ? <Button key={`up-${o.id}`} variant="secondary" onPress={() => setPicks(p => ({ ...p, chosen: [o.id, ...p.chosen.filter(x => x !== o.id)] }))}>make main</Button>
                : null}
              <Button key={`rm-${o.id}`} variant="secondary" onPress={() => togglePick(o.id)}>✕</Button>
            </Box>
          ))}

        <Box marginTop={1}><Text bold>Where</Text></Box>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {(Object.keys(DEPLOY) as Deploy[]).map(d => (
            <Button key={`dep-${d}`} variant={prefs.deploy === d ? 'primary' : 'secondary'} onPress={() => setPrefs({ deploy: d })}>
              {`${prefs.deploy === d ? '◉' : '○'} ${DEPLOY[d].label}`}
            </Button>
          ))}
        </Box>

        <Box marginTop={1}><Text bold>Questions</Text></Box>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {(Object.keys(AUTONOMY) as Autonomy[]).map(a => (
            <Button key={`aut-${a}`} variant={prefs.autonomy === a ? 'primary' : 'secondary'} onPress={() => setPrefs({ autonomy: a })}>
              {`${prefs.autonomy === a ? '◉' : '○'} ${AUTONOMY[a].label}`}
            </Button>
          ))}
        </Box>
        <Text dimColor>
          {prefs.autonomy === 'auto'
            ? picked.length === 0 ? AUTONOMY.auto.hint : willAsk ? '→ will interview you: a pick needs your ideas' : '→ will just do it: nothing needs your ideas'
            : AUTONOMY[prefs.autonomy].hint}
        </Text>

        <Box borderStyle="single" borderDimColor paddingX={1} marginTop={1} flexDirection="column">
          {composed ? <Markdown text={composed} /> : <Text dimColor>Your prompt builds itself here.</Text>}
        </Box>
        <Box flexDirection="row" flexWrap="wrap" gap={1} marginTop={1}>
          <Button key="fill" variant="primary" onPress={() => send('replace')}>Put in prompt</Button>
          <Button key="append" variant="secondary" onPress={() => send('append')}>Add to my draft</Button>
          <Button key="send" variant="secondary" onPress={() => send('submit')}>Send now ▶</Button>
          {picked.length > 0
            ? <Button key="clear" variant="secondary" onPress={() => setPicks(p => ({ ...p, chosen: [] }))}>Clear</Button>
            : null}
        </Box>
      </Box>
    )

    const isWide = e.props.bodyColumns >= 120
    return (
      <Box flexDirection="column" gap={1} paddingX={isDesktop ? 1 : 0}>
        {header}
        {tabs}
        <Box flexDirection={isWide ? 'row' : 'column'} gap={2}>
          <Box flexDirection="column" gap={1} width={isWide ? '60%' : '100%'}>{listing}</Box>
          <Box flexDirection="column" width={isWide ? '38%' : '100%'}>{builder}</Box>
        </Box>
      </Box>
    )
  })
}
