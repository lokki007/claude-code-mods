// Shared bits of the pane's look. The view files draw with the elements the
// engine resolves for a surface; they never touch the engine themselves.

/** The drawing elements of a surface, as `$.ui.resolve(e)` hands them over. */
export type Els = { Box: any; Text: any; Button: any; Markdown: any; Input?: any; Svg?: any }

/** Text size, 1 to 3. */
export type Size = 1 | 2 | 3

export const VERDICT = { done: '💚', in_progress: '🟡', blocked: '🟥' } as const
export const EFFORT = { S: 'quick', M: 'medium', L: 'big' } as const
/** Heading level per text size: the only way to draw larger text in the pane. */
export const TITLE_H = { 1: '', 2: '#### ', 3: '### ' } as const
export const HEAD_H = { 1: '#### ', 2: '### ', 3: '## ' } as const
export const ORDINAL = '②③④⑤⑥⑦⑧⑨'

/** A bold line at the chosen size. */
export const strong = (size: Size, text: string) => `${TITLE_H[size] || '**'}${text}${TITLE_H[size] ? '' : '**'}`
