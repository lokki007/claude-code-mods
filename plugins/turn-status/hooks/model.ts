import type { Snap, Task } from '../types'

// Pure state and wording, shared by the hooks module, both drawings and tests.

export const IDLE: Snap = {
  phase: 'idle',
  turnId: '',
  action: null,
  failed: 0,
  durationMs: 0,
  aborted: false,
  startedAt: 0,
  doneAt: 0,
  actionAt: 0,
  lastFailAt: 0,
  tasks: [],
  taskDoneAt: 0,
  taskDoneId: '',
}

/** How long the finished line stays before the band gets out of the way. */
export const LINGER_MS = 8000

const clip = (t: string, max: number) => {
  const one = t.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

const base = (p: unknown) =>
  typeof p === 'string' ? (p.split(/[\\/]/).pop() ?? p) : ''

const host = (u: unknown) => {
  try {
    return new URL(String(u)).host
  } catch {
    return ''
  }
}

/** A tool call in words: verb and target ("Editing svg.ts", "Running npm test"). */
export const describeTool = (e: { tool: string } & Record<string, any>): string => {
  switch (e.tool) {
    case 'Read':
      return `Reading ${base(e.file_path)}`
    case 'Edit':
      return `Editing ${base(e.file_path)}`
    case 'Write':
      return `Writing ${base(e.file_path)}`
    case 'NotebookEdit':
      return `Editing ${base(e.notebook_path)}`
    case 'Bash':
    case 'PowerShell':
      return `Running ${clip(String(e.command ?? '').split('\n')[0] ?? '', 40)}`
    case 'Grep':
      return `Searching for “${clip(String(e.pattern ?? ''), 28)}”`
    case 'Glob':
      return `Finding ${clip(String(e.pattern ?? ''), 32)}`
    case 'WebFetch':
      return `Reading ${host(e.url) || 'a web page'}`
    case 'WebSearch':
      return `Searching the web for “${clip(String(e.query ?? ''), 28)}”`
    case 'Agent':
    case 'Task':
      return `Delegating: ${clip(String(e.description ?? 'a subtask'), 36)}`
    case 'Skill':
      return `Using ${String(e.skill ?? 'a skill')}`
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
    case 'TaskList':
    case 'TaskGet':
      return 'Updating the plan'
    default: {
      const mcp = /^mcp__(.+?)__(.+)$/.exec(e.tool)
      if (mcp) return `Using ${(mcp[2] ?? '').replace(/_/g, ' ')}`
      return `Using ${e.tool}`
    }
  }
}

export type TaskCall =
  | { tool: 'TodoWrite'; todos: { content: string; status: Task['status']; activeForm: string }[] }
  | { tool: 'TaskCreate'; subject: string; activeForm?: string; createdId: string }
  | { tool: 'TaskUpdate'; taskId: string; subject?: string; activeForm?: string; status?: Task['status'] | 'deleted' }

export const taskCallOf = (e: { tool: string } & Record<string, any>, result: any): TaskCall | null => {
  if (e.tool === 'TodoWrite' && Array.isArray(e.todos)) return { tool: 'TodoWrite', todos: e.todos }
  if (e.tool === 'TaskCreate' && typeof result?.task?.id === 'string') {
    return { tool: 'TaskCreate', subject: e.subject, activeForm: e.activeForm, createdId: result.task.id }
  }
  if (e.tool === 'TaskUpdate' && typeof e.taskId === 'string') {
    return { tool: 'TaskUpdate', taskId: e.taskId, subject: e.subject, activeForm: e.activeForm, status: e.status }
  }
  return null
}

/** The task list after one task tool call. */
export const applyTaskCall = (prev: Snap, call: TaskCall, now: number): Snap => {
  const s: Snap = { ...IDLE, ...prev }
  let tasks: Task[]
  if (call.tool === 'TodoWrite') {
    tasks = call.todos.map((t, i) => ({ id: `todo-${i}`, title: t.content, active: t.activeForm || null, status: t.status }))
  } else if (call.tool === 'TaskCreate') {
    const isFinished = s.tasks.length > 0 && s.tasks.every(t => t.status === 'completed')
    tasks = [
      ...(isFinished ? [] : s.tasks),
      { id: call.createdId, title: call.subject, active: call.activeForm ?? null, status: 'pending' },
    ]
  } else {
    tasks = s.tasks.flatMap(t => {
      if (t.id !== call.taskId) return [t]
      if (call.status === 'deleted') return []
      return [{ ...t, title: call.subject ?? t.title, active: call.activeForm ?? t.active, status: call.status ?? t.status }]
    })
  }
  const wasDone = new Set(s.tasks.filter(t => t.status === 'completed').map(t => t.id))
  const justDone = tasks.find(t => t.status === 'completed' && !wasDone.has(t.id))
  return {
    ...s,
    tasks,
    taskDoneAt: justDone ? now : s.taskDoneAt,
    taskDoneId: justDone ? justDone.id : s.taskDoneId,
  }
}

export const fmtClock = (ms: number): string => {
  const s = Math.floor(Math.max(0, ms) / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** What the line says, in priority order: the task, then the tool doing it. */
export type Words = {
  /** the main words: the running task, else the tool action, else "Thinking" */
  headline: string
  /** the tool action under a running task, when there is one */
  detail: string | null
  /** "2/5" when there is a task list */
  progress: string | null
  done: number
  total: number
}

export const words = (s: Snap): Words => {
  const current = s.tasks.find(t => t.status === 'in_progress')
  const done = s.tasks.filter(t => t.status === 'completed').length
  const total = s.tasks.length
  const task = current ? (current.active ?? current.title) : null
  const action = s.action ?? 'Thinking'
  return {
    headline: task ?? action,
    detail: task ? action : null,
    progress: total > 0 ? `${done}/${total}` : null,
    done,
    total,
  }
}

/** The whole line as plain text: the fallback drawing and the image's alt. */
export const plainLine = (s: Snap, now: number): string => {
  const w = words(s)
  const failed = s.failed > 0 ? ` · ${s.failed} failed` : ''
  const tasks = w.progress ? ` · ${w.progress} tasks` : ''
  if (s.phase === 'working') {
    return `${w.headline}${w.detail ? ` · ${w.detail}` : ''} · ${fmtClock(now - s.startedAt)}${tasks}${failed}`
  }
  return `${s.aborted ? 'Interrupted' : 'Done'} in ${fmtClock(s.durationMs)}${tasks}${failed}`
}
