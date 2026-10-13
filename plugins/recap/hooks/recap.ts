import type { Autonomy, BacklogItem, Deploy, Interview, Lane, Learned, Option, Question, Verdict } from '../types'

// Pure parts: when a turn earns a recap, what to ask the model, reading its
// answer, ranking the options, and building the next prompt from the picks.

export type TurnLog = {
  ask: string
  steps: string[]
  edits: number
  research: number
  tools: number
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])
const RESEARCH_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'Agent', 'Task'])

const base = (p: unknown) => (typeof p === 'string' ? (p.split(/[\\/]/).pop() ?? p) : '')
const one = (t: unknown, max: number) => {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** One step of the turn in a few words, for the model to read. */
export const stepOf = (e: { tool: string } & Record<string, any>): string => {
  switch (e.tool) {
    case 'Read':
    case 'Edit':
    case 'Write':
      return `${e.tool} ${base(e.file_path)}`
    case 'Bash':
    case 'PowerShell':
      return `ran: ${one(e.command, 80)}`
    case 'Grep':
      return `searched code for "${one(e.pattern, 40)}"`
    case 'Glob':
      return `listed files ${one(e.pattern, 40)}`
    case 'WebFetch':
      return `read web page ${one(e.url, 80)}`
    case 'WebSearch':
      return `searched the web for "${one(e.query, 60)}"`
    case 'Agent':
    case 'Task':
      return `delegated: ${one(e.description, 60)}`
    default:
      return e.tool
  }
}

export const logTool = (log: TurnLog, e: { tool: string } & Record<string, any>): TurnLog => ({
  ...log,
  steps: [...log.steps, stepOf(e)].slice(-40),
  tools: log.tools + 1,
  edits: log.edits + (EDIT_TOOLS.has(e.tool) ? 1 : 0),
  research: log.research + (RESEARCH_TOOLS.has(e.tool) ? 1 : 0),
})

/** Worth a recap: something was changed, or real digging happened. */
export const isWorthRecap = (log: TurnLog, answer: string, isAborted: boolean): boolean =>
  !isAborted && answer.trim().length >= 80 && (log.edits >= 1 || log.research >= 3 || log.tools >= 5)

/** The lanes, in the order the pane lists them: icon, name, colour. */
export const LANES: Record<Lane, { icon: string; name: string; color: string }> = {
  fix: { icon: '🐞', name: 'Fix', color: '#F2777B' },
  debt: { icon: '🧹', name: 'Tech debt', color: '#9AA4B2' },
  feature: { icon: '✨', name: 'Features', color: '#6A9BCC' },
  design: { icon: '🎨', name: 'UI & design', color: '#E88AB4' },
  money: { icon: '💰', name: 'Money', color: '#3FB950' },
  growth: { icon: '📣', name: 'Growth & leads', color: '#E5A84D' },
  ship: { icon: '🚀', name: 'Ship & ops', color: '#56C1C9' },
  wild: { icon: '🧪', name: 'Wild ideas', color: '#A487E0' },
}
export const LANE_KEYS = Object.keys(LANES) as Lane[]

const SHAPE = `Reply with JSON only, no code fence, exactly these keys:
"tldr": at most 20 words: what was done and the outcome
"verdict": "done" when the goal the person asked for is fully reached and verified, "in_progress" when part of it remains, "blocked" when it cannot go on without the person
"verdict_why": at most 12 words
"options": 14 to 20 possible next moves for this project, as varied as you can make them, so the person can scan them all and pick the vital few. Use everything you saw in the code and the conversation: bugs, inconsistencies, shortcuts, missed opportunities, and where the project could go. Cover at least 5 of these lanes:
  "fix": bugs, broken or unverified things
  "debt": refactors, inconsistencies, cleanup, missing tests
  "feature": new or better product capability
  "design": UI, UX, look and feel, wording
  "money": revenue, pricing, monetisation
  "growth": users, leads, marketing, distribution
  "ship": deploying, releasing, monitoring, operations
  "wild": fresh, bold or creative bets the person probably has not thought of (at least 3 of these)
Each option is {"title": at most 9 plain words, "detail": at most 18 words on what it is and why it matters, "lanes": 1 to 3 lane keys, most related first, "impact": 1 to 5 for the value if done, "effort": "S", "M" or "L", "needs_you": true when it turns on the person's own taste, ideas or business knowledge (a new feature, a design direction, pricing), false when it can be done well from the code alone (bugs, refactors, tests, deploys), "prompt": the prompt that asks for it, first person, imperative, at most 35 words}.
The person is not very technical: write titles and details in plain language, and never plan to ask them technical questions.`

/** For a fork of the session: the model already has the whole conversation. */
export const forkPrompt = (answer: string): string =>
  `[Recap request from the person's recap pane, not a new task. Do not continue the work.]
Recap the turn that just finished against the goal the person asked for, then lay out what could come next. Your last reply follows, in case it is not above:
"""
${answer.slice(0, 6000)}
"""
Be accurate to what was actually done and verified; never invent results.
${SHAPE}`

export const SYSTEM = `You recap a coding assistant's finished work against the goal the person asked for, then lay out what could come next.
Be accurate to what was actually done and verified; never invent results.
${SHAPE}`

export const promptFor = (log: TurnLog, answer: string): string => {
  const steps = log.steps.length > 0 ? log.steps.map(s => `- ${s}`).join('\n') : '- (no tools)'
  return `The person asked:\n${one(log.ask, 1200) || '(continuation of earlier work)'}\n\nWhat the assistant did, in order:\n${steps}\n\nThe assistant's final reply:\n${answer.slice(0, 6000)}`
}

export type Takes = { tldr: string; verdict: Verdict; verdictWhy: string; options: Option[] }

const str = (x: unknown): string => (typeof x === 'string' ? x.trim() : '')
const list = (x: unknown): any[] => (Array.isArray(x) ? x : [])
const VERDICTS = new Set<Verdict>(['done', 'in_progress', 'blocked'])
const EFFORTS = new Set(['S', 'M', 'L'])

/** Reads the model's JSON, tolerating a code fence or chatter around it. */
export const parseTakes = (text: string): Takes | null => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const j = JSON.parse(text.slice(start, end + 1))
    const tldr = str(j.tldr)
    if (!tldr || !VERDICTS.has(j.verdict)) return null
    const options: Option[] = list(j.options)
      .map((o, i) => {
        const lanes = [...new Set(list(o?.lanes).filter((l): l is Lane => l in LANES))].slice(0, 3)
        const impact = Math.min(5, Math.max(1, Math.round(Number(o?.impact) || 3)))
        return {
          id: `o${i}`,
          title: str(o?.title),
          detail: str(o?.detail),
          lanes: lanes.length > 0 ? lanes : (['feature'] as Lane[]),
          impact,
          effort: EFFORTS.has(o?.effort) ? o.effort : 'M',
          needsYou: o?.needs_you === true,
          prompt: str(o?.prompt),
        }
      })
      .filter(o => o.title && o.prompt)
      .slice(0, 24)
    if (options.length === 0) return null
    return { tldr, verdict: j.verdict, verdictWhy: str(j.verdict_why), options }
  } catch {
    return null
  }
}

