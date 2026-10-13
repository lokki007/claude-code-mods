// The pane's mascot: a small owl in a wizard hat, drawn as an SVG image with
// SMIL motion. It blinks now and then, bobs and sparkles while a recap brews,
// and blushes when one is ready.

export type Mood = 'brewing' | 'happy' | 'oops'

const SPARKLE = 'M0 -5 L1.2 -1.2 L5 0 L1.2 1.2 L0 5 L-1.2 1.2 L-5 0 L-1.2 -1.2 Z'

const sparkle = (x: number, y: number, delay: number, color: string) => `
  <path d="${SPARKLE}" transform="translate(${x} ${y})" fill="${color}" opacity="0">
    <animate attributeName="opacity" values="0;1;0" dur="1.4s" begin="${delay}s" repeatCount="indefinite"/>
    <animateTransform attributeName="transform" type="scale" additive="sum" values=".4;1;.4" dur="1.4s" begin="${delay}s" repeatCount="indefinite"/>
  </path>`

export const owlSvg = (mood: Mood): { source: string; width: number; height: number; alt: string } => {
  const bob = mood === 'brewing'
    ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" dur="1.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1"/>`
    : mood === 'happy'
      ? `<animateTransform attributeName="transform" type="translate" values="0 6;0 -2;0 0" keyTimes="0;.55;1" dur=".6s" fill="freeze" calcMode="spline" keySplines="0.2 0.8 0.2 1;0.4 0 0.6 1"/>`
      : ''
  const blink = (cx: number) => `
    <ellipse cx="${cx}" cy="44" rx="9.5" ry="0" fill="#B98A63">
      <animate attributeName="ry" values="0;0;9.5;0" keyTimes="0;.9;.95;1" dur="4.2s" repeatCount="indefinite"/>
    </ellipse>`
  const eye = (cx: number) => mood === 'oops'
    ? `<circle cx="${cx}" cy="44" r="9" fill="#FFF8EE"/>
       <path d="M${cx - 3.5} 40.5 l7 7 M${cx + 3.5} 40.5 l-7 7" stroke="#2B2320" stroke-width="2.2" stroke-linecap="round"/>`
    : `<circle cx="${cx}" cy="44" r="9" fill="#FFF8EE"/>
       <circle cx="${cx + 1}" cy="45" r="4.6" fill="#2B2320"/>
       <circle cx="${cx + 2.6}" cy="43.2" r="1.5" fill="#fff"/>${blink(cx)}`
  const blush = mood === 'happy'
    ? `<ellipse cx="25" cy="54" rx="4" ry="2.4" fill="#F29BB5" opacity=".75"/><ellipse cx="55" cy="54" rx="4" ry="2.4" fill="#F29BB5" opacity=".75"/>`
    : ''
  const extras = mood === 'brewing'
    ? sparkle(10, 24, 0, '#F6C453') + sparkle(70, 30, .5, '#C9A7F5') + sparkle(66, 8, 1, '#F6C453')
    : mood === 'happy'
      ? sparkle(9, 20, 0, '#F6C453') + sparkle(71, 26, .7, '#F29BB5')
      : `<path d="M64 30 q3 5 0 7 q-3 -2 0 -7z" fill="#7DC4F0"/>`
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
  <ellipse cx="40" cy="77" rx="18" ry="2.5" fill="#000" opacity=".18"/>
  ${extras}
  <g>${bob}
    <ellipse cx="17" cy="56" rx="7" ry="13" fill="#A47552" transform="rotate(18 17 56)"/>
    <ellipse cx="63" cy="56" rx="7" ry="13" fill="#A47552" transform="rotate(-18 63 56)"/>
    <ellipse cx="40" cy="52" rx="24" ry="23" fill="#B98A63"/>
    <ellipse cx="40" cy="60" rx="15" ry="13" fill="#EBD3B5"/>
    <path d="M33 58 q2 2 4 0 M43 58 q2 2 4 0 M38 64 q2 2 4 0" stroke="#C9A27E" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    ${eye(30)}${eye(50)}
    <path d="M37.5 50 L42.5 50 L40 55 Z" fill="#F0A04B" stroke="#E08A33" stroke-width=".8" stroke-linejoin="round"/>
    ${blush}
    <path d="M34 75 l-2 3 M36 75 l0 3.5 M44 75 l0 3.5 M46 75 l2 3" stroke="#F0A04B" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M24 31 Q31 27 40 27 Q49 27 56 31 Q49 33 40 33 Q31 33 24 31 Z" fill="#5B3E9E"/>
    <path d="M29 30 Q36 4 50 3 Q45 10 51 30 Z" fill="#6E4FC4"/>
    <path d="M50 3 Q55 4 56 9" stroke="#6E4FC4" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="${SPARKLE}" transform="translate(40 19) scale(.8)" fill="#F6C453"/>
  </g>
</svg>`
  const alt = mood === 'brewing' ? 'An owl in a wizard hat, brewing' : mood === 'happy' ? 'A happy owl in a wizard hat' : 'A puzzled owl in a wizard hat'
  return { source, width: 80, height: 80, alt }
}
