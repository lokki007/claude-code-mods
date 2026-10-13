#!/usr/bin/env node
// Turns a folder of screenshots into the README's demo GIF.
//
//   node scripts/demo-gif.mjs <folder> [seconds-per-frame] [out.gif]
//
// Frames are taken in file-name order (01.png, 02.png, ...), scaled to one
// width, centred on a dark canvas of one height, and held a moment each.
// Needs ffmpeg and ffprobe on the PATH.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const [folder, secondsArg = '2.5', outArg = 'docs/recap-demo.gif'] = process.argv.slice(2)
if (!folder) {
  console.error('Usage: node scripts/demo-gif.mjs <folder-of-screenshots> [seconds-per-frame] [out.gif]')
  process.exit(1)
}
const WIDTH = 900
const seconds = Number(secondsArg) > 0 ? Number(secondsArg) : 2.5
const out = resolve(outArg)

const frames = readdirSync(folder)
  .filter(f => /\.(png|jpe?g|webp)$/i.test(f))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  .map(f => resolve(folder, f))
if (frames.length === 0) {
  console.error(`No screenshots (.png, .jpg, .webp) in ${folder}`)
  process.exit(1)
}

// Every frame scaled to one width; the canvas is as tall as the tallest one.
const heightAt = file => {
  const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file])
    .toString().trim().split(',').map(Number)
  return Math.round((h * WIDTH) / w / 2) * 2
}
const height = Math.max(...frames.map(heightAt))

const work = mkdtempSync(join(tmpdir(), 'demo-gif-'))
try {
  // Each frame drawn to the same size first: a GIF cannot change size part way through.
  const fit = `scale=${WIDTH}:-2:flags=lanczos,pad=${WIDTH}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x1e1e1e`
  const sized = frames.map((f, i) => {
    const to = join(work, `${String(i).padStart(3, '0')}.png`)
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', f, '-vf', fit, to])
    return to
  })
  // The concat list holds each frame for `seconds`; the last is listed twice so its hold counts.
  const list = join(work, 'frames.txt')
  const quote = f => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`
  writeFileSync(list, [...sized.flatMap(f => [quote(f), `duration ${seconds}`]), quote(sized.at(-1))].join('\n'))
  const palette = join(work, 'palette.png')
  const ff = args => execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, ...args], { stdio: 'inherit' })
  ff(['-vf', 'fps=10,palettegen=stats_mode=diff', palette])
  ff(['-i', palette, '-lavfi', 'fps=10[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', '-loop', '0', out])
} finally {
  rmSync(work, { recursive: true, force: true })
}
console.log(`✔ ${out}: ${frames.length} frames, ${seconds}s each, ${(statSync(out).size / 1024).toFixed(0)} KB`)
