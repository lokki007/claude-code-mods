// The recap's command: what its words mean, and the messages that name it.
// Newer Claude versions have a /recap of their own, so the command may be /next;
// every message names the one that works in that chat.

/** Used when Claude refuses /recap (newer versions have a built-in one). */
export const FALLBACK_COMMAND = 'next'

export const COMMAND_DESCRIPTION =
  'Show the next-prompt pane; add "again" for new options, "diary" or "page" for the progress updates, "client <name>" or "signoff <text>" for client notes, "log" for the debug log'

export type Command =
  | { kind: 'open' }
  | { kind: 'again' }
  | { kind: 'diary' }
  | { kind: 'page' }
  | { kind: 'log' }
  | { kind: 'client'; value: string }
  | { kind: 'signoff'; value: string }

/** Reads what follows the command: "again", "diary", "client Acme Bakery" and so on. */
export const parseCommand = (args: string): Command => {
  const text = args.trim()
  const [word = '', ...rest] = text.split(/\s+/)
  const value = rest.join(' ').trim().slice(0, 80)
  switch (word.toLowerCase()) {
    case 'again': return { kind: 'again' }
    case 'diary': return { kind: 'diary' }
    case 'page': return { kind: 'page' }
    case 'log': return { kind: 'log' }
    case 'client': return { kind: 'client', value }
    case 'signoff':
    case 'sign-off': return { kind: 'signoff', value }
    default: return { kind: 'open' }
  }
}

/** "/next", or nothing when no command could be registered in this chat. */
const named = (command: string) => (command ? `/${command}` : '')

/** Said once when the pane answers to the fallback name. */
export const fallbackNotice = () =>
  `Claude now has its own /recap, so the ✨ Next pane opens with /${FALLBACK_COMMAND} instead.`

/** Why a turn got no pane, and how to get one anyway. */
export const noRecapToast = (why: string, command: string) =>
  `No recap this time: ${why}.${command ? ` ${named(command)} makes one anyway.` : ''}`

/** How to set the client's name where the pane has no text field (the mobile app). */
export const clientHint = (command: string) =>
  command ? `Set the client's name with ${named(command)} client Name, and your sign-off with ${named(command)} signoff Name.` : ''
