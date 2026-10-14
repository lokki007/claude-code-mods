// Running things from the Codex side: Codex itself (for the recap and the
// "even simpler" note), the companion page's server, and the browser.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PORT } from './core.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

/** The Codex program: RECAP_CODEX_BIN, else the npm install's own codex.exe, else `codex` on the PATH. */
export const findCodex = () => {
  if (process.env.RECAP_CODEX_BIN) return { cmd: process.env.RECAP_CODEX_BIN, shell: /\.(cmd|bat)$/i.test(process.env.RECAP_CODEX_BIN) }
  if (process.platform === 'win32') {
    const npm = join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@openai', 'codex', 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe')
    if (existsSync(npm)) return { cmd: npm, shell: false }
    try {
      const found = execFileSync('where', ['codex.exe'], { encoding: 'utf8' }).split(/\r?\n/).find(Boolean)
      if (found) return { cmd: found.trim(), shell: false }
    } catch { /* not on the PATH as an .exe */ }
  }
  return { cmd: 'codex', shell: process.platform === 'win32' }
}

/**
 * Asks Codex one question and returns its last message. It runs read-only, with
 * low effort, without saving a session, and with hooks off (so it cannot start
 * another recap). The prompt goes in on stdin.
 */
export const askCodex = async (prompt, cwd, { timeoutMs = 6 * 60_000 } = {}) => {
  const work = mkdtempSync(join(tmpdir(), 'recap-codex-'))
  const out = join(work, 'last.txt')
  try {
    const { cmd, shell } = findCodex()
    const args = [
      'exec', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only', '--color', 'never',
      '--disable', 'hooks', '-c', 'model_reasoning_effort="low"',
      ...(process.env.RECAP_CODEX_MODEL ? ['-m', process.env.RECAP_CODEX_MODEL] : []),
      '-C', cwd, '-o', out, '-',
    ]
    // Asynchronous, so the page's server keeps answering while Codex thinks.
    const run = await new Promise(resolve => {
      let stderr = ''
      const child = spawn(cmd, args, { shell, windowsHide: true, env: { ...process.env, RECAP_CODEX_INNER: '1' } })
      const timer = setTimeout(() => child.kill(), timeoutMs)
      child.stderr.on('data', d => { stderr = (stderr + d).slice(-4000) })
      child.stdout.resume()
      child.on('error', error => { clearTimeout(timer); resolve({ status: null, stderr, error }) })
      child.on('close', status => { clearTimeout(timer); resolve({ status, stderr, error: null }) })
      child.stdin.on('error', () => {})
      child.stdin.end(prompt)
    })
    const text = existsSync(out) ? readFileSync(out, 'utf8') : ''
    if (!text.trim()) {
      const why = run.error?.message || `${run.stderr ?? ''}`.trim().split('\n').slice(-2).join(' ') || `exit ${run.status}`
      return { isAnswered: false, text: '', why: why.slice(0, 300) }
    }
    return { isAnswered: true, text, why: '' }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/** Whether the companion page's server answers. */
export const isServing = (port = PORT) => new Promise(resolve => {
  const req = request({ host: '127.0.0.1', port, path: '/api/ping', timeout: 800 }, res => {
    res.resume()
    resolve(res.statusCode === 200)
  })
  req.on('error', () => resolve(false))
  req.on('timeout', () => { req.destroy(); resolve(false) })
  req.end()
})

/** Starts the server in the background if it is not running; true when it was just started. */
export const ensureServer = async (port = PORT) => {
  if (await isServing(port)) return false
  spawn(process.execPath, [join(HERE, 'server.mjs')], {
    detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, RECAP_PORT: String(port) },
  }).unref()
  for (let i = 0; i < 20; i++) {
    if (await isServing(port)) return true
    await new Promise(r => setTimeout(r, 150))
  }
  return true
}

/** Opens the companion page in the person's browser (not in tests or the nightly check). */
export const openPage = (port = PORT) => {
  if (process.env.RECAP_NO_OPEN === '1') return
  const url = `http://127.0.0.1:${port}/`
  if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
}

/** For tests: a fake Codex that answers with a fixed reply. */
export const writeFakeCodex = (dir, reply) => {
  const script = join(dir, 'fake-codex.mjs')
  writeFileSync(script, `import { writeFileSync, readFileSync } from 'node:fs'
const a = process.argv.slice(2)
const out = a[a.indexOf('-o') + 1]
const prompt = readFileSync(0, 'utf8')
writeFileSync(${JSON.stringify(join(dir, 'asked.txt'))}, prompt)
writeFileSync(out, ${JSON.stringify(reply)})
`)
  if (process.platform === 'win32') {
    const cmd = join(dir, 'fake-codex.cmd')
    writeFileSync(cmd, `@"${process.execPath}" "${script}" %*\r\n`)
    return cmd
  }
  const sh = join(dir, 'fake-codex')
  writeFileSync(sh, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 })
  return sh
}