const EFFORT_COST = { S: 1, M: 1.25, L: 1.6 } as const

/** At most this much lift from the person's habits: a nudge, never a takeover. */
const LEARN_LIFT = 0.3
/** Picks it takes before the habits count at all. */
export const LEARN_MIN = 3

/** How much the person leans to each lane, 0 to 1 against their favourite. */
export const affinity = (learned: Learned): Partial<Record<Lane, number>> => {
  const counts = Object.values(learned).filter((n): n is number => typeof n === 'number')
  const total = counts.reduce((a, b) => a + b, 0)
  const top = Math.max(0, ...counts)
  if (total < LEARN_MIN || top === 0) return {}
  const out: Partial<Record<Lane, number>> = {}
  for (const l of LANE_KEYS) if (learned[l]) out[l] = (learned[l] as number) / top
  return out
}

/**
 * The 80/20 score: value per effort, lifted for options that serve several
 * directions at once, since those move more of the project with one change,
 * and lifted a little for the directions the person usually picks.
 */
export const score = (o: Option, learned: Learned = {}): number => {
  const lean = affinity(learned)
  const habit = Math.max(0, ...o.lanes.map(l => lean[l] ?? 0))
  return ((o.impact * (1 + 0.4 * (o.lanes.length - 1))) / EFFORT_COST[o.effort]) * (1 + LEARN_LIFT * habit)
}

