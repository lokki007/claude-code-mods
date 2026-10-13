import type { ClientSettings, Tone, Verdict } from '../types'

// Everything a client reads: the cleaner that keeps code talk out, the
// "Explain to client" note in three tones, and the shareable diary web page.

/** Placeholders while cleaning: one file, several files, a piece of code. */
const F = '\u0001'
const FF = '\u0002'
const C = '\u0003'
const ANY = `[${F}${FF}${C}]`

const FILE_EXT = 'tsx?|jsx?|mjs|cjs|json|md|html?|css|scss|py|rb|go|rs|java|kt|swift|sh|ps1|ya?ml|toml|lock|sql|txt|env|xml|csv|ini|cfg|conf|log|php|vue|svelte'
/** Words that follow a subject rather than describe a noun: "the app.tsx now loads" keeps a noun ("the file"). */
const NOT_A_NOUN = new Set(['now', 'is', 'was', 'are', 'were', 'has', 'had', 'have', 'will', 'can', 'could', 'should', 'would', 'no', 'also', 'still', 'then', 'and', 'or', 'but', 'so', 'loads', 'works', 'runs', 'shows', 'opens', 'saves'])
const ARTICLE = '(the|a|an|this|that|your|our|its)'

const capitalise = (s: string) => s.replace(/(^|[.!?]\s+)([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())

/**
 * Text for a client: file paths, file names, code and version numbers taken
 * out, as a safety net under the model's own plain wording. What is left
 * still reads as a sentence: "the README.md wording" becomes "the wording",
 * "a bug in checkout.ts" becomes "a bug", never "the a file".
 */
export const forClient = (s: string): string => {
  let t = ` ${s} `
    .replace(/`[^`]*`/g, C)
    .replace(/\b[A-Za-z]:[\\/](?:[^\s,;)]*[^\s,;).!?:])?/g, F) // C:\path or C:/path, not the full stop after it
    .replace(new RegExp(`(^|\\s)(?:~|\\.{1,2})?\\/?(?:[\\w.-]+\\/)+[\\w-]+\\.(?:${FILE_EXT})\\b`, 'gi'), `$1${F}`) // some/dir/file.ts
    .replace(/(^|\s)(?:~|\.{1,2})?\/?(?:[\w.-]+\/){2,}[\w.-]*/g, `$1${F}`) // some/dir/ ("and/or" has one slash and stays)
    .replace(new RegExp(`\\b[\\w-]+\\.(?:${FILE_EXT})\\b`, 'gi'), F)
    .replace(/\b(the|a|an)\s+v?\d+\.\d+\.\d+\b/gi, 'the new version')
    .replace(/\bv?\d+\.\d+\.\d+\b/g, 'the new version')
  // A list of files reads as one: "index.html and styles.css".
  t = t.replace(new RegExp(`${ANY}(?:\\s*(?:,|and|or|&)\\s*${ANY})+`, 'g'), m => (m.includes(C) && !m.includes(F) && !m.includes(FF) ? C : FF))
  // "in checkout.ts", "to C:\notes.txt": the place is dropped with its preposition.
  t = t.replace(new RegExp(`\\s*\\b(?:in|inside|within|to|from|of|on|at|into|under|across|via)\\s+(?:the\\s+)?${ANY}`, 'gi'), '')
  // "the README.md wording": the file was only describing the noun.
  t = t.replace(new RegExp(`\\b${ARTICLE}\\s+${ANY}\\s+([a-z]+)`, 'gi'), (m, art: string, word: string) =>
    (NOT_A_NOUN.has(word.toLowerCase()) ? m : `${art} ${word}`))
  // "the app.tsx now loads": keep a plain noun.
  t = t.replace(new RegExp(`\\b${ARTICLE}\\s+(${ANY})`, 'gi'), (_, art: string, tok: string) =>
    `${art} ${tok === FF ? 'files' : tok === C ? 'code' : 'file'}`)
  t = t
    .replace(new RegExp(F, 'g'), 'a file')
    .replace(new RegExp(FF, 'g'), 'a few files')
    .replace(new RegExp(C, 'g'), 'the code')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,;:])(?=[.!?])/g, '')
    .replace(/^[\s,;:]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
  return capitalise(t)
}

const STATUS = { done: 'Done', in_progress: 'In progress', blocked: 'Waiting on a decision' } as const

export const TONES: Record<Tone, { label: string }> = {
  friendly: { label: 'Friendly' },
  formal: { label: 'Formal' },
  short: { label: 'Very short' },
}

export const DEFAULT_CLIENT: ClientSettings = { name: '', signoff: '', tone: 'friendly' }

const firstSentence = (s: string) => (s.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? s).trim()

/**
 * The note behind "Explain to client": ready to paste into an email or chat,
 * greeted and signed the way the person set for this project, in their tone.
 * `body` replaces the recap's own note (the "even simpler" rewrite).
 */
export const clientNote = (
  r: { tldr: string; verdict: Verdict; client?: string },
  next?: string,
  settings: ClientSettings = DEFAULT_CLIENT,
  body?: string,
): string => {
  const text = (body && body.trim()) || (r.client && r.client.trim()) || forClient(r.tldr)
  const name = settings.name.trim()
  const signoff = settings.signoff.trim()
  const step = next ? forClient(next) : ''
  if (settings.tone === 'short') {
    return [
      `${name ? `${name}: ` : ''}${firstSentence(text)} (${STATUS[r.verdict].toLowerCase()})`,
      ...(step ? [`Next: ${step}`] : []),
      ...(signoff ? [`– ${signoff}`] : []),
    ].join('\n')
  }
  if (settings.tone === 'formal') {
    return [
      name ? `Dear ${name},` : 'Hello,',
      '',
      text,
      '',
      `Current status: ${STATUS[r.verdict]}.`,
      ...(step ? [`Next step: ${step}.`.replace(/\.\.$/, '.')] : []),
      ...(signoff ? ['', 'Kind regards,', signoff] : []),
    ].join('\n')
  }
  return [
    `Hi ${name || 'there'},`,
    '',
    text,
    '',
    `Status: ${STATUS[r.verdict]}`,
    ...(step ? [`Next up: ${step}`] : []),
    ...(signoff ? ['', 'Thanks,', signoff] : []),
  ].join('\n')
}

/** The rewrite request behind "🧸 Even simpler". */
export const simplerPrompt = (note: string) =>
  `Rewrite this progress note so anyone could follow it, even a ten-year-old: very short sentences, everyday words, one friendly comparison if it helps, no technical words, no file names, at most 4 sentences. Reply with the rewritten note only.\n\n"""\n${note.slice(0, 1500)}\n"""`

// ---- the shareable diary web page ------------------------------------------------------------

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
/** The diary's light Markdown (bold only) as HTML, escaped first. */
const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

type Entry = { date: string; status: string; body: string; next: string }

/** Reads the diary's entries back: one per "## date" heading. */
export const diaryEntries = (markdown: string): Entry[] =>
  markdown.split(/\n## /).slice(1).map(chunk => {
    const [date = '', ...rest] = chunk.split('\n')
    const text = rest.join('\n').trim()
    const head = text.match(/^\*\*(.+?)\.\*\*\s*/)
    const status = head?.[1] ?? ''
    const afterHead = head ? text.slice(head[0].length) : text
    const [body = '', next = ''] = afterHead.split(/\n\n\*\*Coming up next:\*\*\s*/)
    return { date: date.trim(), status, body: body.trim(), next: next.trim() }
  })

/**
 * A clean, self-contained page of a project's progress updates, newest first,
 * to send to that client as a file. No scripts, no outside links, no tracking.
 */
export const diaryPage = (markdown: string, project: string, client: string, updated: string): string => {
  const entries = diaryEntries(markdown).reverse()
  const pill = (status: string) => {
    const kind = /done/i.test(status) ? 'done' : /waiting/i.test(status) ? 'wait' : 'going'
    return `<span class="pill ${kind}">${esc(status.replace(/^[^\p{L}]+/u, '')) || 'Update'}</span>`
  }
  const items = entries.length === 0
    ? '<p class="empty">No updates yet.</p>'
    : entries.map(e => `
    <article>
      <header><time>${esc(e.date)}</time>${pill(e.status)}</header>
      <p>${inline(e.body)}</p>
      ${e.next ? `<p class="next"><span>Coming up next</span>${inline(e.next)}</p>` : ''}
    </article>`).join('\n')
  const title = `${project}: progress updates${client ? ` for ${client}` : ''}`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<style>
  :root { --bg: #faf8f5; --card: #ffffff; --ink: #24201c; --dim: #6f675f; --line: #e8e2da; --done: #2f7d4f; --going: #a86b00; --wait: #8a5cc4; }
  @media (prefers-color-scheme: dark) { :root { --bg: #1b1916; --card: #24211d; --ink: #f1ece6; --dim: #a59c92; --line: #38332d; --done: #6fcf97; --going: #f2b94b; --wait: #c3a2f2; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 17px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 680px; margin: 0 auto; padding: 48px 16px 64px; }
  h1 { font-size: 1.7rem; line-height: 1.25; margin: 0 0 4px; }
  .sub { color: var(--dim); margin: 0 0 32px; }
  article { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 18px 20px; margin: 0 0 14px; }
  article header { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 6px; }
  time { font-weight: 600; }
  .pill { font-size: .8rem; font-weight: 600; padding: 2px 10px; border-radius: 99px; border: 1px solid currentColor; }
  .pill.done { color: var(--done); } .pill.going { color: var(--going); } .pill.wait { color: var(--wait); }
  article p { margin: 6px 0 0; }
  .next { color: var(--dim); }
  .next span { display: block; font-size: .8rem; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
  .empty { color: var(--dim); }
  footer { color: var(--dim); font-size: .85rem; margin-top: 28px; }
</style>
</head>
<body>
<main>
  <h1>${esc(project)}: progress updates</h1>
  <p class="sub">${client ? `For ${esc(client)} · ` : ''}${entries.length} update${entries.length === 1 ? '' : 's'}, newest first</p>
  ${items}
  <footer>Last updated ${esc(updated)}.</footer>
</main>
</body>
</html>
`
}
