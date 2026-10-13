import type { Autonomy, Deploy, Option, Prefs } from '../types'
import type { Els } from './look'
import { HEAD_H, ORDINAL } from './look'
import { AUTONOMY, DEPLOY } from './recap'

// The builder: the picks in order, where the work lands, whether to interview,
// the prompt as it will be sent, and the buttons that put it to use.

export type Send = 'replace' | 'append' | 'submit'

export type BuilderProps = {
  picked: Option[]
  prefs: Prefs
  composed: string
  willAsk: boolean
  onMakeMain: (id: string) => void
  onRemove: (id: string) => void
  onDeploy: (d: Deploy) => void
  onAutonomy: (a: Autonomy) => void
  onSend: (how: Send) => void
  onClear: () => void
}

export const builderView = (els: Els, p: BuilderProps) => {
  const { Box, Text, Button, Markdown } = els
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="#A487E0" borderDimColor paddingX={1}>
      <Markdown text={`${HEAD_H[p.prefs.size]}Your next prompt`} />
      {p.picked.length === 0
        ? <Text dimColor>Press + Pick on options or saved ones. The first one you pick is the main job; the rest ride along.</Text>
        : p.picked.map((o, i) => (
          <Box key={`pk-${o.id}`} flexDirection="row" flexWrap="wrap" gap={1}>
            <Text>{i === 0 ? '① main' : `${ORDINAL[i - 1] ?? '•'} also`}</Text>
            <Box flexShrink={1} flexGrow={1}><Text>{o.title}</Text></Box>
            {i > 0 ? <Button key={`up-${o.id}`} variant="secondary" onPress={() => p.onMakeMain(o.id)}>make main</Button> : null}
            <Button key={`rm-${o.id}`} variant="secondary" onPress={() => p.onRemove(o.id)}>✕</Button>
          </Box>
        ))}

      <Box marginTop={1}><Text bold>Where</Text></Box>
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        {(Object.keys(DEPLOY) as Deploy[]).map(d => (
          <Button key={`dep-${d}`} variant={p.prefs.deploy === d ? 'primary' : 'secondary'} onPress={() => p.onDeploy(d)}>
            {`${p.prefs.deploy === d ? '◉' : '○'} ${DEPLOY[d].label}`}
          </Button>
        ))}
      </Box>

      <Box marginTop={1}><Text bold>Questions</Text></Box>
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        {(Object.keys(AUTONOMY) as Autonomy[]).map(a => (
          <Button key={`aut-${a}`} variant={p.prefs.autonomy === a ? 'primary' : 'secondary'} onPress={() => p.onAutonomy(a)}>
            {`${p.prefs.autonomy === a ? '◉' : '○'} ${AUTONOMY[a].label}`}
          </Button>
        ))}
      </Box>
      <Text dimColor>
        {p.prefs.autonomy === 'auto'
          ? p.picked.length === 0 ? AUTONOMY.auto.hint : p.willAsk ? '→ will interview you: a pick needs your ideas' : '→ will just do it: nothing needs your ideas'
          : AUTONOMY[p.prefs.autonomy].hint}
      </Text>

      <Box borderStyle="single" borderDimColor paddingX={1} marginTop={1} flexDirection="column">
        {p.composed ? <Text>{p.composed}</Text> : <Text dimColor>Your prompt builds itself here.</Text>}
      </Box>
      <Box flexDirection="row" flexWrap="wrap" gap={1} marginTop={1}>
        <Button key="fill" variant="primary" onPress={() => p.onSend('replace')}>Put in prompt</Button>
        <Button key="append" variant="secondary" onPress={() => p.onSend('append')}>Add to my draft</Button>
        <Button key="send" variant="secondary" onPress={() => p.onSend('submit')}>Send now ▶</Button>
        {p.picked.length > 0 ? <Button key="clear" variant="secondary" onPress={p.onClear}>Clear</Button> : null}
      </Box>
    </Box>
  )
}
