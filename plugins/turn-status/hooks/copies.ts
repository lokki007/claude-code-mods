// Spotting a second copy of this mod loaded in the same chat (the same check recap makes).

/** A copy of the mod announcing itself in a chat. */
export type Instance = { session: string; token: string; root: string; at: number }

const DAY = 86_400_000

/** Where the copy registry lives. */
export const registryPath = (home: string) => `${home.replace(/\\/g, '/').replace(/\/+$/, '')}/.claude/turn-status/instances.json`

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

export const duplicateWarning = (me: Instance, others: readonly Instance[]) =>
  `⚠ turn-status is loaded twice in this chat (${[me, ...others].map(i => i.root).join(' and ')}). `
  + 'Two copies can clash; remove one from your plugins and restart the chat.'
