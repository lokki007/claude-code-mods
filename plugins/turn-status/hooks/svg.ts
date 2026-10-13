import type { Snap } from '../types'
import { LINGER_MS, fmtClock, plainLine, words } from './model'

// Desktop band: one quiet row drawn as an SVG image whose motion is SMIL, so
// it runs at the browser's frame rate. Each animation's `begin` is offset by
// how long ago its moment was, so a redraw resumes motion instead of replaying it.

const H = 34
const MID = H / 2
const BASE = MID + 4.5
const ROLL_S = 0.28
const ORANGE = '#D97757'
const GREEN = '#3FB950'
const RED = '#F2777B'

const esc = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const n = (x: number) => Number(x.toFixed(2))
const ago = (now: number, at: number) => n(-(Math.max(0, now - at) / 1000))
const clip = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1)}…` : t)

/** Rough advance widths, enough to lay a row of system-ui text out. */
const textW = (t: string, px: number) => t.length * px * 0.5
const SANS = `system-ui,-apple-system,'Segoe UI',sans-serif`
const MONO = `ui-monospace,'SF Mono','Cascadia Mono',Consolas,monospace`

const STYLE = `
  svg{--fg:#ECEAE6;--dim:#8F8C86;--track:rgba(255,255,255,.1)}
  @media (prefers-color-scheme: light){svg{--fg:#1F1E1C;--dim:#6E6B65;--track:rgba(0,0,0,.1)}}
  .h{font:500 13px ${SANS};fill:var(--fg)}
  .d{font:400 12.5px ${SANS};fill:var(--dim)}
  .m{font:500 12px ${MONO};fill:var(--dim)}`

/** One odometer column: digits 0..count-1 then 0 again, rolling every `stepS` seconds. */
const odoColumn = (x: number, count: number, stepS: number, elapsedS: number, id: string) => {
  const lh = 14
  const r = Math.min(ROLL_S / stepS, 0.4)
  const times: number[] = [0]
  const values: number[] = [0]
  const splines: string[] = []
  for (let i = 0; i < count; i++) {
    times.push((i + 1 - r) / count, (i + 1) / count)
    values.push(-i * lh, -(i + 1) * lh)
    splines.push('0 0 1 1', '0.5 0 0.2 1')
  }
  const digits = Array.from({ length: count + 1 }, (_, i) =>
    `<text class="m" x="${x}" y="${BASE - 0.5 + i * lh}">${i % count}</text>`).join('')
  return `<clipPath id="${id}"><rect x="${x - 1}" y="${MID - 7}" width="9" height="14"/></clipPath>
    <g clip-path="url(#${id})"><g>
      <animateTransform attributeName="transform" type="translate" calcMode="spline"
        values="${values.map(v => `0 ${n(v)}`).join(';')}" keyTimes="${times.map(n).join(';')}"
        keySplines="${splines.join(';')}" dur="${count * stepS}s" begin="${n(-elapsedS)}s" repeatCount="indefinite"/>
      ${digits}</g></g>`
}

/** m:ss that rolls by itself; returns its width. */
const timer = (x: number, elapsedS: number) => {
  const cw = 7.3
  let svg = ''
  let cx = x
  if (elapsedS >= 600) {
    svg += odoColumn(cx, 6, 600, elapsedS, 'o0')
    cx += cw
  }
  svg += odoColumn(cx, 10, 60, elapsedS, 'o1')
  svg += `<text class="m" x="${n(cx + cw)}" y="${BASE - 0.5}">:</text>`
  svg += odoColumn(cx + cw * 2, 6, 10, elapsedS, 'o2') + odoColumn(cx + cw * 3, 10, 1, elapsedS, 'o3')
  return { svg, w: cx + cw * 4 - x }
}

const spinner = (x: number) => `
  <g transform="translate(${x} ${MID})">
    <circle r="2.6" fill="${ORANGE}">
      <animate attributeName="opacity" values="1;.45;1" dur="1.6s" repeatCount="indefinite"/>
    </circle>
    <circle r="6.5" fill="none" stroke="${ORANGE}" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="10 31" opacity=".9">
      <animateTransform attributeName="transform" type="rotate" values="0;360" dur="1s" repeatCount="indefinite"/>
    </circle>
  </g>`

const check = (x: number, s: Snap, now: number) => {
  if (s.aborted) return `<rect x="${x - 4.5}" y="${MID - 4.5}" width="9" height="9" rx="2" fill="#E5A84D"/>`
  const tick = `<path d="M-3.6 0.2 L-1.1 2.7 L3.8 -2.5" fill="none" stroke="#0D1117" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"`
  if (now - s.doneAt > 900) return `<g transform="translate(${x} ${MID})"><circle r="8" fill="${GREEN}"/>${tick}/></g>`
  const b = ago(now, s.doneAt)
  return `<g transform="translate(${x} ${MID})">
    <circle r="0" fill="${GREEN}">
      <animate attributeName="r" values="0;9.5;8" keyTimes="0;.6;1" dur=".42s" begin="${b}s" fill="freeze" calcMode="spline" keySplines="0.2 0.8 0.2 1;0.4 0 0.6 1"/>
    </circle>
    ${tick} stroke-dasharray="13" stroke-dashoffset="13">
      <animate attributeName="stroke-dashoffset" values="13;0" dur=".28s" begin="${n(b + 0.28)}s" fill="freeze" calcMode="spline" keySplines="0.4 0 0.2 1"/>
    </path>
  </g>`
}

/** A small segmented bar with the count after it; returns its width. */
const progress = (x: number, s: Snap, now: number) => {
  const { done, total } = words(s)
  const barW = Math.min(84, Math.max(36, total * 14))
  const gap = total > 12 ? 0 : 2.5
  const segW = (barW - (total - 1) * gap) / total
  let svg = ''
  if (gap === 0) {
    svg += `<rect x="${x}" y="${MID - 2}" width="${barW}" height="4" rx="2" style="fill:var(--track)"/>
      <rect x="${x}" y="${MID - 2}" width="${n((barW * done) / total)}" height="4" rx="2" fill="${GREEN}"/>`
  } else {
    s.tasks.forEach((t, i) => {
      const sx = n(x + i * (segW + gap))
      const w = n(segW)
      svg += `<rect x="${sx}" y="${MID - 2}" width="${w}" height="4" rx="2" style="fill:var(--track)"/>`
      if (t.status === 'completed') {
        const grow = t.id === s.taskDoneId && now - s.taskDoneAt < 700
          ? `<animate attributeName="width" values="0;${w}" dur=".45s" begin="${ago(now, s.taskDoneAt)}s" fill="freeze" calcMode="spline" keySplines="0.2 0.8 0.2 1"/>`
          : ''
        svg += `<rect x="${sx}" y="${MID - 2}" width="${w}" height="4" rx="2" fill="${GREEN}">${grow}</rect>`
      } else if (t.status === 'in_progress') {
        svg += `<rect x="${sx}" y="${MID - 2}" width="${w}" height="4" rx="2" fill="${ORANGE}">
          <animate attributeName="opacity" values=".35;1;.35" dur="1.6s" repeatCount="indefinite"/></rect>`
      }
    })
  }
  const count = `${done}/${total}`
  svg += `<text class="m" x="${n(x + barW + 7)}" y="${BASE - 0.5}">${count}</text>`
  return { svg, w: barW + 7 + count.length * 7.3 }
}

const failures = (x: number, s: Snap, now: number) => {
  const label = `${s.failed} failed`
  const fresh = now - s.lastFailAt < 1200
  const ring = fresh
    ? `<circle cx="${x + 3}" cy="${MID}" r="3" fill="none" stroke="${RED}" stroke-width="1.5">
        <animate attributeName="r" values="3;10" dur=".9s" begin="${ago(now, s.lastFailAt)}s" fill="freeze" calcMode="spline" keySplines="0.2 0.8 0.2 1"/>
        <animate attributeName="opacity" values="1;0" dur=".9s" begin="${ago(now, s.lastFailAt)}s" fill="freeze"/>
      </circle>`
    : ''
  return {
    svg: `${ring}<circle cx="${x + 3}" cy="${MID}" r="3" fill="${RED}"/>
      <text x="${x + 11}" y="${BASE}" style="font:500 12.5px ${SANS};fill:${RED}">${label}</text>`,
    w: 11 + textW(label, 12.5),
  }
}

const SEP = 16

const wrap = (w: number, body: string, alt: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(w)}" height="${H}" viewBox="0 0 ${Math.ceil(w)} ${H}" role="img" aria-label="${esc(alt)}"><style>${STYLE}</style>${body}</svg>`

export const bandSvg = (s: Snap, now: number): { source: string; alt: string; width: number; height: number } => {
  const alt = plainLine(s, now)
  const w = words(s)
  let x = 14
  let body = ''

  if (s.phase === 'working') {
    body += spinner(x)
    x += 16
    const headline = clip(w.headline, 56)
    const detail = w.detail ? clip(w.detail, 40) : ''
    // New words ease in, so a change of task or tool reads as motion, not a flicker.
    const enter = now - s.actionAt < 400
      ? `<animate attributeName="opacity" values="0;1" dur=".25s" begin="${ago(now, s.actionAt)}s" fill="freeze"/>`
      : ''
    body += `<text x="${x}" y="${BASE}" xml:space="preserve">${enter}<tspan class="h">${esc(headline)}</tspan>${detail ? `<tspan class="d">   ${esc(detail)}</tspan>` : ''}</text>`
    x += textW(headline, 13) + (detail ? textW(`   ${detail}`, 12.5) * 0.92 : 0) + SEP
    const t = timer(x, (now - s.startedAt) / 1000)
    body += t.svg
    x += t.w + SEP
  } else {
    body += check(x, s, now)
    x += 16
    const label = s.aborted ? 'Interrupted' : 'Done'
    const time = ` in ${fmtClock(s.durationMs)}`
    body += `<text x="${x}" y="${BASE}" xml:space="preserve"><tspan class="h">${label}</tspan><tspan class="d">${time}</tspan></text>`
    x += textW(label, 13) + textW(time, 12.5) + SEP
  }

  if (w.total > 0) {
    const p = progress(x, s, now)
    body += p.svg
    x += p.w + SEP
  }
  if (s.failed > 0) {
    const f = failures(x, s, now)
    body += f.svg
    x += f.w + SEP
  }

  if (s.phase === 'done') {
    // Fade out just before the band is taken down.
    const out = n(ago(now, s.doneAt) + LINGER_MS / 1000 - 0.6)
    body = `<g><animate attributeName="opacity" values="1;0" dur=".6s" begin="${out}s" fill="freeze"/>${body}</g>`
  }

  const width = Math.ceil(x - SEP + 14)
  return { source: wrap(width, body, alt), alt, width, height: H }
}