/** Options best-first; ties keep the model's order. */
export const ranked = (options: readonly Option[], learned: Learned = {}): Option[] =>
  options.map((o, i) => ({ o, i, s: score(o, learned) })).sort((a, b) => b.s - a.s || a.i - b.i).map(x => x.o)

/** The vital few: the top three overall. */
export const topPicks = (options: readonly Option[], learned: Learned = {}): Set<string> =>
  new Set(ranked(options, learned).slice(0, 3).map(o => o.id))

/** The best option in each lane it serves. */
export const bestInLane = (options: readonly Option[], learned: Learned = {}): Map<Lane, string> => {
  const best = new Map<Lane, string>()
  for (const o of ranked(options, learned)) for (const l of o.lanes) if (!best.has(l)) best.set(l, o.id)
  return best
}

/** The habits after the person sends a prompt built from these picks. */
export const learnFrom = (learned: Learned, picked: readonly Option[]): Learned => {
  const out: Learned = { ...learned }
  for (const o of picked) for (const l of o.lanes) out[l] = (out[l] ?? 0) + 1
  return out
}

/** The lanes the person leans to most, for the pane to say so. */
export const favourites = (learned: Learned): Lane[] => {
  const lean = affinity(learned)
  return (Object.keys(lean) as Lane[])
    .filter(l => (lean[l] ?? 0) >= 0.6)
    .sort((a, b) => (lean[b] ?? 0) - (lean[a] ?? 0))
    .slice(0, 3)
}

/** Whether a backlog already holds this option (same title and prompt). */
export const isSaved = (backlog: readonly BacklogItem[], o: Option): boolean =>
  backlog.some(b => b.title === o.title && b.prompt === o.prompt)

/** The backlog with this option added (newest first), or taken out when already there. */
export const toggleSaved = (backlog: readonly BacklogItem[], o: Option, now: number): BacklogItem[] =>
  isSaved(backlog, o)
    ? backlog.filter(b => !(b.title === o.title && b.prompt === o.prompt))
    : [{ ...o, id: `bk-${now.toString(36)}`, savedAt: now }, ...backlog].slice(0, 100)

export const DEPLOY: Record<Deploy, { label: string; text: string }> = {
  local: { label: 'Keep it local', text: 'Keep it local for now; do not deploy anything.' },
  staging: { label: 'Staging', text: 'Once it works locally, deploy to staging and check it there.' },
  production: { label: 'Production', text: 'Once it works, deploy to production and check it is live and working.' },
}

export const AUTONOMY: Record<Autonomy, { label: string; hint: string }> = {
  auto: { label: 'Auto', hint: 'interview me only when a pick needs my ideas' },
  interview: { label: 'Interview me first', hint: 'questions before work' },
  solo: { label: 'Just do it', hint: 'no questions, your call' },
}

const INTERVIEW = 'Before you start, interview me with the recap interview tool: up to 5 short, plain-language multiple-choice questions about what I want (goals, taste, priorities). I am not technical, so make every technical decision yourself.'
const SOLO = 'Do not stop to ask me questions: make sensible decisions yourself and tell me briefly what you chose.'

const sentence = (t: string) => (/[.!?]$/.test(t) ? t : `${t}.`)
const clause = (t: string) => t.replace(/[.!?]$/, '')

/** Whether the prompt will ask for an interview, given the picks. */
export const willInterview = (picked: readonly Option[], autonomy: Autonomy): boolean =>
  autonomy === 'interview' || (autonomy === 'auto' && picked.some(o => o.needsYou))

/**
 * The next prompt: the first pick is the main job, the rest ride along, then
 * where it should end up and whether to interview first.
 */
