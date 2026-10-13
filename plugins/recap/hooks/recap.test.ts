import { test, expect, mock } from 'claude-code/testing'

import {
  answer, answersText, bestInLane, composePrompt, favourites, isSaved, isWorthRecap, learnFrom, logTool, newInterview,
  parseQuestions, parseTakes, ranked, score, toggleSaved, topPicks,
} from './recap'
import type { Option } from '../types'

const OPTIONS = [
  { title: 'Fix the migration conflict', detail: 'It blocks the merge.', lanes: ['fix', 'ship'], impact: 5, effort: 'S', needs_you: false, prompt: 'Merge the two migrations into one and rerun the checks' },
  { title: 'Split the giant quotes file', detail: 'Three jobs in one file.', lanes: ['debt'], impact: 3, effort: 'M', needs_you: false, prompt: 'Split quotes.ts into list, edit and undo modules' },
  { title: 'Bulk delete with undo', detail: 'Reuses the undo toast.', lanes: ['feature', 'design'], impact: 4, effort: 'M', needs_you: true, prompt: 'Add bulk delete to the quote library' },
  { title: 'Paid quote packs', detail: 'Sell themed collections.', lanes: ['money', 'feature', 'growth'], impact: 4, effort: 'L', needs_you: true, prompt: 'Sketch paid quote packs and how people would buy them' },
  { title: 'Quote of the day email', detail: 'Brings people back daily.', lanes: ['growth'], impact: 3, effort: 'M', needs_you: true, prompt: 'Add an opt-in quote of the day email' },
  { title: 'Voice-read quotes', detail: 'A fresh, playful way in.', lanes: ['wild'], impact: 2, effort: 'L', needs_you: true, prompt: 'Prototype reading quotes aloud' },
  { title: 'Bogus lane', detail: 'Unknown lane falls back.', lanes: ['nonsense'], impact: 9, effort: 'XL', prompt: 'Do the bogus thing' },
]
const TAKES = { tldr: 'Moved the fixes onto main; one conflict left.', verdict: 'in_progress', verdict_why: 'Conflict blocks merge.', options: OPTIONS }
const QUESTIONS = {
  questions: [
    { question: 'Who is this mostly for?', options: [{ label: 'Just me' }, { label: 'Friends', recommended: true }, { label: 'Paying users', hint: 'needs accounts' }] },
    { question: 'Which feel do you want?', multi: true, options: ['Calm', 'Playful', 'Bold'] },
    { question: 'How soon?', options: ['Today', 'This week'] },
  ],
}

test('only real work earns a recap', async () => {
  const empty = { ask: 'hi', steps: [], edits: 0, research: 0, tools: 0 }
  const long = 'x'.repeat(100)
  expect(isWorthRecap(empty, long, false)).toBe(false)
  expect(isWorthRecap(logTool(empty, { tool: 'Edit', file_path: 'C:\\a\\b.ts' }), long, false)).toBe(true)
})

test('reads and tidies the options', async () => {
  const t = parseTakes('```json\n' + JSON.stringify(TAKES) + '\n```')!
  expect(t.options).toHaveLength(7)
  expect(t.options[0]!).toMatchObject({ id: 'o0', lanes: ['fix', 'ship'], needsYou: false })
  expect(t.options[6]!).toMatchObject({ lanes: ['feature'], impact: 5, effort: 'M', needsYou: false })
  expect(parseTakes(JSON.stringify({ ...TAKES, options: [] }))).toBeNull()
  expect(parseTakes(JSON.stringify({ ...TAKES, verdict: 'kinda' }))).toBeNull()
})

test('80/20 ranking: value per effort, lifted when one move serves several lanes', async () => {
  const t = parseTakes(JSON.stringify(TAKES))!
  const byId = Object.fromEntries(t.options.map(o => [o.id, o])) as Record<string, Option>
  expect(Math.abs(score(byId.o0!) - 7) < 1e-9).toBe(true) // 5 × 1.4 / 1
  expect(Math.abs(score(byId.o3!) - 4.5) < 1e-9).toBe(true) // 4 × 1.8 / 1.6
  expect(ranked(t.options).map(o => o.id).slice(0, 3)).toEqual(['o0', 'o3', 'o2'])
  expect([...topPicks(t.options)]).toEqual(['o0', 'o3', 'o2'])
  expect(bestInLane(t.options).get('growth')).toBe('o3')
  expect(bestInLane(t.options).get('wild')).toBe('o5')
})

