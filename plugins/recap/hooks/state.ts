import type { Picks, Prefs } from '../types'
import type { TurnLog } from './recap'

// What the recap remembers outside its atoms: fixed names, store keys and this chat's paths.
// (The atoms live in register.tsx: the engine reads them only where they are declared.)

export const PANE = 'recap'
export const TITLE = '✨ Next'
export const PANE_ROWS = 30
export const TOOL = 'mcp__recap__interview'
export const DEFAULT_PREFS: Prefs = { size: 2, deploy: 'local', autonomy: 'auto' }

export const EMPTY_LOG: TurnLog = { ask: '', steps: [], edits: 0, research: 0, tools: 0 }

/** The store key of this project's backlog: one list per folder the chat runs in. */
export const backlogKey = (cwd: string) => `backlog:${cwd.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()}`
/** The store key of a project's client name, sign-off and tone. */
export const clientKey = (project: string) => `client-settings:${project}`
/** The store key of a project's run of finished work. */
export const streakKey = (project: string) => `streak:${project}`

export const freshPicks = (turnId: string): Picks => ({ turnId, chosen: [], lane: 'all' })

/** This chat's paths and project, and the command that opens the pane here; filled in at session start. */
export const here = { dir: '', cwd: '', project: '', command: 'recap' }
