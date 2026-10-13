import type { Recap } from '../types'
import type { TurnLog } from './recap'

// Pure parts of the recap's memory: why a turn got no recap, the per-project
// diary and reminder, the debug log, and spotting a second copy of the mod.

/** Where the mod keeps its files: the log, the diaries and the copy check. */
export const dataDir = (home: string) => `${home.replace(/\\/g, '/').replace(/\/+$/, '')}/.claude/recap`

/** One key per project folder, whatever the slashes or case. */
export const projectKey = (cwd: string) => cwd.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** The project's folder name, for headings and file names. */
export const projectName = (cwd: string) => cwd.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || 'project'

/** A file-safe name for the project's diary: its folder name plus a short hash of the full path. */
export const diaryFile = (dir: string, cwd: string) => {
  const key = projectKey(cwd)
  let h = 0
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const name = projectName(cwd).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project'
  return `${dir}/diary/${name}-${h.toString(36)}.md`
}

/** Why a finished turn got no recap pane, in a few plain words, or null when it qualifies. */
export const skipReason = (log: TurnLog, answer: string, isAborted: boolean): string | null => {
  if (isAborted) return 'the turn was interrupted'
  if (!answer.trim()) return 'Claude gave no reply'
  if (log.edits >= 1 || log.research >= 3 || log.tools >= 5) return null
  if (log.tools === 0) return 'nothing was changed, it was just a chat'
  return 'too little was changed or looked up'
}

const DAY = 86_400_000
const when = (at: number) => new Date(at).toISOString().replace('T', ' ').slice(0, 16)
const LABEL = { done: 'Done', in_progress: 'In progress', blocked: 'Blocked' } as const

/** The diary's opening lines, written once per project. */
export const diaryHeader = (cwd: string) =>
  `# ${projectName(cwd)}: progress log\n\nWhat was worked on, newest last. Each entry is written when a piece of work finishes.\n`

/** One diary entry: plain, client-readable, no internal jargon. */
export const diaryEntry = (r: Recap, at: number) => {
  const asked = r.ask.trim() && !r.ask.startsWith('this conversation') ? `\n- **Asked for:** ${r.ask.replace(/\s+/g, ' ').slice(0, 240)}` : ''
  const why = r.verdictWhy ? ` (${r.verdictWhy})` : ''
  return `\n## ${when(at)} UTC\n\n- **What was done:** ${r.tldr}${asked}\n- **Status:** ${LABEL[r.verdict]}${why}\n`
}

/** The most recent recap of a project, kept across chats. */
export type ProjectLast = { recap: Recap; at: number }

/**
 * A gentle nudge when a chat opens on a project whose last piece of work was
 * left unfinished: what it was and one next step. Null when there is nothing
 * to nudge about (it was done, or it is more than two weeks old).
 */
export const reminderFor = (last: ProjectLast | undefined, now: number, topTitle?: string): string | null => {
  if (!last || last.recap.status !== 'ready' || last.recap.verdict === 'done') return null
  const age = now - last.at
  if (age < 0 || age > 14 * DAY) return null
  const days = Math.floor(age / DAY)
  const ago = days === 0 ? 'earlier today' : days === 1 ? 'yesterday' : `${days} days ago`
  const state = last.recap.verdict === 'blocked' ? 'was blocked' : 'was left in progress'
  const step = topTitle ? ` Next step: ${topTitle}.` : ''
  return `🦉 ${ago} here: "${last.recap.tldr}" ${state}.${step} /recap shows it.`
}

/** The log with one more line, keeping the newest lines only. */
export const appendLine = (existing: string, line: string, keep = 2000) => {
  const lines = existing.split('\n').filter(Boolean)
  lines.push(line)
  return `${lines.slice(-keep).join('\n')}\n`
}

/** A copy of the mod announcing itself in a chat. */
export type Instance = { session: string; token: string; root: string; at: number }

/** The copy registry with this copy added and day-old entries dropped. */
export const withInstance = (raw: string, me: Instance): Instance[] => {
  let list: Instance[] = []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) list = parsed.filter(i => i && typeof i.token === 'string')
  } catch {
    list = []
  }
  return [...list.filter(i => i.token !== me.token && me.at - i.at < DAY), me]
}

/** Other copies that started in the same chat at the same moment: a second copy of the mod. */
export const otherCopies = (list: readonly Instance[], me: Instance, windowMs = 5000): Instance[] =>
  list.filter(i => i.session === me.session && i.token !== me.token && Math.abs(i.at - me.at) < windowMs)

export const duplicateWarning = (mod: string, me: Instance, others: readonly Instance[]) =>
  `⚠ ${mod} is loaded twice in this chat (${[me, ...others].map(i => i.root).join(' and ')}). `
  + 'Two copies can clash; remove one from your plugins and restart the chat.'
