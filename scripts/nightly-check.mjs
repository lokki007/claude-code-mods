#!/usr/bin/env node
// The nightly check: one short headless chat with both mods loaded, then a look
// at what they wrote. Alerts with a Windows notification if anything failed.
//
//   node scripts/nightly-check.mjs              run the check
//   node scripts/nightly-check.mjs --test-alert show what an alert looks like
//   node scripts/nightly-check.mjs --install    run it every night at 03:00 (Task Scheduler;
//                                               a missed run happens when the PC is next on)
//   node scripts/nightly-check.mjs --uninstall  stop the nightly runs
//
// It passes when:
//   - Claude finishes the chat (it writes a small file in a scratch folder),
//   - recap logs the turn and a finished recap (recap-ready), with no failure lines,
//   - turn-status announces itself in its copy registry.
// Each run writes a report to ~/.claude/recap/nightly/<date>.txt.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TASK = 'Claude mods nightly check'
const HOME = homedir()
const RECAP_LOG = join(HOME, '.claude', 'recap', 'log.jsonl')
const TS_REGISTRY = join(HOME, '.claude', 'turn-status', 'instances.json')
const REPORTS = join(HOME, '.claude', 'recap', 'nightly')
const SCRATCH = join(tmpdir(), 'mods-nightly')
/** Log events that mean something went wrong. */
const FAILURES = ['recap-failed', 'diary-failed', 'registry-failed', 'tool-refused', 'simpler-failed', 'duplicate-copy']

const args = process.argv.slice(2)
const SELF = fileURLToPath(import.meta.url)

/** A Windows toast; falls back to the console elsewhere. */
const alert = (title, body) => {
  console.log(`🔔 ${title}: ${body}`)
  if (process.platform !== 'win32') return
  const xml = (s) => s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c])
  const script = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml('<toast><visual><binding template="ToastGeneric"><text>${xml(title)}</text><text>${xml(body)}</text></binding></visual></toast>')
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($doc))`
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore' })
}

/** The newest Claude Code the desktop app installed. */
const findClaude = () => {
  const root = join(process.env.APPDATA ?? '', 'Claude', 'claude-code')
  if (existsSync(root)) {
    const versions = readdirSync(root).filter(v => /^\d+\.\d+\.\d+$/.test(v))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    for (const v of versions) {
      for (const build of readdirSync(join(root, v))) {
        const exe = join(root, v, build, 'claude.exe')
        if (existsSync(exe)) return exe
      }
    }
  }
  return 'claude'
}

if (args.includes('--test-alert')) {
  alert('Claude mods: test alert', 'This is what a failed nightly check looks like.')
  process.exit(0)
}

if (args.includes('--install') || args.includes('--uninstall')) {
  if (process.platform !== 'win32') {
    console.error('The scheduled run is set up for Windows (Task Scheduler) only.')
    process.exit(1)
  }
  const ps = args.includes('--uninstall')
    ? `Unregister-ScheduledTask -TaskName '${TASK}' -Confirm:$false -ErrorAction SilentlyContinue`
    : `$a = New-ScheduledTaskAction -Execute '${process.execPath}' -Argument '"${SELF}"'
$t = New-ScheduledTaskTrigger -Daily -At 3am
$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 20)
Register-ScheduledTask -TaskName '${TASK}' -Action $a -Trigger $t -Settings $s -Description 'Runs a short headless Claude chat with the recap and turn-status mods and alerts on failure.' -Force | Out-Null
Get-ScheduledTask -TaskName '${TASK}' | Select-Object -ExpandProperty State`
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' })
  console.log(args.includes('--uninstall') ? `✔ Removed "${TASK}"` : `✔ "${TASK}" runs every night at 03:00 (state: ${out.trim()})`)
  process.exit(0)
}

// ---- the check ----------------------------------------------------------------------------

const started = new Date()
const stamp = started.toISOString().slice(0, 10)
mkdirSync(SCRATCH, { recursive: true })
mkdirSync(REPORTS, { recursive: true })
const logBefore = existsSync(RECAP_LOG) ? readFileSync(RECAP_LOG, 'utf8').length : 0
const registryBefore = existsSync(TS_REGISTRY) ? statSync(TS_REGISTRY).mtimeMs : 0
const problems = []
const report = [`Nightly check ${started.toISOString()}`]

const claude = findClaude()
report.push(`Claude: ${claude}`)
const run = spawnSync(claude, [
  '-p', `Use the Write tool to create nightly-${stamp}.html in this folder with a one-line "all good" note, then reply: done`,
  '--max-turns', '4', '--permission-mode', 'acceptEdits',
], { cwd: SCRATCH, encoding: 'utf8', timeout: 10 * 60_000, env: { ...process.env, RECAP_HEADLESS: '1' } })
const said = `${run.stdout ?? ''}${run.stderr ?? ''}`.split('\n').filter(l => l.trim() && !/SEP-2352/.test(l))
report.push(`Claude exit: ${run.status ?? run.error?.message}`, ...said.slice(-5).map(l => `  ${l}`))
if (run.status !== 0) problems.push(`Claude did not finish the chat (exit ${run.status ?? run.error?.message})`)
if (said.some(l => /No messages returned/i.test(l))) problems.push('Claude printed "No messages returned from query"')

// The recap may still be writing for a moment after Claude exits.
const project = SCRATCH.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
let lines = []
for (let i = 0; i < 30; i++) {
  const text = existsSync(RECAP_LOG) ? readFileSync(RECAP_LOG, 'utf8').slice(logBefore) : ''
  lines = text.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    .filter(l => l.project === project)
  if (lines.some(l => l.event === 'recap-ready' || l.event === 'recap-failed')) break
  await new Promise(r => setTimeout(r, 2000))
}
report.push('Recap log:', ...lines.map(l => `  ${l.event}${l.why ? `: ${l.why}` : ''}`))
for (const l of lines.filter(l => FAILURES.includes(l.event))) problems.push(`recap logged ${l.event}${l.why ? `: ${l.why}` : ''}`)
if (!lines.some(l => l.event === 'turn-recapped')) problems.push('recap did not pick up the turn')
if (!lines.some(l => l.event === 'recap-ready')) problems.push('recap did not finish a recap')
const registryAfter = existsSync(TS_REGISTRY) ? statSync(TS_REGISTRY).mtimeMs : 0
if (registryAfter <= registryBefore) problems.push('turn-status did not start')
else report.push('turn-status: started')

report.push(problems.length === 0 ? 'RESULT: all good' : `RESULT: ${problems.length} problem(s)`, ...problems.map(p => `  - ${p}`))
const reportPath = join(REPORTS, `${stamp}.txt`)
writeFileSync(reportPath, `${report.join('\n')}\n`)
if (problems.length > 0) {
  alert('Claude mods: nightly check failed', `${problems[0]}${problems.length > 1 ? ` (+${problems.length - 1} more)` : ''}. Report: ${reportPath}`)
  process.exit(1)
}
console.log(`✔ All good. Report: ${reportPath}`)
