import { test, expect, mock } from 'claude-code/testing'

import type { Snap } from '../types'
import { IDLE, LINGER_MS, applyTaskCall, describeTool, fmtClock, plainLine, words } from './model'

test('tool calls read as plain actions', async () => {
  expect(describeTool({ tool: 'Edit', file_path: 'C:\\x\\hooks\\svg.ts' })).toBe('Editing svg.ts')
  expect(describeTool({ tool: 'Bash', command: 'npm test\nnpm run lint' })).toBe('Running npm test')
  expect(describeTool({ tool: 'Grep', pattern: 'TODO' })).toBe('Searching for “TODO”')
  expect(describeTool({ tool: 'WebFetch', url: 'https://docs.example.com/a' })).toBe('Reading docs.example.com')
  expect(describeTool({ tool: 'mcp__ccd_session__start_session' })).toBe('Using start session')
  expect(describeTool({ tool: 'TodoWrite', todos: [] })).toBe('Updating the plan')
  expect(fmtClock(94_000)).toBe('1:34')
})

test('the running task leads, the tool action follows', async () => {
  let s: Snap = { ...IDLE, phase: 'working', action: 'Editing svg.ts', startedAt: 0 }
  expect(words(s)).toMatchObject({ headline: 'Editing svg.ts', detail: null, progress: null })
  s = applyTaskCall(s, { tool: 'TodoWrite', todos: [
    { content: 'Read', status: 'completed', activeForm: 'Reading' },
    { content: 'Build', status: 'in_progress', activeForm: 'Building the band' },
    { content: 'Ship', status: 'pending', activeForm: 'Shipping' },
  ] }, 10)
  expect(words(s)).toMatchObject({ headline: 'Building the band', detail: 'Editing svg.ts', progress: '1/3' })
  expect(plainLine(s, 45_000)).toBe('Building the band · Editing svg.ts · 0:45 · 1/3 tasks')
  expect(plainLine({ ...s, action: null }, 45_000)).toBe('Building the band · Thinking · 0:45 · 1/3 tasks')
})

test('task list follows TaskCreate/TaskUpdate', async () => {
  let s = applyTaskCall(IDLE, { tool: 'TaskCreate', subject: 'New', activeForm: 'Doing new', createdId: '7' }, 20)
  s = applyTaskCall(s, { tool: 'TaskCreate', subject: 'Other', createdId: '8' }, 30)
  s = applyTaskCall(s, { tool: 'TaskUpdate', taskId: '7', status: 'completed' }, 50)
  expect(s).toMatchObject({ taskDoneId: '7', taskDoneAt: 50 })
  s = applyTaskCall(s, { tool: 'TaskUpdate', taskId: '8', status: 'deleted' }, 60)
  expect(s.tasks.map(t => t.id)).toEqual(['7'])
  // A finished list is replaced when a new task is created.
  s = applyTaskCall(s, { tool: 'TaskCreate', subject: 'Fresh', createdId: '9' }, 70)
  expect(s.tasks.map(t => t.id)).toEqual(['9'])
})

const ABOVE = { hasSurvey: false, isWorking: true, maxRows: 10 } as any

test('a turn: action while a tool runs, Thinking between, then done and gone', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('ui.status', () => ({ value: undefined }) as any)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  let during = ''
  on('tool.call', async (_, e) => {
    const d = await $.ui.mount({ plugin: 'turn-status', surface: 'desktop', component: 'AbovePrompt', props: ABOVE })
    during = String(((await d.drawn()) as any).props.alt)
    await d.unmount()
    if (e.tool === 'TodoWrite') return { result: {}, isError: false } as any
    return { result: 'x', isError: e.tool === 'Bash' } as any
  })

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/a/b/notes.md' } as any)
  expect(during).toBe('Reading notes.md · 0:00')
  await $.tool.call({ tool: 'TodoWrite', todos: [
    { content: 'A', status: 'completed', activeForm: 'Doing A' },
    { content: 'B', status: 'in_progress', activeForm: 'Doing B' },
  ] } as any)
  await $.tool.call({ tool: 'Bash', command: 'false' } as any)
  expect(during).toBe('Doing B · Running false · 0:00 · 1/2 tasks')

  const desk = await $.ui.mount({ plugin: 'turn-status', surface: 'desktop', component: 'AbovePrompt', props: ABOVE })
  expect(await desk.drawn()).toMatchObject({ type: 'Svg', props: { height: 34, alt: 'Doing B · Thinking · 0:00 · 1/2 tasks · 1 failed' } })
  await desk.unmount()

  const term = await $.ui.mount({ plugin: 'turn-status', surface: 'terminal', component: 'AbovePrompt', props: ABOVE })
  await term.resize({ columns: 120, rows: 1, in: 'band' } as any)
  await term.advance(300)
  expect(await term.find({ text: 'Doing B', in: 'band' })).toBeDefined()
  expect(await term.find({ text: /1 failed/, in: 'band' })).toBeDefined()
  await term.unmount()

  await $.turn.complete({ answer: '', durationMs: 3200, isAborted: false, turnId: 't1', reason: 'answer' } as any)
  const done = await $.ui.mount({ plugin: 'turn-status', surface: 'vscode', component: 'AbovePrompt', props: ABOVE })
  expect(await done.find({ text: 'Done in 0:03 · 1/2 tasks · 1 failed' })).toBeDefined()
  await done.unmount()

  await clock.advance(LINGER_MS + 10)
  const gone = await $.ui.mount({ plugin: 'turn-status', surface: 'vscode', component: 'AbovePrompt', props: ABOVE }).catch(() => null)
  if (gone !== null) expect(await gone.find({ text: /Done/ })).toBeUndefined()
})

test('a second copy of turn-status in the same chat gets one plain warning', async ($, on) => {
  const clock = mock.clock(on, { now: 1_760_000_000_000 })
  mock.env(on, { USERPROFILE: 'C:/Users/me' })
  const files = new Map<string, string>()
  const norm = (p: string) => p.split(String.fromCharCode(92)).join('/')
  on('fs.exists', ($: any, e: any) => ({ value: files.has(norm(e.path)) }) as any)
  on('fs.read', ($: any, e: any) => ({ value: files.get(norm(e.path)) }) as any)
  on('fs.write', ($: any, e: any) => { files.set(norm(e.path), e.text); return { value: undefined } as any })
  on('session.id', () => ({ value: 'chat-1' }) as any)
  const toasts: string[] = []
  on('ui.toast', ($: any, e: any) => { toasts.push(e.text); return { value: undefined } as any })
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: 'G:/q', surface: 'desktop', isInteractive: true })
  await clock.advance(2500)
  expect(toasts).toEqual([])
  // Two copies starting together in one chat.
  await $.session.start({ cwd: 'G:/q', surface: 'desktop', isInteractive: true })
  await $.session.start({ cwd: 'G:/q', surface: 'desktop', isInteractive: true })
  await clock.advance(2500)
  expect(toasts.filter(t => t.startsWith('⚠ turn-status is loaded twice'))).toHaveLength(1)
  expect(JSON.parse(files.get('C:/Users/me/.claude/turn-status/instances.json')!)).toHaveLength(3)
})
