import type { ClientModule } from 'claude-code'

import type { Snap } from '../types'
import { fmtClock, words } from './model'

// Terminal band: the same one quiet row, drawn in cells. The frame clock runs
// only while a turn does (spinner and timer); a finished line is static.

const TICK_MS = 100
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export const clip = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1)}…` : t)

/** One block per task (at most 16), for the progress bar. */
export const blocks = (s: Snap, frame: number): ('done' | 'on' | 'off' | 'todo')[] =>
  s.tasks.slice(0, 16).map(t =>
    t.status === 'completed' ? 'done' : t.status === 'in_progress' ? (frame % 10 < 6 ? 'on' : 'off') : 'todo')

type Local = { frame: number; startedAt: number; turnId: string; stop?: () => void }

const TurnBand: ClientModule<Snap, Local> = (props, surface) => {
  const { Box, Text } = surface.elements
  let L = surface.state
  if (L === undefined) {
    L = { frame: 0, startedAt: Date.now(), turnId: props.turnId }
    surface.setState(L)
  }
  const s = L
  if (props.turnId !== s.turnId) {
    s.turnId = props.turnId
    s.startedAt = Date.now()
  }

  const isWorking = props.phase === 'working'
  if (isWorking && s.stop === undefined) {
    s.stop = surface.every(TICK_MS, () => {
      s.frame++
      surface.setState(s)
    })
  } else if (!isWorking && s.stop !== undefined) {
    s.stop()
    s.stop = undefined
  }

  const w = words(props)
  const cols = surface.columns || 100
  const bar = w.total > 0 ? (
    <>
      <Text>   </Text>
      {blocks(props, s.frame).map((b, i) => (
        <Text key={`b${i}`} color={b === 'done' ? 'success' : b === 'todo' ? 'subtle' : 'claude'} dimColor={b === 'off'}>
          {b === 'todo' ? '▱' : '▰'}
        </Text>
      ))}
      <Text dimColor> {w.progress}</Text>
    </>
  ) : null
  const fail = props.failed > 0 ? <Text color="error">   ● {props.failed} failed</Text> : null

  if (isWorking) {
    const room = Math.max(16, cols - 30)
    const headline = clip(w.headline, Math.min(56, room))
    const detail = w.detail && cols >= 90 ? clip(w.detail, 40) : null
    return (
      <Box>
        <Text color="claude">{SPIN[s.frame % SPIN.length]} </Text>
        <Text bold>{headline}</Text>
        {detail ? <Text dimColor>   {detail}</Text> : null}
        <Text dimColor>   {fmtClock(Date.now() - s.startedAt)}</Text>
        {bar}
        {fail}
      </Box>
    )
  }

  return (
    <Box>
      <Text color={props.aborted ? 'warning' : 'success'}>{props.aborted ? '■' : '✓'} </Text>
      <Text bold>{props.aborted ? 'Interrupted' : 'Done'}</Text>
      <Text dimColor> in {fmtClock(props.durationMs)}</Text>
      {bar}
      {fail}
    </Box>
  )
}

export default TurnBand
