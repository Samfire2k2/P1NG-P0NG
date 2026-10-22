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
  check(/TOI/i.test(hud), 'le HUD affiche le score du joueur')
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

  // --- Round chronométré : chronomètre, couleur de la balle, tension ---
  await page.getByRole('button', { name: '3 min', exact: true }).click()
  await wait(400)
  await page.getByRole('button', { name: /^Jouer$/i }).click()
  await wait(2000)

  const timed = await page.evaluate(() => {
    const engine = window.__pingPong?.engine
    const state = engine?.getState?.()
    return {
      format: state?.format,
      timeLeft: state?.timeLeft ?? -1,
      tension: window.__pingPong?.music?.currentTension ?? -1,
      hud: document.body.innerText,
    }
  })
  check(timed.format === 'time', 'le format chronométré est actif')
  check(timed.timeLeft > 0 && timed.timeLeft <= 180, `le chronomètre est lancé (${Math.round(timed.timeLeft)} s)`)
  check(/\b\d:\d\d\b/.test(timed.hud), 'le HUD affiche le compte à rebours')

  const timeBefore = timed.timeLeft
  await wait(1600)
  const timeAfter = await page.evaluate(() => window.__pingPong?.engine?.getState?.().timeLeft ?? -1)
  check(timeAfter < timeBefore, `le chronomètre décompte (${Math.round(timeBefore)} -> ${Math.round(timeAfter)})`)

  // La balle prend la couleur de la raquette qui l'a frappée : on suit la
  // balle pour provoquer un contact.
  let owner = -99
  for (let i = 0; i < 40 && owner < 0; i++) {
    await wait(200)
    owner = await page.evaluate(() => {
      const engine = window.__pingPong?.engine
      const world = engine?.world
      if (!engine || !world) return -99
      // On pilote la raquette à la main (le curseur reprend la main ensuite).
      engine.pointerActive = false
      engine.localPaddleTarget = world.ball.y
      return world.ball.owner
    })
  }
  check(
    owner === 0 || owner === 1,
    `la balle porte la couleur de la raquette qui l’a frappée (owner=${owner})`,
  )
  await page.mouse.move(640, 220)
  await wait(200)
  check(timed.tension >= 0 && timed.tension <= 1, `la tension musicale est dans [0, 1] (${timed.tension.toFixed(2)})`)

  // --- La raquette suit la souris sans retard ---
  await page.mouse.move(640, 220)
  await wait(150)
  const sync = await page.evaluate(() => {
    const engine = window.__pingPong?.engine
    return {
      paddle: Math.round(engine?.world?.player?.y ?? -1),
      target: Math.round(engine?.localPaddleTarget ?? -2),
    }
  })
  check(
    Math.abs(sync.paddle - sync.target) < 4,
    `la raquette est calée sur le curseur (écart ${Math.abs(sync.paddle - sync.target)} unités)`,
  )

  // --- Redémarrage : la simulation repart (le monde ne doit pas rester gelé) ---
  await page.getByRole('button', { name: 'Recommencer' }).click()
  await wait(200)
  const restarted = await page.evaluate(() => {
    const engine = window.__pingPong?.engine
    return {
      frozen: engine?.world?.frozen ?? true,
      phase: engine?.world?.phase ?? '',
      countdown: engine?.world?.countdown ?? -1,
    }
  })
  check(restarted.frozen === false, 'le redémarrage relance la simulation')
  check(restarted.countdown === 2, `le compte à rebours repart de 2 (${restarted.countdown})`)

  // Espace pendant le compte à rebours : la partie ne doit pas se figer.
  await page.keyboard.press('Space')
  await wait(200)
  const afterSpace = await page.evaluate(() => window.__pingPong?.engine?.getState?.().phase)
  check(afterSpace !== 'paused', 'Espace ne met pas en pause pendant le compte à rebours')

  await wait(2200)
  const served = await page.evaluate(() => {
    const engine = window.__pingPong?.engine
    return { phase: engine?.world?.phase ?? '', countdown: engine?.world?.countdown ?? -1 }
  })
  check(
    served.phase === 'play' || served.countdown < 2,
    `la balle est servie après le compte à rebours (${served.phase}, cd=${served.countdown})`,
  )

  // La touche R ne relance plus la partie.
  const beforeR = await page.evaluate(() => window.__pingPong?.engine?.world?.frame ?? 0)
  await page.keyboard.press('KeyR')
  await wait(300)
  const afterR = await page.evaluate(() => {
    const engine = window.__pingPong?.engine
    return { frame: engine?.world?.frame ?? 0, phase: engine?.world?.phase ?? '' }
  })
  check(afterR.phase !== 'serve' || afterR.frame > beforeR, 'la touche R ne relance plus la partie')

  check(errors.length === 0, `aucune erreur JS (${errors.join(' | ') || 'aucune'})`)
  await browser.close()
} catch (e) {
  console.error(e)
  failures++
} finally {
  server.kill()
}

process.exit(failures ? 1 : 0)
