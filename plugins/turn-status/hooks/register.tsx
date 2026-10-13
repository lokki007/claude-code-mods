import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Snap } from '../types'
import { IDLE, LINGER_MS, applyTaskCall, describeTool, plainLine, taskCallOf } from './model'
import { bandSvg } from './svg'
import type { Instance } from './copies'
import { duplicateWarning, otherCopies, registryPath, withInstance } from './copies'

export const snap = atom({ plugin: 'turn-status', key: 'snap' } as const, IDLE)

export const register: Register = on => {
  // A second copy of this mod in the same chat: each copy announces itself, then looks for the other.
  on('session.start', async ($, e, next) => {
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
    if (home) {
      const me: Instance = { session: await $.session.id(), token: crypto.randomUUID(), root: $.plugin.root, at: await $.clock.now() }
      const registry = registryPath(home)
      const announce = async () => {
        const raw = (await $.fs.exists(registry)) ? String(await $.fs.read(registry)) : '[]'
        await $.fs.write(registry, JSON.stringify(withInstance(raw, me)))
      }
      await announce()
      // Two copies writing at the same instant can drop each other: write again twice, a little apart.
      $.clock.after(300 + Math.floor(Math.random() * 300), () => void announce())
      $.clock.after(900 + Math.floor(Math.random() * 400), () => void announce())
      $.clock.after(2000, async () => {
        const raw = (await $.fs.exists(registry)) ? String(await $.fs.read(registry)) : '[]'
        const others = otherCopies(withInstance(raw, me), me)
        // Every copy sees the others; the one that started last says so (its check runs last), so the warning shows once.
        if (others.length > 0 && [me, ...others].sort((a, b) => b.at - a.at || a.token.localeCompare(b.token))[0]!.token === me.token) {
          $.ui.toast(duplicateWarning(me, others), { timeoutMs: 12000 })
        }
      })
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, snap, s => ({
      ...IDLE,
      tasks: s.tasks ?? [],
      phase: 'working' as const,
      turnId: e.turnId,
      startedAt: now,
      actionAt: now,
    }))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // A subagent's tools are its own business; the line follows the main loop.
    const isMain = e.agentId === undefined
    if (isMain) {
      const now = await $.clock.now()
      await update($, snap, s => ({ ...s, action: describeTool(e as any), actionAt: now }))
    }
    const ran = await next(e)
    const now = await $.clock.now()
    const failed = ran.deny === undefined && ran.isError === true
    const call = ran.deny === undefined && !failed ? taskCallOf(e as any, ran.result) : null
    await update($, snap, s => {
      let out: Snap = { ...IDLE, ...s }
      if (isMain) out = { ...out, action: null, actionAt: now }
      if (failed) out = { ...out, failed: out.failed + 1, lastFailAt: now }
      if (call) out = applyTaskCall(out, call, now)
      return out
    })
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      await update($, snap, s => ({
        ...IDLE,
        ...s,
        phase: 'done' as const,
        action: null,
        durationMs: e.durationMs,
        aborted: e.isAborted,
        doneAt: now,
      }))
      // Then get out of the way, unless another turn has started meanwhile.
      $.clock.after(LINGER_MS, () => {
        void update($, snap, s => (s.phase === 'done' && s.turnId === e.turnId ? { ...s, phase: 'idle' as const } : s))
      })
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s: Snap = { ...IDLE, ...(await read($, snap)) } // older saved state may lack newer fields
    if (e.props.hasSurvey || s.phase === 'idle') return next(e)
    const now = await $.clock.now()

    if (e.surface === 'desktop') {
      const { Svg } = $.ui.resolve({ ...e, surface: e.surface })
      const band = bandSvg(s, now)
      return <Svg source={band.source} alt={band.alt} width={band.width} height={band.height} />
    }

    if (e.surface === 'terminal') {
      const { Box, Client } = $.ui.resolve({ ...e, surface: e.surface })
      return (
        <Box>
          <Client key="band" module="./motion.tsx" props={s} flexGrow={1} />
        </Box>
      )
    }

    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{plainLine(s, now)}</Text>
  })
}