export const composePrompt = (
  /** every option that can be picked: this recap's and the backlog's */
  options: readonly Option[],
  chosen: readonly string[],
  deploy: Deploy,
  autonomy: Autonomy,
): string => {
  const picked = chosen.map(id => options.find(o => o.id === id)).filter((o): o is Option => o !== undefined)
  const [main, ...rest] = picked
  if (main === undefined) return ''
  const parts = [sentence(main.prompt)]
  const [only] = rest
  if (rest.length === 1 && only) parts.push(`Also ${clause(only.prompt).replace(/^./, c => c.toLowerCase())}.`)
  else if (rest.length > 1) parts.push(`Also:\n${rest.map(o => `- ${clause(o.prompt)}`).join('\n')}`)
  parts.push(DEPLOY[deploy].text)
  parts.push(willInterview(picked, autonomy) ? INTERVIEW : SOLO)
  return parts.join('\n\n')
}

/** The interview tool's input schema, as the model sees it. */
export const INTERVIEW_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      description: 'Up to 5 short questions in plain, non-technical language about goals, taste and priorities.',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The question, at most 15 plain words.' },
          options: {
            type: 'array',
            minItems: 2,
            maxItems: 5,
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: 'The answer, at most 6 words.' },
                hint: { type: 'string', description: 'Optional: what choosing it means, at most 12 words.' },
                recommended: { type: 'boolean', description: 'True for the one answer you would suggest.' },
              },
              required: ['label'],
            },
          },
          multi: { type: 'boolean', description: 'True when several answers can be chosen together.' },
        },
        required: ['question', 'options'],
      },
    },
  },
  required: ['questions'],
}

export const INTERVIEW_DESCRIPTION = 'Ask the person multiple-choice questions in their recap pane, where they answer with a click. '
  + 'Use it whenever you need their input before starting (instead of asking in plain text): goals, taste, priorities, never technical questions. '
  + 'After calling it, end your turn without doing the work: their answers arrive as their next message.'

/** Reads the model's questions; null when there is nothing askable. */
export const parseQuestions = (input: unknown): Question[] | null => {
  const questions = list((input as any)?.questions)
    .map(q => {
      const options = list(q?.options)
        .map(o => (typeof o === 'string'
          ? { label: o.trim(), hint: '', isRecommended: false }
          : { label: str(o?.label), hint: str(o?.hint), isRecommended: o?.recommended === true }))
        .filter(o => o.label)
        .slice(0, 6)
      return { question: str(q?.question), options, isMulti: q?.multi === true }
    })
    .filter(q => q.question && q.options.length >= 2)
    .slice(0, 5)
  return questions.length > 0 ? questions : null
}

export const newInterview = (questions: Question[], now: number): Interview => ({
  id: `iv-${now.toString(36)}`,
  questions,
  answers: questions.map(() => []),
  note: '',
  status: 'open',
})

/** The answers after a click: a single-choice question swaps, a multi-choice one toggles; -1 is "you decide". */
export const answer = (iv: Interview, qi: number, oi: number): Interview => {
  const q = iv.questions[qi]
  if (!q) return iv
  const was = iv.answers[qi] ?? []
  let now: number[]
  if (oi === -1 || !q.isMulti) now = was.length === 1 && was[0] === oi ? [] : [oi]
  else now = (was.includes(oi) ? was.filter(x => x !== oi) : [...was.filter(x => x !== -1), oi]).sort((a, b) => a - b)
  return { ...iv, answers: iv.answers.map((a, i) => (i === qi ? now : a)) }
}

/** The reply the person sends: each question with what they chose; unanswered ones are left to Claude. */
export const answersText = (iv: Interview): string => {
  const lines = iv.questions.map((q, i) => {
    const picked = iv.answers[i] ?? []
    const said = picked.length === 0 || picked.includes(-1)
      ? 'you decide'
      : picked.map(oi => q.options[oi]?.label).filter(Boolean).join(', ')
    return `${i + 1}. ${q.question}\n   → ${said}`
  })
  const note = iv.note.trim() ? `\n\nAlso: ${iv.note.trim()}` : ''
  return `My answers:\n\n${lines.join('\n')}${note}\n\nGo ahead, and make every technical decision yourself.`
}
