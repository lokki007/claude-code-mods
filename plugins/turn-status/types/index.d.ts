export type Task = {
  id: string
  title: string
  /** present-continuous form shown while it runs ("Running tests") */
  active: string | null
  status: 'pending' | 'in_progress' | 'completed'
}

export type Snap = {
  phase: 'idle' | 'working' | 'done'
  turnId: string
  /** what the running tool is doing ("Editing svg.ts"); null between tools */
  action: string | null
  failed: number
  durationMs: number
  aborted: boolean
  /** epoch ms: turn start, turn end, last action change, last failure */
  startedAt: number
  doneAt: number
  actionAt: number
  lastFailAt: number
  /** Claude's task list (TodoWrite / TaskCreate / TaskUpdate), kept across turns */
  tasks: Task[]
  taskDoneAt: number
  taskDoneId: string
}

declare module 'claude-code' {
  interface PluginState {
    'turn-status': { snap: Snap }
  }
}
