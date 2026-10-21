/**
 * Smoke test navigateur : lance le build, ouvre la page dans Chrome (WebGL2),
 * vérifie l'absence d'erreur console/WebGL et capture des screenshots.
 * Lancement : npm run smoke
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { chromium } from 'playwright-core'
import { resolveChrome } from './chrome-path.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const CHROME = resolveChrome()
const PORT = 4173
const OUT = join(root, 'screenshots')

const server = spawn(
  process.execPath,
  [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PORT), '--strictPort'],
  { cwd: root, stdio: 'ignore' },
)

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let exitCode = 0
try {
  await wait(2500)
  mkdirSync(OUT, { recursive: true })

  const browser = await chromium.launch({
    executablePath: CHROME,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--hide-scrollbars',
    ],
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

  const errors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' })
  await wait(2000)

  const webgl = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    if (!gl) return { ok: false }
    const debug = gl.getExtension('WEBGL_debug_renderer_info')
    return {
      ok: true,
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    }
  })
  console.log(`  WebGL2 : ${webgl.ok ? 'OK' : 'INDISPONIBLE'} ${webgl.renderer ?? ''}`)

  const buttons = await page.evaluate(() =>
    [...document.querySelectorAll('button')].map((b) => b.textContent.trim()),
  )
  console.log(`  Boutons : ${buttons.join(' | ')}`)

  await page.screenshot({ path: join(OUT, '01-menu.png') })

  // Démarrer la partie
  await page.getByRole('button', { name: /^Jouer$/i }).click()
  await wait(3000)
  await page.screenshot({ path: join(OUT, '02-game.png') })

  // Vérifie que le canvas est bien rendu (variété de luminances)
  const variance = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    if (!canvas) return null
    const shot = document.createElement('canvas')
    shot.width = 160
    shot.height = 100
    const ctx = shot.getContext('2d')
    ctx.drawImage(canvas, 0, 0, 160, 100)
    const data = ctx.getImageData(0, 0, 160, 100).data
    let min = 255
    let max = 0
    let sum = 0
    for (let i = 0; i < data.length; i += 4) {
      const l = (data[i] + data[i + 1] + data[i + 2]) / 3
      min = Math.min(min, l)
      max = Math.max(max, l)
      sum += l
    }
    return { min, max, mean: sum / (data.length / 4) }
  })
  console.log(
    `  Canvas : luminance min ${variance?.min.toFixed(1)} max ${variance?.max.toFixed(1)} moyenne ${variance?.mean.toFixed(1)}`,
  )

  // Met en pause pour capturer l'overlay
  await page.keyboard.press('Space')
  await wait(600)
  await page.screenshot({ path: join(OUT, '03-pause.png') })
  await page.keyboard.press('Space')
  await wait(400)

  // Change la teinte (arc-en-ciel) via le slider
  const hue = page.getByLabel('Teinte (arc-en-ciel)')
  if (await hue.count()) {
    await hue.fill('28')
    await wait(400)
  }

  // Retour au menu pour capturer le picker
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')]
    const target = buttons.find((b) => b.textContent.trim() === 'Menu')
    target?.click()
  })
  await wait(800)
  await page.screenshot({ path: join(OUT, '04-picker.png') })

  await browser.close()

  if (errors.length) {
    console.error('\n  Erreurs détectées :')
    errors.forEach((e) => console.error(`   - ${e}`))
    exitCode = 1
  } else {
    console.log('  Aucune erreur console ✓')
  }
  if (!variance || variance.max - variance.min < 12) {
    console.error('  Le canvas semble uniforme (rendu suspect)')
    exitCode = 1
  }
} catch (error) {
  console.error(error)
  exitCode = 1
}

server.kill()
process.exit(exitCode)
