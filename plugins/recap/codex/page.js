// The companion page for Codex: draws the recap from the local server and builds the next prompt.
import {
  AUTONOMY, DEPLOY, INTERVIEW_PLAIN, LANES, LANE_KEYS, TONES, DEFAULT_CLIENT, bestInLane, clientNote, composePrompt, favourites,
  isSaved, ranked, toggleSaved, topPicks, willInterview,
} from '/logic.mjs'

// ---- small helpers ------------------------------------------------------------------------
/** Builds an element; text always goes in as text, never as markup. */
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v)
    else if (k === 'class') n.className = v
    else if (k === 'style') n.style.cssText = v
    else n.setAttribute(k, v === true ? '' : v)
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) n.append(kid instanceof Node ? kid : String(kid))
  return n
}
const toast = text => {
  const t = document.getElementById('toast')
  t.textContent = text
  t.classList.add('show')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600)
}
const post = (path, body) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const remember = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }
const recall = (k, fallback) => { try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v) } catch { return fallback } }

const VERDICT = { done: '💚', in_progress: '🟡', blocked: '🟥' }
const EFFORT = { S: 'quick', M: 'medium', L: 'big' }
const SIZES = { 1: '14px', 2: '16px', 3: '19px' }

// ---- state --------------------------------------------------------------------------------
let store = { projects: {}, wins: [], learned: {} }
let rev = -1
const ui = {
  key: recall('recap.project', ''),
  view: 'options',
  lane: 'all',
  picks: { turnId: '', chosen: [] },
  isClientOpen: false,
  simpler: null,
  prefs: { size: 2, deploy: 'local', autonomy: 'auto', ...recall('recap.prefs', {}) },
}
const setPrefs = patch => { ui.prefs = { ...ui.prefs, ...patch }; remember('recap.prefs', ui.prefs); render() }

const projectsByTime = () => Object.entries(store.projects).sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0))

// ---- the page -----------------------------------------------------------------------------
const render = () => {
  document.documentElement.style.setProperty('--size', SIZES[ui.prefs.size] ?? '16px')
  const app = document.getElementById('app')
  const list = projectsByTime()
  if (!ui.key || !store.projects[ui.key]) ui.key = list[0]?.[0] ?? ''
  const p = store.projects[ui.key]
  if (!p) {
    app.replaceChildren(el('div', { class: 'empty' },
      el('div', { style: 'font-size:2.4em' }, '🦉'),
      el('h1', {}, 'Waiting for Codex'),
      el('p', { class: 'dim' }, 'When Codex finishes a piece of work (it changed files or dug through things), its next-step options show up here.')))
    return
  }
  const r = p.recap && p.status !== 'brewing' && p.status !== 'error' ? p.recap : null
  if (r && ui.picks.turnId !== r.turnId) ui.picks = { turnId: r.turnId, chosen: [] }

  const headline = p.status === 'brewing'
    ? 'Brewing options…'
    : p.status === 'error' ? `Couldn't plan: ${p.error ?? 'something went wrong'}`
      : r ? `${VERDICT[r.verdict] ?? ''} ${r.tldr}` : 'Nothing to plan yet'
  const owl = p.status === 'brewing' ? '🦉✨' : p.status === 'error' ? '🦉❔' : (p.streak ?? 0) >= 4 ? '🦉🌟' : (p.streak ?? 0) >= 2 ? '🦉🏅' : '🦉'

  const header = el('header', { class: 'top' },
    el('div', { class: 'owl', title: (p.streak ?? 0) >= 2 ? `${p.streak} pieces of work finished in a row` : '' }, owl),
    el('div', { class: 'grow' },
      el('h1', {}, headline),
      el('div', { class: 'dim small' }, `${p.name}${p.skipped && (p.skipped.at ?? 0) > (p.at ?? 0) ? ` · last turn got no recap: ${p.skipped.why}` : ''}${(p.streak ?? 0) >= 2 ? ` · ${p.streak} finished in a row` : ''}`)),
    list.length > 1
      ? el('select', { 'aria-label': 'Project', onchange: e => { ui.key = e.target.value; remember('recap.project', ui.key); ui.isClientOpen = false; render() } },
        ...list.map(([k, v]) => { const o = el('option', { value: k }, v.name); o.selected = k === ui.key; return o }))
      : null,
    r ? el('button', { class: ui.isClientOpen ? 'on' : '', onclick: () => { ui.isClientOpen = !ui.isClientOpen; render() } }, '✉ Explain to client') : null,
    el('button', { onclick: () => setPrefs({ size: Math.max(1, ui.prefs.size - 1) }), 'aria-label': 'Smaller text' }, 'A−'),
    el('button', { onclick: () => setPrefs({ size: Math.min(3, ui.prefs.size + 1) }), 'aria-label': 'Bigger text' }, 'A+'))

  const parts = [header]
  if (r && ui.isClientOpen) parts.push(clientBox(p, r))
  const backlog = p.backlog ?? []
  if (!r && backlog.length === 0) {
    app.replaceChildren(...parts)
    return
  }
  if (!r) ui.view = 'backlog'
  parts.push(el('div', { class: 'row' },
    r ? el('button', { class: ui.view === 'options' ? 'on' : '', onclick: () => { ui.view = 'options'; render() } }, `Options ${r.options.length}`) : null,
    el('button', { class: ui.view === 'backlog' ? 'on' : '', onclick: () => { ui.view = 'backlog'; render() } }, `☆ Saved ${backlog.length}`)))

  const options = r ? r.options : []
  const pool = [...options, ...backlog]
  const picked = ui.picks.chosen.map(id => pool.find(o => o.id === id)).filter(Boolean)
  parts.push(el('div', { class: 'layout' }, el('div', { class: 'box' }, ui.view === 'backlog' ? backlogList(p, backlog) : optionList(p, options, backlog)), builder(p, pool, picked)))
  app.replaceChildren(...parts)
}

