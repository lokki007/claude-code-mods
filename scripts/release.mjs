#!/usr/bin/env node
// Releases one mod from this repository, the single source for the mods:
//   1. bumps its version (plugin.json and the marketplace listing)
//   2. copies in the shared test helpers, then validates and tests it with the newest Claude Code here
//   3. commits the release, so every version has history
//   4. refreshes the installed copy (the lokki-mods marketplace points at this folder)
//   5. keeps only the newest cached copy and checks nothing points at an older one
//   6. with --stage, pushes to the staging branch and checks a fresh install from it on GitHub;
//      with --publish, pushes to the public version (main) instead
//
// Usage (from anywhere):
//   node G:\claude-code-mods\scripts\release.mjs <mod> [patch|minor|major|x.y.z] [--stage | --publish] [--dry-run]
//   node G:\claude-code-mods\scripts\release.mjs promote [--dry-run]
//       moves what is on staging to the public version, then checks a fresh install from GitHub
//
// If validation or a test fails, nothing is committed or installed and the version bump is undone.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { syncShared } from './sync-shared.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const MARKET_FILE = join(REPO, '.claude-plugin', 'marketplace.json')
const INSTALLED = join(homedir(), '.claude', 'plugins', 'installed_plugins.json')
/** Laid down by Claude Code for the editor; never part of a mod. */
const SKIP = ['.claude-plugin/types', 'tsconfig.json', 'node_modules']

const args = process.argv.slice(2)
const flag = name => args.includes(`--${name}`)
const [mod, bumpArg = 'patch'] = args.filter(a => !a.startsWith('--'))
const isDry = flag('dry-run')

