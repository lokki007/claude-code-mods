// Running things from the Codex side: Codex itself (for the recap and the
// "even simpler" note), the companion page's server, and the browser.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { port as defaultPort } from './core.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

/** The Codex program: RECAP_CODEX_BIN, else the npm install's own codex.exe, else `codex` on the PATH. */
export const findCodex = () => {
  if (process.env.RECAP_CODEX_BIN) return { cmd: process.env.RECAP_CODEX_BIN, shell: /\.(cmd|bat)$/i.test(process.env.RECAP_CODEX_BIN) }
  if (process.platform === 'win32') {
    // The Codex app keeps its own, newest Codex here (one folder per version): the npm one can lag
    // behind and refuse the newest models.
    const appBins = join(process.env.LOCALAPPDATA ?? '', 'OpenAI', 'Codex', 'bin')
    if (existsSync(appBins)) {
      const newest = readdirSync(appBins)
        .map(d => join(appBins, d, 'codex.exe'))
        .filter(p => existsSync(p))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
      if (newest) return { cmd: newest, shell: false }
    }
    const npm =join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@openai', 'codex', 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe')
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

/**
 * Starts a node script that outlives its caller. Codex waits for everything a
 * hook starts, so on Windows it is started by the system's process service
 * instead, outside Codex's process group (its settings travel as arguments or
 * in a file, since it does not inherit this environment).
 */
export const launch = (script, args = []) => {
  if (process.platform === 'win32' && process.env.RECAP_PLAIN_SPAWN !== '1') {
    const line = [process.execPath, script, ...args].map(a => `"${a}"`).join(' ').replace(/'/g, "''")
    const ps = "$s = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }; "
      + `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${line}'; CurrentDirectory = '${HERE.replace(/'/g, "''")}'; ProcessStartupInformation = $s }; `
      + 'exit [int]$r.ReturnValue'
    const run = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 10_000 })
    if (run.status === 0) return
  }
  spawn(process.execPath, [script, ...args], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
}

/** The folder the running page server was started from, or null when none answers. */
export const servingFrom = (port = defaultPort()) => new Promise(resolve => {
  const req = request({ host: '127.0.0.1', port, path: '/api/ping', timeout: 800 }, res => {
    let body = ''
    res.on('data', d => { body += d })
    res.on('end', () => {
      try { resolve(res.statusCode === 200 ? String(JSON.parse(body).root ?? '?') : null) } catch { resolve(null) }
    })
  })
  req.on('error', () => resolve(null))
  req.on('timeout', () => { req.destroy(); resolve(null) })
  req.end()
})

/** Whether the companion page's server answers. */
export const isServing = async (port = defaultPort()) => (await servingFrom(port)) !== null

/** Asks an older server to step aside. */
const quit = port => new Promise(resolve => {
  const req = request({ host: '127.0.0.1', port, path: '/api/quit', method: 'POST', headers: { 'content-type': 'application/json' }, timeout: 800 }, res => { res.resume(); resolve(true) })
  req.on('error', () => resolve(false))
  req.on('timeout', () => { req.destroy(); resolve(false) })
  req.end('{}')
})

/** Starts the server in the background if it is not running; true when it was just started. */
export const ensureServer = async (port = defaultPort()) => {
  const root = await servingFrom(port)
  if (root === HERE) return false
  // A server from an older copy of the mod (before an update): replace it, quietly.
  const wasRunning = root !== null
  if (wasRunning) {
    await quit(port)
    for (let i = 0; i < 20 && (await isServing(port)); i++) await new Promise(r => setTimeout(r, 100))
  }
  launch(join(HERE, 'server.mjs'), ['--port', String(port)])
  for (let i = 0; i < 20; i++) {
    if (await isServing(port)) break
    await new Promise(r => setTimeout(r, 150))
  }
  return !wasRunning
}

/** Opens the companion page in the person's browser (not in tests or the nightly check). */
export const openPage = (port = defaultPort()) => {
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
