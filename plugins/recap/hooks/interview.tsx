import type { Interview } from '../types'
import type { Els, Size } from './look'
import { strong } from './look'
import { md } from './recap'

// Claude's interview questions as buttons; the answers go back as the person's next message.

export type InterviewProps = {
  iv: Interview
  size: Size
  canType: boolean
  onAnswer: (question: number, option: number) => void
  onNote: (value: string) => void
  onSend: () => void
  onDismiss: () => void
}

export const interviewView = (els: Els, p: InterviewProps) => {
  const { Box, Text, Button, Markdown } = els
  const Input = p.canType ? els.Input : null
  const answered = p.iv.answers.filter(a => a.length > 0).length
  return (
    <Box flexDirection="column" gap={1}>
      {p.iv.questions.map((q, qi) => (
        <Box key={`q${qi}`} flexDirection="column">
          <Markdown text={strong(p.size, `${qi + 1}. ${md(q.question)}`)} />
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            {q.options.map((o, oi) => {
              const isChosen = (p.iv.answers[qi] ?? []).includes(oi)
              return (
                <Button key={`q${qi}-o${oi}`} variant={isChosen ? 'primary' : 'secondary'} onPress={() => p.onAnswer(qi, oi)}>
                  {`${isChosen ? (q.isMulti ? '☑' : '●') : (q.isMulti ? '☐' : '○')} ${o.label}${o.isRecommended ? ' ★' : ''}`}
                </Button>
              )
            })}
            <Button key={`q${qi}-x`} variant={(p.iv.answers[qi] ?? []).includes(-1) ? 'primary' : 'secondary'} onPress={() => p.onAnswer(qi, -1)}>
              You decide
            </Button>
          </Box>
          {q.options.some(o => o.hint)
            ? <Markdown dimColor text={q.options.filter(o => o.hint).map(o => `**${md(o.label)}**: ${md(o.hint)}`).join(' · ')} />
            : null}
        </Box>
      ))}
      {Input
        ? <Input key="iv-note" placeholder="Anything to add? (optional)" value={p.iv.note} onInput={p.onNote} onSubmit={p.onNote} />
        : null}
      <Box flexDirection="row" gap={1}>
        <Button key="iv-send" variant="primary" onPress={p.onSend}>{`Send answers ▶  (${answered}/${p.iv.questions.length})`}</Button>
        <Button key="iv-dismiss" variant="secondary" onPress={p.onDismiss}>Dismiss</Button>
      </Box>
      <Text dimColor>Unanswered questions are left to Claude.</Text>
    </Box>
  )
}
