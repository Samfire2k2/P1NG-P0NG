/**
 * Vérifie le moteur audio (Web Audio) dans un vrai navigateur et produit une
 * représentation ASCII du canvas pour contrôler la composition du rendu.
 * Lancement : node scripts/verify-audio.mjs
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { chromium } from 'playwright-core'
import { resolveChrome } from './chrome-path.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const CHROME = resolveChrome()
const PORT = 4176

const server = spawn(
  process.execPath,
  [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: root, stdio: 'ignore' },
)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
const check = (cond, msg) => {
  if (!cond) {
    failures++
    console.error(`  ✗ ${msg}`)
  } else {
    console.log(`  ✓ ${msg}`)
  }
}

try {
  await wait(4000)
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--autoplay-policy=no-user-gesture-required',
    ],
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' })
  await wait(2500)

  await page.getByRole('button', { name: /^Jouer$/i }).click()
  await wait(1200)

  const audioState = await page.evaluate(() => {
    const hook = window.__pingPong
    if (!hook) return null
    const ctx = hook.audio.ctx
    return {
      hasContext: !!ctx,
      state: ctx?.state ?? 'none',
      sampleRate: ctx?.sampleRate ?? 0,
      muted: hook.audio.muted,
      master: !!hook.audio.master,
      compressor: !!hook.audio.compressor,
    }
  })
  check(!!audioState, 'le hook de debug est exposé en dev')
  check(audioState?.hasContext === true, `un AudioContext est créé (état : ${audioState?.state})`)
  check(audioState?.state === 'running', `le contexte audio tourne (${audioState?.state})`)
  check(audioState?.sampleRate > 0, `fréquence d’échantillonnage : ${audioState?.sampleRate} Hz`)
  check(audioState?.master === true && audioState?.compressor === true, 'master + compresseur en place')
  check(audioState?.muted === false, 'le son n’est pas muet par défaut')

  // Déclenche plusieurs effets et vérifie l’absence d’erreur
  const played = await page.evaluate(() => {
    const { audio } = window.__pingPong
    audio.paddleHit(0.4, 0.6, true)
    audio.wallHit(0.3)
    audio.score('player')
    audio.countdown(1)
    audio.serve()
    audio.win()
    audio.lose()
    audio.hover()
    audio.click()
    audio.hue(210)
    return { muted: audio.muted, state: audio.ctx.state }
  })
  check(played.state === 'running', 'tous les effets sonores se jouent sans erreur')

  // Mute
  await page.keyboard.press('KeyM')
  await wait(300)
  const muted = await page.evaluate(() => window.__pingPong.audio.muted)
  check(muted === true, 'la touche M coupe le son')

  // Représentation ASCII du canvas
  await page.keyboard.press('KeyM')
  await wait(200)
  const ascii = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    const cols = 76
    const rows = 26
    const shot = document.createElement('canvas')
    shot.width = cols
    shot.height = rows
    const ctx = shot.getContext('2d')
    ctx.drawImage(canvas, 0, 0, cols, rows)
    const data = ctx.getImageData(0, 0, cols, rows).data
    const ramp = ' .:-=+*#%@'
    let out = ''
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = (y * cols + x) * 4
        const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255
        out += ramp[Math.min(ramp.length - 1, Math.floor(Math.pow(lum, 0.55) * ramp.length))]
      }
      out += '\n'
    }
    return out
  })
  console.log('\n  Aperçu du canvas (luminance) :\n')
  console.log(
    ascii
      .split('\n')
      .map((l) => '   |' + l)
      .join('\n'),
  )
  console.log('')

  check(errors.length === 0, `aucune erreur JS (${errors.join(' | ') || 'aucune'})`)
  await browser.close()
} catch (e) {
  console.error(e)
  failures++
} finally {
  server.kill()
}

process.exit(failures ? 1 : 0)
