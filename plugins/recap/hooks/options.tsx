import type { BacklogItem, Lane, Option, Picks } from '../types'
import type { Els, Size } from './look'
import { EFFORT, TITLE_H, strong } from './look'
import { LANES, md, plain } from './recap'

// The list side of the pane: the options (lanes, learning line, rows)
// or the saved backlog.

type RowActions = {
  /** the pick number of each picked option: 0 is the main job */
  orderOf: (id: string) => number
  onPick: (id: string) => void
}

const pickButton = (els: Els, o: Option, a: RowActions) => {
  const order = a.orderOf(o.id)
  const label = order === -1 ? '+ Pick' : order === 0 ? '✓ 1 main' : `✓ ${order + 1}`
  return (
    <els.Button key={`pick-${o.id}`} variant={order === -1 ? 'secondary' : 'primary'} onPress={() => a.onPick(o.id)}>
      {label}
    </els.Button>
  )
}

const optionBody = (els: Els, size: Size, o: Option, badges: string, extra?: string) => (
  <els.Box flexDirection="column" flexShrink={1}>
    <els.Markdown key={`opt-${o.id}`} text={`${TITLE_H[size]}${md(o.title)}${badges ? `  ${badges}` : ''}`} />
    <els.Markdown
      dimColor
      text={`${o.borrowed ? `↪ borrowed from ${md(o.borrowed)} · ` : ''}${o.lanes.map(l => LANES[l].icon).join('')} ${md(o.detail)} · ${EFFORT[o.effort]} · ${o.needsYou ? '💬 your call' : '🤖 Claude can decide'}${extra ? ` · ${extra}` : ''}`}
    />
  </els.Box>
)

const bars = (els: Els, o: Option) => (
  <els.Box flexDirection="row">
    {o.lanes.map(l => <els.Text key={`${o.id}-${l}`} color={LANES[l].color}>▌</els.Text>)}
  </els.Box>
)

/**
 * One option: buttons, colour bars and words side by side; on a narrow pane
 * the words come first and the buttons sit under them, so neither is squeezed.
 */
const row = (els: Els, isNarrow: boolean, o: Option, buttons: unknown[], body: unknown) =>
  isNarrow
    ? (
      <els.Box key={`row-${o.id}`} flexDirection="column">
        <els.Box flexDirection="row" gap={1} alignItems="flex-start">{bars(els, o)}{body}</els.Box>
        <els.Box flexDirection="row" gap={1}>{buttons}</els.Box>
      </els.Box>
    )
    : (
      <els.Box key={`row-${o.id}`} flexDirection="row" gap={1} alignItems="flex-start">
        {buttons}{bars(els, o)}{body}
      </els.Box>
    )

export type BacklogProps = RowActions & {
  backlog: BacklogItem[]
  size: Size
  isNarrow: boolean
  onUnsave: (o: Option) => void
}

export const backlogView = (els: Els, p: BacklogProps) =>
  p.backlog.length === 0
    ? <els.Text dimColor>Nothing saved yet. Press ☆ Save on any option to keep it here for this project, across chats.</els.Text>
    : (
      <els.Box flexDirection="column" gap={1}>
        {p.backlog.map(o => row(els, p.isNarrow, o, [
          pickButton(els, o, p),
          <els.Button key={`unsave-${o.id}`} variant="secondary" onPress={() => p.onUnsave(o)}>✕</els.Button>,
        ], optionBody(els, p.size, o, '', `${o.pack ? `📦 ${md(plain(o.pack, 40))} · ` : ''}saved ${new Date(o.savedAt).toISOString().slice(0, 10)}`)))}
      </els.Box>
    )

export type OptionsProps = RowActions & {
  /** ranked, all of them */
  all: Option[]
  /** ranked, in the lane on view */
  shown: Option[]
  options: Option[]
  picks: Picks
  lanesPresent: Lane[]
  top: Set<string>
  best: Map<Lane, string>
  favourites: Lane[]
  hasLearned: boolean
  size: Size
  isNarrow: boolean
  isSaved: (o: Option) => boolean
  onSave: (o: Option) => void
  onLane: (lane: Lane | 'all') => void
  onResetLearning: () => void
}

export const optionsView = (els: Els, p: OptionsProps) => {
  const { Box, Text, Button, Markdown } = els
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        <Button key="lane-all" variant={p.picks.lane === 'all' ? 'primary' : 'secondary'} onPress={() => p.onLane('all')}>
          {`All ${p.all.length}`}
        </Button>
        {p.lanesPresent.map(l => (
          <Button key={`lane-${l}`} variant={p.picks.lane === l ? 'primary' : 'secondary'} onPress={() => p.onLane(p.picks.lane === l ? 'all' : l)}>
            {`${LANES[l].icon} ${LANES[l].name} ${p.all.filter(o => o.lanes.includes(l)).length}`}
          </Button>
        ))}
      </Box>
      {p.hasLearned
        ? (
          <Box flexDirection="row" flexWrap="wrap" gap={1} alignItems="center">
            <Box flexShrink={1} flexGrow={1}>
              <Text dimColor>
                {p.favourites.length > 0
                  ? `Learned from your picks: ${p.favourites.map(l => `${LANES[l].icon} ${LANES[l].name}`).join(', ')} rank a little higher`
                  : 'Learning which directions you pick…'}
              </Text>
            </Box>
            <Button key="reset-learning" variant="secondary" onPress={p.onResetLearning}>Reset learning</Button>
          </Box>
        )
        : null}
      {p.shown.map(o => {
        const badges = [
          p.top.has(o.id) ? '⭐ 80/20' : '',
          p.picks.lane !== 'all' && p.best.get(p.picks.lane as Lane) === o.id ? '★ best here' : '',
        ].filter(Boolean).join('  ')
        const isKept = p.isSaved(o)
        return row(els, p.isNarrow, o, [
          pickButton(els, o, p),
          <Button key={`save-${o.id}`} variant={isKept ? 'primary' : 'secondary'} onPress={() => p.onSave(o)}>
            {isKept ? '★ Saved' : '☆ Save'}
          </Button>,
        ], optionBody(els, p.size, o, badges))
      })}
    </Box>
  )
}