test('learning nudges the directions the person picks, gently, and only after a few picks', async () => {
  const t = parseTakes(JSON.stringify(TAKES))!
  const byId = Object.fromEntries(t.options.map(o => [o.id, o])) as Record<string, Option>
  // Two growth picks are not enough to count yet.
  const early = learnFrom({}, [byId.o4!, byId.o4!])
  expect(ranked(t.options, early).map(o => o.id)).toEqual(ranked(t.options).map(o => o.id))
  expect(favourites(early)).toEqual([])
  // Once it counts: growth lifts by at most 30%, enough to pass close neighbours but not to take over.
  const leaning = learnFrom(early, [byId.o4!, byId.o4!])
  expect(favourites(leaning)).toEqual(['growth'])
  expect(Math.abs(score(byId.o4!, leaning) - score(byId.o4!) * 1.3) < 1e-9).toBe(true)
  expect(ranked(t.options, leaning)[0]!.id).toBe('o0')
  expect(ranked(t.options, leaning).map(o => o.id).indexOf('o4')).toBeLessThan(ranked(t.options).map(o => o.id).indexOf('o4'))
})

test('the prompt: main job, riders, where it lands, and whether to interview', async () => {
  const t = parseTakes(JSON.stringify(TAKES))!
  expect(composePrompt(t.options, [], 'local', 'auto')).toBe('')
  const solo = composePrompt(t.options, ['o0', 'o1'], 'staging', 'auto')
  expect(solo).toBe([
    'Merge the two migrations into one and rerun the checks.',
    'Also split quotes.ts into list, edit and undo modules.',
    'Once it works locally, deploy to staging and check it there.',
    'Do not stop to ask me questions: make sensible decisions yourself and tell me briefly what you chose.',
  ].join('\n\n'))
  const asks = composePrompt(t.options, ['o2', 'o0', 'o4'], 'local', 'auto')
  expect(asks).toContain('Add bulk delete to the quote library.\n\nAlso:\n- Merge the two migrations into one and rerun the checks\n- Add an opt-in quote of the day email')
  expect(asks).toContain('interview me with the recap interview tool')
  expect(asks).toContain('make every technical decision yourself')
  expect(composePrompt(t.options, ['o2'], 'production', 'solo')).toContain('Do not stop to ask me questions')
})

test('backlog: save, spot and unsave by content', async () => {
  const t = parseTakes(JSON.stringify(TAKES))!
  const kept = toggleSaved([], t.options[2]!, 1000)
  expect(kept).toHaveLength(1)
  expect(kept[0]!).toMatchObject({ title: 'Bulk delete with undo', savedAt: 1000 })
  expect(kept[0]!.id).not.toBe(t.options[2]!.id)
  // A later recap's option with the same content counts as saved.
  expect(isSaved(kept, { ...t.options[2]!, id: 'o9' })).toBe(true)
  expect(toggleSaved(kept, { ...t.options[2]!, id: 'o9' }, 2000)).toEqual([])
})

test('interview answers read back as plain sentences', async () => {
  const qs = parseQuestions(QUESTIONS)!
  expect(qs.map(q => [q.options.length, q.isMulti])).toEqual([[3, false], [3, true], [2, false]])
  expect(qs[0]!.options[1]!.isRecommended).toBe(true)
  expect(parseQuestions({ questions: [{ question: 'Only one?', options: ['x'] }] })).toBeNull()
  let iv = newInterview(qs, 1)
  iv = answer(iv, 0, 2)
  iv = answer(iv, 0, 1) // single choice swaps
  iv = answer(iv, 1, 0)
  iv = answer(iv, 1, 2) // multi choice adds
  iv = answer(iv, 2, -1)
  expect(iv.answers).toEqual([[1], [0, 2], [-1]])
  expect(answersText({ ...iv, note: 'keep it cosy' })).toBe([
    'My answers:',
    '',
    '1. Who is this mostly for?\n   → Friends',
    '2. Which feel do you want?\n   → Calm, Bold',
    '3. How soon?\n   → you decide',
    '',
    'Also: keep it cosy',
    '',
    'Go ahead, and make every technical decision yourself.',
  ].join('\n'))
})