const saveBacklog = async (p, next) => {
  p.backlog = next
  await post('/api/backlog', { key: ui.key, backlog: next })
  render()
}

const pickButton = o => {
  const order = ui.picks.chosen.indexOf(o.id)
  return el('button', { class: order === -1 ? '' : 'on', onclick: () => {
    ui.picks.chosen = order === -1 ? [...ui.picks.chosen, o.id] : ui.picks.chosen.filter(x => x !== o.id)
    render()
  } }, order === -1 ? '+ Pick' : order === 0 ? '✓ 1 main' : `✓ ${order + 1}`)
}

const optionRow = (o, badges, buttons, extra) => el('div', { class: 'opt' },
  el('div', { class: 'bars' }, ...o.lanes.map(l => el('i', { style: `background:${LANES[l]?.color ?? '#999'}`, title: LANES[l]?.name ?? l }))),
  el('div', { class: 'grow' },
    el('div', {}, el('span', { class: 'title' }, o.title), ...badges.map(b => el('span', { class: 'badge' }, b))),
    el('div', { class: 'dim small' }, [
      o.borrowed ? `↪ borrowed from ${o.borrowed}` : '',
      `${o.lanes.map(l => LANES[l]?.icon ?? '').join('')} ${o.detail}`,
      EFFORT[o.effort] ?? '',
      o.needsYou ? '💬 your call' : '🤖 Codex can decide',
      extra ?? '',
    ].filter(Boolean).join(' · ')),
    el('div', { class: 'acts' }, ...buttons)))

