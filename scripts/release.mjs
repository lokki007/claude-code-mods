#!/usr/bin/env node
// Releases one mod from this repository, the single source for the mods:
//   1. bumps its version (plugin.json and the marketplace listing)
//   2. validates and tests it with the newest Claude Code on this machine
//   3. commits the release, so every version has history
//   4. refreshes the installed copy (the lokki-mods marketplace points at this folder)
//   5. keeps only the newest cached copy and checks nothing points at an older one
//   6. with --publish, pushes to GitHub
//
// Usage (from anywhere):
//   node G:\claude-code-mods\scripts\release.mjs <mod> [patch|minor|major|x.y.z] [--publish] [--dry-run]
//
// If validation or a test fails, nothing is committed or installed and the version bump is undone.

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

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
const git = (...cmd) => execFileSync('git', ['-C', REPO, ...cmd], { encoding: 'utf8' })

if (!mod) fail('Which mod? Usage: node scripts/release.mjs <mod> [patch|minor|major|x.y.z] [--publish]')
const modDir = join(REPO, 'plugins', mod)
const manifestPath = join(modDir, '.claude-plugin', 'plugin.json')
if (!existsSync(manifestPath)) fail(`No mod "${mod}" in ${join(REPO, 'plugins')}`)
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

// 2. Validate and test with the newest Claude Code.
say(`Checking with ${CLAUDE}`)
try {
  const validated = claude('plugin', 'validate', modDir)
  if (!/Validation passed/.test(validated)) throw new Error(validated)
  const hasTests = [...snapshot(modDir).keys()].some(k => /\.test\.tsx?$/.test(k))
  if (hasTests) {
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
git('add', '-A')
if (git('status', '--porcelain').trim()) {
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

// 6. Publish.
if (flag('publish')) {
  git('push', '-q')
  say(`Pushed to ${git('remote', 'get-url', 'origin').trim()}`)
}

console.log(`✔ ${mod} ${version} released. Restart chats (or run /reload-plugins) to load it.`)