const PANE = (bodyColumns: number) =>
  ({ plugin: 'recap', component: 'Pane', requestId: 'recap', props: { title: 'Next', isFocused: false, bodyColumns, placement: 'dock' } }) as any
const pick = (id: string) => ({ key: `pick-${id}` })

/** A session the way the engine runs one, with the outside world answered and recorded. */
const world = (on: any) => {
  const clock = mock.clock(on, { now: 1_760_000_000_000 })
  mock.store(on)
  const seen = { filled: [] as string[], submitted: [] as string[], suggested: [] as string[], opened: [] as string[], tools: [] as string[] }
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: 'G:\\quotes' }) as any)
  on('command.register', () => ({ value: undefined }) as any)
  on('tool.register', ($: any, e: any) => { seen.tools.push(e.name); return { value: { tool: `mcp__recap__${e.name}` } } as any })
  on('ui.open', ($: any, e: any) => { seen.opened.push(e.id); return { value: { isPlaced: true } } as any })
  on('ui.toast', () => ({ value: undefined }) as any)
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }) as any)
  on('prompt.fill', ($: any, e: any) => { seen.filled.push(e.text); return { isFilled: true } as any })
  on('prompt.suggest', ($: any, e: any) => { seen.suggested.push(e.text); return { isShown: true } as any })
  on('prompt.submit', ($: any, e: any) => { seen.submitted.push(e.text); return { text: e.text } as any })
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: 'ok', isError: false }) as any)
  on('model.fork', () => ({ value: { isAnswered: true, text: JSON.stringify(TAKES), usage: {} } }) as any)
  return { clock, seen }
}

const workTurn = async ($: any, clock: any, turnId = 't1') => {
  await $.turn.start({ text: 'move the fixes to main', turnId })
  await $.tool.call({ tool: 'Edit', file_path: 'C:\\m\\quotes.ts', old_string: 'a', new_string: 'b' } as any)
  await $.turn.complete({ answer: 'Moved everything. '.repeat(10), durationMs: 9000, isAborted: false, turnId, reason: 'answer' } as any)
  await clock.settle()
}

test('after real work: pick options, filter a lane, set where and questions, put it in the prompt', async ($, on) => {
  const { clock, seen } = world(on)
  await $.session.start({ cwd: 'G:\\quotes', surface: 'desktop', isInteractive: true })
  expect(seen.tools).toEqual(['interview'])
  await workTurn($, clock)
  expect(seen.suggested).toEqual(['Merge the two migrations into one and rerun the checks'])

  const ui = await $.ui.mount({ ...PANE(200), surface: 'desktop' })
  expect(await ui.find({ text: /🟡 Moved the fixes onto main/ })).toBeDefined()
  expect(await ui.find({ key: 'opt-o0', text: /⭐ 80\/20/ })).toBeDefined()

  await ui.press(pick('o3'))
  await ui.press(pick('o0'))
  expect(await ui.find({ key: 'pick-o3', text: '✓ 1 main' })).toBeDefined()
  expect(await ui.find({ key: 'pick-o0', text: '✓ 2' })).toBeDefined()
  expect(await ui.find({ key: 'pick-o1', text: '+ Pick' })).toBeDefined()
  expect(await ui.find({ text: /→ will interview you/ })).toBeDefined()

  await ui.press({ key: 'lane-growth' })
  expect(await ui.find({ key: 'opt-o1' })).toBeUndefined()
  expect(await ui.find({ key: 'opt-o3', text: /★ best here/ })).toBeDefined()
  await ui.press({ key: 'up-o0' })

  await ui.press({ key: 'dep-production' })
  await ui.press({ key: 'aut-solo' })
  await ui.press({ key: 'fill' })
  expect(seen.filled[0]).toBe([
    'Merge the two migrations into one and rerun the checks.',
    'Also sketch paid quote packs and how people would buy them.',
    'Once it works, deploy to production and check it is live and working.',
    'Do not stop to ask me questions: make sensible decisions yourself and tell me briefly what you chose.',
  ].join('\n\n'))
  await ui.press({ key: 'send' })
  expect(seen.submitted).toEqual([seen.filled[0]])

  await ui.press({ key: 'bigger' })
  await ui.unmount()
  const again = await $.ui.mount({ ...PANE(200), surface: 'desktop' })
  expect(JSON.stringify(await again.drawn())).toContain('## 🟡 Moved the fixes')
  expect(await again.find({ text: '◉ Production' })).toBeDefined()
  expect(await again.find({ text: '◉ Just do it' })).toBeDefined()
  // Two sends of fix+ship and money+feature+growth picks: enough to start learning, with a way to reset.
  expect(await again.find({ key: 'reset-learning' })).toBeDefined()
  await again.press({ key: 'reset-learning' })
  expect(await again.find({ key: 'reset-learning' })).toBeUndefined()
  await again.unmount()

  const term = await $.ui.mount({ ...PANE(80), surface: 'terminal' })
  expect(await term.find({ key: 'opt-o3' })).toBeDefined()
  expect(await term.find({ key: 'opt-o5' })).toBeUndefined()
})