const optionList = (p, options, backlog) => {
  const learned = store.learned ?? {}
  const all = ranked(options, learned)
  const top = topPicks(options, learned)
  const best = bestInLane(options, learned)
  const lanes = LANE_KEYS.filter(l => all.some(o => o.lanes.includes(l)))
  const shown = ui.lane === 'all' ? all : all.filter(o => o.lanes.includes(ui.lane))
  const fav = favourites(learned)
  const hasLearned = Object.values(learned).some(n => (n ?? 0) > 0)
  return el('div', {},
    el('div', { class: 'row' },
      el('button', { class: ui.lane === 'all' ? 'on' : '', onclick: () => { ui.lane = 'all'; render() } }, `All ${all.length}`),
      ...lanes.map(l => el('button', { class: ui.lane === l ? 'on' : '', onclick: () => { ui.lane = ui.lane === l ? 'all' : l; render() } },
        `${LANES[l].icon} ${LANES[l].name} ${all.filter(o => o.lanes.includes(l)).length}`))),
    hasLearned
      ? el('div', { class: 'row dim small', style: 'margin-top:8px' },
        el('span', { class: 'grow' }, fav.length > 0 ? `Learned from your picks: ${fav.map(l => `${LANES[l].icon} ${LANES[l].name}`).join(', ')} rank a little higher` : 'Learning which directions you pick…'),
        el('button', { onclick: async () => { store.learned = {}; await post('/api/learned/reset', {}); toast('Ranking reset'); render() } }, 'Reset learning'))
      : null,
    el('div', { style: 'margin-top:6px' }, ...shown.map(o => {
      const kept = isSaved(backlog, o)
      const badges = [top.has(o.id) ? '⭐ 80/20' : '', ui.lane !== 'all' && best.get(ui.lane) === o.id ? '★ best here' : ''].filter(Boolean)
      return optionRow(o, badges, [
        pickButton(o),
        el('button', { class: kept ? 'on' : '', onclick: () => saveBacklog(p, toggleSaved(backlog, o, Date.now())) }, kept ? '★ Saved' : '☆ Save'),
      ])
    })))
}

const backlogList = (p, backlog) => backlog.length === 0
  ? el('p', { class: 'dim' }, 'Nothing saved yet. Press ☆ Save on any option to keep it here for this project.')
  : el('div', {}, ...backlog.map(o => optionRow(o, [], [
    pickButton(o),
    el('button', { onclick: () => saveBacklog(p, backlog.filter(b => b.id !== o.id)) }, '✕ Remove'),
  ], `${o.pack ? `📦 ${o.pack} · ` : ''}saved ${new Date(o.savedAt ?? Date.now()).toISOString().slice(0, 10)}`)))

const builder = (p, pool, picked) => {
  const composed = composePrompt(pool, ui.picks.chosen, ui.prefs.deploy, ui.prefs.autonomy, INTERVIEW_PLAIN)
  const willAsk = willInterview(picked, ui.prefs.autonomy)
  return el('div', { class: 'box builder' },
    el('h2', {}, 'Your next prompt'),
    picked.length === 0
      ? el('p', { class: 'dim small' }, 'Press + Pick on options or saved ones. The first one you pick is the main job; the rest ride along.')
      : el('div', {}, ...picked.map((o, i) => el('div', { class: 'row', style: 'margin:4px 0' },
        el('span', {}, i === 0 ? '① main' : `${'②③④⑤⑥⑦⑧⑨'[i - 1] ?? '•'} also`),
        el('span', { class: 'grow' }, o.title),
        i > 0 ? el('button', { onclick: () => { ui.picks.chosen = [o.id, ...ui.picks.chosen.filter(x => x !== o.id)]; render() } }, 'make main') : null,
        el('button', { 'aria-label': 'Remove', onclick: () => { ui.picks.chosen = ui.picks.chosen.filter(x => x !== o.id); render() } }, '✕')))),
    el('h3', {}, 'Where'),
    el('div', { class: 'row' }, ...Object.keys(DEPLOY).map(d => el('button', { class: ui.prefs.deploy === d ? 'on' : '', onclick: () => setPrefs({ deploy: d }) }, DEPLOY[d].label))),
    el('h3', {}, 'Questions'),
    el('div', { class: 'row' }, ...Object.keys(AUTONOMY).map(a => el('button', { class: ui.prefs.autonomy === a ? 'on' : '', onclick: () => setPrefs({ autonomy: a }) }, AUTONOMY[a].label))),
    el('div', { class: 'dim small', style: 'margin-top:6px' },
      ui.prefs.autonomy === 'auto'
        ? picked.length === 0 ? AUTONOMY.auto.hint : willAsk ? '→ will ask you a few questions first: a pick needs your ideas' : '→ will just do it: nothing needs your ideas'
        : AUTONOMY[ui.prefs.autonomy].hint),
    el('div', { class: 'preview' + (composed ? '' : ' dim') }, composed || 'Your prompt builds itself here.'),
    el('div', { class: 'row', style: 'margin-top:10px' },
      el('button', { class: 'primary', onclick: async () => {
        if (!composed) return toast('Pick at least one option first')
        try { await navigator.clipboard.writeText(composed) } catch { return toast("Couldn't copy here: select the text instead") }
        await post('/api/sent', { key: ui.key, picked })
        toast('Copied: paste it into Codex')
      } }, 'Copy prompt'),
      picked.length > 0 ? el('button', { onclick: () => { ui.picks.chosen = []; render() } }, 'Clear') : null))
}