const say = msg => console.log(`• ${msg}`)
const fail = msg => {
  console.error(`✘ ${msg}`)
  process.exit(1)
}
const readJson = p => JSON.parse(readFileSync(p, 'utf8'))
const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`)
const git = (...cmd) => execFileSync('git', ['-C', REPO, ...cmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const MARKETPLACE = readJson(MARKET_FILE).name
const CACHE_DIR = join(homedir(), '.claude', 'plugins', 'cache', MARKETPLACE)

/** The newest Claude Code the desktop app installed; the `claude` on PATH can lag far behind. */
const findClaude = () => {
  const root = join(process.env.APPDATA ?? '', 'Claude', 'claude-code')
  const newestFirst = (a, b) => {
    const pa = a.split('.').map(Number)
    const pb = b.split('.').map(Number)
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pb[i] - pa[i]
    return 0
  }
  if (existsSync(root)) {
    for (const version of readdirSync(root).filter(v => /^\d+\.\d+\.\d+$/.test(v)).sort(newestFirst)) {
      for (const build of readdirSync(join(root, version))) {
        const exe = join(root, version, build, process.platform === 'win32' ? 'claude.exe' : 'claude')
        if (existsSync(exe)) return exe
      }
    }
  }
  return 'claude'
}
const CLAUDE = findClaude()
const claude = (...cmd) => execFileSync(CLAUDE, cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

const skipped = rel => SKIP.some(s => rel === s || rel.startsWith(`${s}/`))
/** Every file under a folder with its contents, for comparing two copies. */
const snapshot = dir => {
  const out = new Map()
  const walk = d => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      const rel = relative(dir, p).replace(/\\/g, '/')
      if (skipped(rel)) continue
      if (statSync(p).isDirectory()) walk(p)
      else out.set(rel, readFileSync(p, 'utf8'))
    }
  }
  if (existsSync(dir)) walk(dir)
  return out
}
const sameFiles = (a, b) => {
  const x = snapshot(a)
  const y = snapshot(b)
  return x.size === y.size && [...x].every(([k, v]) => y.get(k) === v)
}
const hasTests = dir => [...snapshot(dir).keys()].some(k => /\.test\.tsx?$/.test(k))
/** Runs a mod's tests; returns the summary line, or fails with the end of the output. */
const runTests = (dir, label) => {
  let out = ''
  try {
    out = claude('plugin', 'test', dir)
  } catch (err) {
    out = String(err?.stdout ?? '') + String(err?.stderr ?? '')
  }
  if (!/\b0 fail\b/.test(out)) fail(`${label} fails its tests:\n${out.trim().split('\n').slice(-25).join('\n')}`)
  return out.trim().split('\n').slice(-3, -1).join(', ')
}

/** owner/repo of the GitHub remote. */
const githubRepo = () => {
  const url = git('remote', 'get-url', 'origin').trim()
  const m = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)
  if (!m) fail(`origin is not a GitHub repository: ${url}`)
  return m[1]
}

/**
 * Installs mods fresh from GitHub (at `ref`, or the default branch) in a
 * throwaway Claude config, the way a new user would, and runs each one's tests
 * there. `want` maps each mod to the version that must arrive.
 */
const verifyFromGitHub = (ref, want) => {
  const source = `${githubRepo()}${ref ? `#${ref}` : ''}`
  const config = mkdtempSync(join(tmpdir(), 'mods-verify-'))
  const isolated = (...cmd) =>
    execFileSync(CLAUDE, cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CLAUDE_CONFIG_DIR: config } })
  try {
    say(`Fresh install from GitHub: ${source}`)
    isolated('plugin', 'marketplace', 'add', source)
    for (const [name, version] of Object.entries(want)) {
      isolated('plugin', 'install', `${name}@${MARKETPLACE}`)
      const base = join(config, 'plugins', 'cache', MARKETPLACE, name)
      const dir = join(base, version)
      if (!existsSync(dir)) fail(`GitHub (${source}) did not hand over ${name} ${version}; it has ${existsSync(base) ? readdirSync(base).join(', ') : 'nothing'}`)
      say(`  ${name} ${version} from GitHub: ${hasTests(dir) ? runTests(dir, `${name} ${version} from GitHub`) : 'installed'}`)
    }
  } finally {
    rmSync(config, { recursive: true, force: true })
  }
}

/** The version of every mod listed in the marketplace file at a git ref. */
const versionsAt = ref =>
  Object.fromEntries(JSON.parse(git('show', `${ref}:.claude-plugin/marketplace.json`)).plugins.map(p => [p.name, p.version]))

// ---- promote: staging becomes the public version ------------------------------------------

if (mod === 'promote') {
  git('fetch', '-q', 'origin')
  try {
    git('rev-parse', '--verify', '-q', 'origin/staging')
  } catch {
    fail('There is no staging branch on GitHub yet: release a mod with --stage first')
  }
  try {
    git('merge-base', '--is-ancestor', 'origin/main', 'origin/staging')
  } catch {
    fail('The public version has changes that staging does not; bring staging up to date first')
  }
  const want = versionsAt('origin/staging')
  const was = versionsAt('origin/main')
  for (const [name, v] of Object.entries(want)) say(`${name}: ${was[name] ?? 'new'} → ${v}`)
  if (isDry) {
    say('Dry run: stopping before the public version changes')
    process.exit(0)
  }
  git('push', '-q', 'origin', 'origin/staging:refs/heads/main')
  say('The public version now matches staging')
  // Bring the local main along when it can move straight forward.
  try {
    git('merge', '-q', '--ff-only', 'origin/main')
  } catch {
    say('Local main has other work, so it was left as it is')
  }
  verifyFromGitHub('', want)
  console.log('✔ Promoted: a fresh install from GitHub gets the staging versions and passes their tests.')
  process.exit(0)
}

// ---- release one mod ----------------------------------------------------------------------

if (!mod) fail('Which mod? Usage: node scripts/release.mjs <mod> [patch|minor|major|x.y.z] [--stage | --publish], or: promote')
if (flag('stage') && flag('publish')) fail('Choose one: --stage (the staging branch) or --publish (the public version)')
const modDir = join(REPO, 'plugins', mod)
const manifestPath = join(modDir, '.claude-plugin', 'plugin.json')
if (!existsSync(manifestPath)) fail(`No mod "${mod}" in ${join(REPO, 'plugins')}`)

const bump = (version, how) => {
  if (/^\d+\.\d+\.\d+$/.test(how)) return how
  const [maj, min, pat] = version.split('.').map(Number)
  if (how === 'major') return `${maj + 1}.0.0`
  if (how === 'minor') return `${maj}.${min + 1}.0`
  if (how === 'patch') return `${maj}.${min}.${pat + 1}`
  fail(`"${how}" is not patch, minor, major or a version like 1.2.3`)
}

// 1. Bump the version in the mod and in the marketplace listing.
const manifest = readJson(manifestPath)
const market = readJson(MARKET_FILE)
const before = manifest.version ?? '0.0.0'
const version = bump(before, bumpArg)
say(`${mod}: ${before} → ${version}`)
const original = { manifest: readFileSync(manifestPath, 'utf8'), market: readFileSync(MARKET_FILE, 'utf8') }
const undoBump = () => {
  writeFileSync(manifestPath, original.manifest)
  writeFileSync(MARKET_FILE, original.market)
}
if (!isDry) {
  writeJson(manifestPath, { ...manifest, version })
  const entry = market.plugins.find(p => p.name === mod)
  if (entry) Object.assign(entry, { version, description: manifest.description })
  else market.plugins.push({ name: mod, source: `./plugins/${mod}`, description: manifest.description, version })
  writeJson(MARKET_FILE, market)
}

// 2. The shared test helpers travel with each mod; then validate and test with the newest Claude Code.
const synced = syncShared(mod, { check: isDry })
if (synced.length > 0) say(`${isDry ? 'Would sync' : 'Synced'} shared helpers: ${synced.join(', ')}`)
say(`Checking with ${CLAUDE}`)
try {
  const validated = claude('plugin', 'validate', modDir)
  if (!/Validation passed/.test(validated)) throw new Error(validated)
  if (hasTests(modDir)) {
    const tested = claude('plugin', 'test', modDir)
    if (!/\b0 fail\b/.test(tested)) throw new Error(tested)
    say(`Tests: ${tested.trim().split('\n').slice(-3).join(' ')}`)
  } else {
    say('No tests in this mod')
  }
} catch (err) {
  if (!isDry) undoBump()
  const text = String(err?.stdout ?? '') + String(err?.stderr ?? '') + String(err?.message ?? err)
  fail(`Checks failed, version left at ${before}:\n${text.trim().split('\n').slice(-25).join('\n')}`)
}
if (isDry) {
  say('Dry run: stopping before anything is committed or installed')
  process.exit(0)
}

// 3. Commit the release: every version has history.
// Only this mod and the listing: another mod's unreleased work stays out of this release.
git('add', '-A', '--', `plugins/${mod}`, '.claude-plugin/marketplace.json')
if (git('diff', '--cached', '--name-only').trim()) {
  git('commit', '-q', '-m', `Release ${mod} ${version}`)
  say(`Committed: ${git('log', '-1', '--format=%h %s').trim()}`)
}

// 4. Refresh the installed copy.
claude('plugin', 'marketplace', 'update', MARKETPLACE)
const key = `${mod}@${MARKETPLACE}`
const records = existsSync(INSTALLED) ? readJson(INSTALLED) : { plugins: {} }
const isInstalled = Boolean((records.plugins ?? records)[key])
claude('plugin', isInstalled ? 'update' : 'install', key, '--scope', 'user')
const cached = join(CACHE_DIR, mod, version)
if (!existsSync(cached)) fail(`The plugin cache has no ${mod} ${version} at ${cached}`)
if (!sameFiles(modDir, cached)) fail(`The cached ${mod} ${version} differs from ${modDir}`)
say(`Installed ${key} ${version}; the cached copy matches the repository`)

// 5. Keep only the newest cached copy, and make sure nothing points at an older one.
for (const old of readdirSync(join(CACHE_DIR, mod)).filter(v => v !== version)) {
  rmSync(join(CACHE_DIR, mod, old), { recursive: true, force: true })
  say(`Removed old cached ${mod} ${old}`)
}
const record = (readJson(INSTALLED).plugins ?? readJson(INSTALLED))[key]
const paths = (Array.isArray(record) ? record : [record]).map(r => r?.installPath)
if (!paths.every(p => p && existsSync(p) && p.endsWith(version))) fail(`installed_plugins.json still points at ${paths.join(', ')}`)

// 6. Stage or publish.
if (flag('stage')) {
  git('push', '-q', '-f', 'origin', 'HEAD:refs/heads/staging')
  say('Pushed to the staging branch')
  verifyFromGitHub('staging', { [mod]: version })
}
if (flag('publish')) {
  git('push', '-q')
  say(`Pushed to ${git('remote', 'get-url', 'origin').trim()}`)
}

console.log(`✔ ${mod} ${version} released${flag('stage') ? ' to staging' : flag('publish') ? ' publicly' : ''}. Restart chats (or run /reload-plugins) to load it.`)