test('saved options stay per project across chats and can be picked from the Saved tab', async ($, on) => {
  const { clock, seen } = world(on)
  await $.session.start({ cwd: 'G:\\quotes', surface: 'desktop', isInteractive: true })
  await workTurn($, clock)
  const ui = await $.ui.mount({ ...PANE(200), surface: 'desktop' })
  await ui.press({ key: 'save-o4' })
  expect(await ui.find({ key: 'save-o4', text: '★ Saved' })).toBeDefined()
  expect(await ui.find({ key: 'tab-backlog', text: '☆ Saved 1' })).toBeDefined()
  await ui.unmount()

  // A new chat in the same project: no recap yet, the saved option is waiting.
  await $.session.start({ cwd: 'G:\\quotes', surface: 'desktop', isInteractive: true })
  const later = await $.ui.mount({ ...PANE(200), surface: 'desktop' })
  await later.press({ key: 'tab-backlog' })
  const row = JSON.stringify(await later.drawn())
  const id = /pick-(bk-[a-z0-9]+)/.exec(row)?.[1]
  expect(id).toBeDefined()
  await later.press({ key: `pick-${id}` })
  await later.press({ key: 'fill' })
  expect(seen.filled.at(-1)).toContain('Add an opt-in quote of the day email.')
  await later.press({ key: `unsave-${id}` })
  expect(await later.find({ text: /Nothing saved yet/ })).toBeDefined()
})

test("Claude's interview shows as buttons and the answers go back as the reply", async ($, on) => {
  const { seen } = world(on)
  await $.session.start({ cwd: 'G:\\quotes', surface: 'desktop', isInteractive: true })
  const said = await $.tool.call({ tool: 'mcp__recap__interview', ...QUESTIONS } as any)
  expect(String((said as any).text ?? (said as any).result)).toContain('End your turn now')
  expect(seen.opened).toEqual(['recap'])

  const ui = await $.ui.mount({ ...PANE(200), surface: 'desktop' })
  expect(await ui.find({ text: /Claude has a few questions/ })).toBeDefined()
  expect(await ui.find({ key: 'q0-o1', text: '○ Friends ★' })).toBeDefined()
  await ui.press({ key: 'q0-o1' })
  expect(await ui.find({ key: 'q0-o1', text: '● Friends ★' })).toBeDefined()
  await ui.press({ key: 'q1-o0' })
  await ui.press({ key: 'q1-o2' })
  await ui.press({ key: 'q2-x' })
  expect(await ui.find({ key: 'iv-send', text: /3\/3/ })).toBeDefined()
  await ui.press({ key: 'iv-send' })
  expect(seen.submitted).toHaveLength(1)
  expect(seen.submitted[0]).toContain('1. Who is this mostly for?\n   → Friends')
  expect(seen.submitted[0]).toContain('2. Which feel do you want?\n   → Calm, Bold')
  expect(seen.submitted[0]).toContain('3. How soon?\n   → you decide')
  expect(await ui.find({ key: 'iv-send' })).toBeUndefined()

  const bad = await $.tool.call({ tool: 'mcp__recap__interview', questions: [] } as any)
  expect(String((bad as any).text ?? (bad as any).result)).toContain('No questions were shown')
})

test('a chatty turn with no tools gets no pane', async ($, on) => {
  mock.clock(on)
  const opened: string[] = []
  on('ui.open', ($, e) => { opened.push(e.id); return { value: { isPlaced: true } } as any })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.turn.start({ text: 'write me a haiku', turnId: 't2' })
  await $.turn.complete({ answer: 'Orange comet streaks. '.repeat(8), durationMs: 2000, isAborted: false, turnId: 't2', reason: 'answer' } as any)
  expect(opened).toEqual([])
})