const clientBox = (p, r) => {
  const settings = { ...DEFAULT_CLIENT, ...(p.client ?? {}) }
  const simpler = ui.simpler && ui.simpler.turnId === r.turnId ? ui.simpler : null
  const body = simpler?.isOn && simpler.text ? simpler.text : undefined
  const best = ranked(r.options, store.learned ?? {})[0]
  const note = clientNote(r, best?.title, settings, body)
  const saveClient = async patch => {
    p.client = { ...settings, ...patch }
    await post('/api/client', { key: ui.key, ...patch })
  }
  const label = !simpler ? '🧸 Even simpler' : simpler.status === 'writing' ? '🧸 Simplifying…' : simpler.status === 'error' ? '🧸 Try simpler again' : simpler.isOn ? '🧸 Back to normal' : '🧸 Even simpler'
  return el('div', { class: 'box client' },
    el('strong', {}, settings.name ? `For ${settings.name}` : 'For your client'),
    el('pre', {}, note),
    el('div', { class: 'row' },
      el('button', { class: 'primary', onclick: async () => {
        try { await navigator.clipboard.writeText(note); toast('Copied: paste it into your email or chat') } catch { toast("Couldn't copy here: select the text instead") }
      } }, 'Copy'),
      el('button', { class: simpler?.isOn ? 'on' : '', onclick: async () => {
        if (simpler?.status === 'writing') return
        if (simpler?.status === 'ready') { simpler.isOn = !simpler.isOn; return render() }
        ui.simpler = { turnId: r.turnId, status: 'writing', text: '', isOn: true }
        render()
        const res = await post('/api/simpler', { key: ui.key })
        const data = await res.json().catch(() => ({}))
        ui.simpler = res.ok && data.text ? { turnId: r.turnId, status: 'ready', text: data.text, isOn: true } : { turnId: r.turnId, status: 'error', text: '', isOn: false }
        if (!res.ok) toast(data.error ?? 'Could not simplify it this time')
        render()
      } }, label),
      el('a', { href: `/api/page?key=${encodeURIComponent(ui.key)}`, target: '_blank', rel: 'noopener', class: 'small' }, 'Open the progress page'),
      el('button', { onclick: () => { ui.isClientOpen = false; render() } }, 'Close')),
    el('div', { class: 'row', style: 'margin-top:10px' },
      ...Object.keys(TONES).map(t => el('button', { class: settings.tone === t ? 'on' : '', onclick: async () => { await saveClient({ tone: t }); render() } }, TONES[t].label))),
    el('div', { class: 'row', style: 'margin-top:10px' },
      el('input', { placeholder: "Client's name (optional)", value: settings.name, 'aria-label': "Client's name", onchange: async e => { await saveClient({ name: e.target.value }); render() } }),
      el('input', { placeholder: 'Your sign-off, like your name (optional)', value: settings.signoff, 'aria-label': 'Your sign-off', onchange: async e => { await saveClient({ signoff: e.target.value }); render() } })))
}

// ---- staying current ----------------------------------------------------------------------
const refresh = async () => {
  try {
    const res = await fetch('/api/state', { cache: 'no-store' })
    const data = await res.json()
    if (data.rev === rev) return
    // Don't redraw under the person's typing.
    if (document.activeElement?.tagName === 'INPUT') return
    rev = data.rev
    store = data.store
    render()
  } catch { /* the server may be restarting */ }
}
await refresh()
render()
setInterval(refresh, 2500)
