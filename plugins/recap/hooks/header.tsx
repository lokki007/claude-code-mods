import type { ClientSettings, Tone, View } from '../types'
import { TONES } from './client'
import type { Els, Size } from './look'
import { HEAD_H } from './look'

// The top of the pane: the owl and one line of status, the buttons beside it,
// the "Explain to client" box, and the tabs.

export type HeaderProps = {
  mascot: unknown
  /** already escaped for Markdown */
  headline: string
  size: Size
  /** pieces of work finished in a row, shown quietly from two */
  streak: number
  warning: string | null
  isNarrow: boolean
  hasOptions: boolean
  isClientOpen: boolean
  canAgain: boolean
  onClient: () => void
  onSmaller: () => void
  onBigger: () => void
  onAgain: () => void
}

export const headerView = (els: Els, p: HeaderProps) => {
  const { Box, Text, Button, Markdown } = els
  const actions = [
    p.hasOptions
      ? <Button key="client" variant={p.isClientOpen ? 'primary' : 'secondary'} onPress={p.onClient}>✉ Explain to client</Button>
      : null,
    <Button key="smaller" variant="secondary" onPress={p.onSmaller}>A−</Button>,
    <Button key="bigger" variant="secondary" onPress={p.onBigger}>A+</Button>,
    p.canAgain ? <Button key="again" variant="secondary" onPress={p.onAgain}>↻ New options</Button> : null,
  ]
  const title = (
    <Box flexShrink={1} flexGrow={1} flexDirection="column">
      <Markdown text={`${HEAD_H[p.size]}${p.headline}`} />
      {p.streak >= 2 ? <Text dimColor>{`${p.streak} pieces of work finished in a row`}</Text> : null}
    </Box>
  )
  // On a narrow pane the buttons get their own row, so the status line keeps its width.
  return p.isNarrow
    ? (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" alignItems="center" gap={1}>{p.mascot}{title}</Box>
        <Box key="header-actions" flexDirection="row" flexWrap="wrap" gap={1}>{actions}</Box>
        {p.warning ? <Text color="#E5A84D">{p.warning}</Text> : null}
      </Box>
    )
    : (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" alignItems="center" gap={1}>{p.mascot}{title}{actions}</Box>
        {p.warning ? <Text color="#E5A84D">{p.warning}</Text> : null}
      </Box>
    )
}

export type ClientBoxProps = {
  note: string
  settings: ClientSettings
  /** 'none', 'writing', 'on', 'off' or 'error': the state of the "even simpler" rewrite */
  simpler: 'none' | 'writing' | 'on' | 'off' | 'error'
  /** where the pane has no text field: how to set the name and sign-off instead */
  hint: string
  canType: boolean
  onCopy: (press: { surface: any }) => void
  onSimpler: () => void
  onTone: (tone: Tone) => void
  onName: (value: string, isDone: boolean) => void
  onSignoff: (value: string, isDone: boolean) => void
  onClose: () => void
}

const SIMPLER_LABEL = { none: '🧸 Even simpler', off: '🧸 Even simpler', writing: '🧸 Simplifying…', on: '🧸 Back to normal', error: '🧸 Try simpler again' } as const

/** "Explain to client": the note to copy, its tone, the client's name and the sign-off. */
export const clientBoxView = (els: Els, p: ClientBoxProps) => {
  const { Box, Text, Button } = els
  const Input = p.canType ? els.Input : null
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="#7FB77E" paddingX={1}>
      <Text bold>{p.settings.name.trim() ? `For ${p.settings.name.trim()}` : 'For your client'}</Text>
      <Text>{p.note}</Text>
      <Box flexDirection="row" flexWrap="wrap" gap={1} marginTop={1}>
        <Button key="client-copy" variant="primary" onPress={p.onCopy}>Copy</Button>
        <Button key="client-simpler" variant={p.simpler === 'on' ? 'primary' : 'secondary'} onPress={p.onSimpler}>{SIMPLER_LABEL[p.simpler]}</Button>
        <Button key="client-close" variant="secondary" onPress={p.onClose}>Close</Button>
      </Box>
      <Box flexDirection="row" flexWrap="wrap" gap={1} marginTop={1}>
        {(Object.keys(TONES) as Tone[]).map(t => (
          <Button key={`tone-${t}`} variant={p.settings.tone === t ? 'primary' : 'secondary'} onPress={() => p.onTone(t)}>
            {`${p.settings.tone === t ? '◉' : '○'} ${TONES[t].label}`}
          </Button>
        ))}
      </Box>
      {Input
        ? (
          <Box flexDirection="column" marginTop={1}>
            <Input
              key="client-name"
              placeholder="Client's name (optional)"
              value={p.settings.name}
              onInput={(value: string) => p.onName(value, false)}
              onSubmit={(value: string) => p.onName(value, true)}
            />
            <Input
              key="client-signoff"
              placeholder="Your sign-off, like your name (optional)"
              value={p.settings.signoff}
              onInput={(value: string) => p.onSignoff(value, false)}
              onSubmit={(value: string) => p.onSignoff(value, true)}
            />
          </Box>
        )
        : p.hint ? <Text dimColor>{p.hint}</Text> : null}
    </Box>
  )
}

export type TabsProps = {
  view: View
  hasInterview: boolean
  optionsCount: number | null
  savedCount: number
  onView: (v: View) => void
}

export const tabsView = (els: Els, p: TabsProps) => {
  const { Box, Button } = els
  return (
    <Box flexDirection="row" flexWrap="wrap" gap={1}>
      {p.hasInterview
        ? <Button key="tab-interview" variant={p.view === 'interview' ? 'primary' : 'secondary'} onPress={() => p.onView('interview')}>💬 Questions</Button>
        : null}
      {p.optionsCount !== null
        ? <Button key="tab-options" variant={p.view === 'options' ? 'primary' : 'secondary'} onPress={() => p.onView('options')}>{`Options ${p.optionsCount}`}</Button>
        : null}
      <Button key="tab-backlog" variant={p.view === 'backlog' ? 'primary' : 'secondary'} onPress={() => p.onView('backlog')}>{`☆ Saved ${p.savedCount}`}</Button>
    </Box>
  )
}
