/**
 * Vérification visuelle : lecture directe des pixels du canvas pour confirmer
 * que les raquettes, la balle et l'arène sont bien rendues aux bons endroits
 * et dans les bonnes couleurs.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { chromium } from 'playwright-core'
import { resolveChrome } from './chrome-path.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const CHROME = resolveChrome()
const PORT = 4175

const server = spawn(
  process.execPath,
  [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PORT), '--strictPort'],
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
  await wait(2500)
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' })
  await wait(1500)
  await page.getByRole('button', { name: /^Jouer$/i }).click()

  // Attend la mise en jeu (le rendu logiciel peut être lent : on interroge
  // l'état du moteur plutôt que de fixer une durée).
  let playing = false
  for (let i = 0; i < 40 && !playing; i++) {
    await wait(500)
    playing = await page.evaluate(
      () => window.__pingPong?.engine?.getState?.().phase === 'playing',
    )
  }
  check(playing, 'la partie est en cours')
  await wait(1200)

  // Le HUD doit afficher un score
  const hud = await page.evaluate(() => document.body.innerText)
  check(/VOUS/i.test(hud), 'le HUD affiche le score du joueur')
  check(/ADVERSAIRE/i.test(hud), 'le HUD affiche le score de l’adversaire')

  // Déplacement de la souris : la raquette doit suivre
  await page.mouse.move(200, 120)
  await wait(700)
  const topSample = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    const shot = document.createElement('canvas')
    shot.width = canvas.width
    shot.height = canvas.height
    const ctx = shot.getContext('2d')
    ctx.drawImage(canvas, 0, 0)
    const dpr = canvas.width / canvas.getBoundingClientRect().width
    // Colonne de la raquette joueur (x monde ~ 96 -> px)
    const x = Math.round(96 * (canvas.height / 900) + (canvas.width - 1600 * (canvas.height / 900)) / 2)
    const y = Math.round(120 * dpr)
    const data = ctx.getImageData(x, y, 24, 1).data
    let best = 0
    for (let i = 0; i < data.length; i += 4) {
      const lum = data[i] + data[i + 1] + data[i + 2]
      if (lum > best) best = lum
    }
    return best / 3
  })
  check(topSample > 60, `la raquette joueur est visible en haut (lum ${topSample.toFixed(0)})`)

  // La balle doit être détectable : pixels très lumineux hors des raquettes
  const ball = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    const shot = document.createElement('canvas')
    shot.width = canvas.width
    shot.height = canvas.height
    const ctx = shot.getContext('2d')
    ctx.drawImage(canvas, 0, 0)
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let count = 0
    let max = 0
    for (let i = 0; i < data.length; i += 4) {
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3
      if (lum > 215) count++
      if (lum > max) max = lum
    }
    return { count, max }
  })
  check(ball.count > 0, `des pixels très lumineux sont présents (balle / cœurs : ${ball.count}, max ${ball.max.toFixed(0)})`)

  // Le fond doit rester sombre mais la grille visible
  const bg = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    const shot = document.createElement('canvas')
    shot.width = canvas.width
    shot.height = canvas.height
    const ctx = shot.getContext('2d')
    ctx.drawImage(canvas, 0, 0)
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let sum = 0
    let n = 0
    for (let i = 0; i < data.length; i += 4) {
      sum += (data[i] + data[i + 1] + data[i + 2]) / 3
      n++
    }
    return sum / n
  })
  check(bg > 4 && bg < 90, `le fond est sombre mais lisible (luminance moyenne ${bg.toFixed(1)})`)

  // Pause via la barre d'espace
  await page.keyboard.press('Space')
  await wait(500)
  const paused = await page.evaluate(() => document.body.innerText)
  check(/PAUSE/i.test(paused), 'la pause s’active au clavier')
  await page.keyboard.press('Space')
  await wait(300)

  // Changement de couleur (arc-en-ciel) via le menu
  await page.evaluate(() => {
    const target = [...document.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === 'Menu',
    )
    target?.click()
  })
  await wait(700)
  const accentBefore = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--accent'),
  )
  await page.getByLabel('Teinte (arc-en-ciel)').fill('48')
  await wait(400)
  const accentAfter = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--accent'),
  )
  check(accentBefore !== accentAfter, `la couleur d'accent change avec la teinte (${accentBefore.trim()} -> ${accentAfter.trim()})`)

  check(errors.length === 0, `aucune erreur JS (${errors.join(' | ') || 'aucune'})`)
  await browser.close()
} catch (e) {
  console.error(e)
  failures++
} finally {
  server.kill()
}

process.exit(failures ? 1 : 0)
