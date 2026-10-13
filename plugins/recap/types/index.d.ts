/** Did the turn reach the goal the person asked for. */
export type Verdict = 'done' | 'in_progress' | 'blocked'

/** The kinds of direction a next move can push the project in; an option can serve several. */
export type Lane = 'fix' | 'debt' | 'feature' | 'design' | 'money' | 'growth' | 'ship' | 'wild'

/** One possible next move. */
export type Option = {
  id: string
  title: string
  /** what it is and why it matters, in plain words */
  detail: string
  /** the directions it serves, most related first */
  lanes: Lane[]
  /** value if done, 1 to 5 */
  impact: number
  effort: 'S' | 'M' | 'L'
  /** true when it turns on the person's own taste, ideas or business knowledge */
  needsYou: boolean
  /** the prompt that asks for it */
  prompt: string
  /** set when the idea worked in another of the person's projects: that project's name */
  borrowed?: string
}

/** A ready-made bundle of options: take it whole, or save it for later. */
export type Package = {
  name: string
  /** what the customer gets from it, in a sentence */
  pitch: string
  /** the options in it, by id, in the order they should be done */
  ids: string[]
}

export type Recap = {
  status: 'brewing' | 'ready' | 'error'
  turnId: string
  /** what the person asked for, as they typed it */
  ask: string
  tldr: string
  verdict: Verdict
  verdictWhy: string
  /** a short, jargon-free note about the work for the person's client (missing on older recaps) */
  client?: string
  options: Option[]
  packages: Package[]
  error: string
  /** set when /recap shows the project's latest recap from an earlier chat */
  origin?: 'earlier'
}

/** An option saved for later, kept per project across chats. */
export type BacklogItem = Option & { savedAt: number; /** the package it was saved with, if any */ pack?: string }

/** Where the work should end up. */
export type Deploy = 'local' | 'staging' | 'production'

/** Whether Claude interviews the person first or works on its own; `auto` decides per pick. */
export type Autonomy = 'auto' | 'interview' | 'solo'

/** The person's picks: option ids (from the recap or the backlog) in the order picked, and the lane in view. */
export type Picks = { turnId: string; chosen: string[]; lane: Lane | 'all' }

/** Settings that outlive a recap (kept in the plugin's store too, across sessions). */
export type Prefs = { size: 1 | 2 | 3; deploy: Deploy; autonomy: Autonomy }

/** Which tab of the pane is showing. */
export type View = 'options' | 'backlog' | 'interview'

/** One multiple-choice question Claude asked through the interview tool. */
export type Question = {
  question: string
  options: { label: string; hint: string; isRecommended: boolean }[]
  isMulti: boolean
}

/** Claude's questions and the person's answers so far. */
export type Interview = {
  id: string
  questions: Question[]
  /** per question, the indexes of the chosen options; -1 means "you decide" */
  answers: number[][]
  note: string
  status: 'open' | 'sent'
}

/** How often each lane has been in what the person sent: the gentle ranking nudge. */
export type Learned = Partial<Record<Lane, number>>

/** An idea the person picked and sent, remembered so other projects can borrow it. */
export type Win = { title: string; detail: string; prompt: string; lanes: Lane[]; effort: 'S' | 'M' | 'L'; project: string; at: number }

/** The last turn worth a recap, kept so a new take works after a reload too. */
export type Job = {
  turnId: string
  log: { ask: string; steps: string[]; edits: number; research: number; tools: number }
  answer: string
}

declare module 'claude-code' {
  interface PluginState {
    recap: {
      current: Recap | null
      job: Job | null
      picks: Picks | null
      prefs: Prefs
      backlog: BacklogItem[]
      learned: Learned
      interview: Interview | null
      view: View
      /** a plain warning for the pane header, such as a second copy of the mod */
      warning: string | null
      /** whether the "Explain to client" note is open */
      client: boolean
    }
  }
}
