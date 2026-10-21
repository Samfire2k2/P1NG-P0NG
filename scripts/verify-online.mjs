/**
 * Test du mode en ligne : deux pages indépendantes, l'une crée un salon, l'autre
 * le rejoint via le lien d'invitation. Vérifie la connexion P2P (signalisation
 * Nostr + WebRTC), la latence, la synchronisation des scores et du rendu.
 * Lancement : npm run verify:online
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { chromium } from 'playwright-core'
import { resolveChrome } from './chrome-path.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const CHROME = resolveChrome()
const PORT = 4177

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

/** État interne du moteur (mode, rôle, connexion, scores, balle). */
const readEngine = (page) =>
  page.evaluate(() => {
    const engine = window.__pingPong?.engine
    if (!engine) return null
    const state = engine.getState()
    const world = engine.world
    return {
      mode: state.mode,
      role: engine.session?.role ?? null,
      phase: state.phase,
      netStatus: state.netStatus,
      peerConnected: state.peerConnected,
      roomCode: state.roomCode,
      latency: state.latency,
      netMessage: state.netMessage,
      scorePlayer: state.scorePlayer,
      scoreAi: state.scoreAi,
      ball: [world.ball.x, world.ball.y],
      fps: state.fps,
    }
  })

/** Comptage de pixels lumineux (balle / raquettes / traînée). */
const brightPixels = (page) =>
  page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    const shot = document.createElement('canvas')
    shot.width = 80
    shot.height = 50
    const ctx = shot.getContext('2d')
    ctx.drawImage(canvas, 0, 0, 80, 50)
    const data = ctx.getImageData(0, 0, 80, 50).data
    let bright = 0
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i] + data[i + 1] + data[i + 2]) / 3 > 190) bright++
    }
    return bright
  })

try {
  await wait(2500)
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--autoplay-policy=no-user-gesture-required',
    ],
  })

  const context = await browser.newContext({ viewport: { width: 820, height: 540 } })
  const errors = []
  const host = await context.newPage()
  const guest = await context.newPage()
  for (const page of [host, guest]) {
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
  }

  // --- L'hôte crée le salon ---
  await host.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' })
  await wait(2000)
  await host.getByRole('button', { name: /En ligne/i }).click()
  await wait(400)
  await host.getByRole('button', { name: /Créer un salon/i }).click()
  await wait(2500)

  const inviteValue = await host.getByLabel("Lien d'invitation").inputValue()
  check(inviteValue.includes('room='), `un lien d'invitation est généré (${inviteValue})`)
  const inviteUrl = new URL(inviteValue)
  const roomCode = inviteUrl.searchParams.get('room') ?? ''
  const roomKey = inviteUrl.searchParams.get('key') ?? ''
  check(roomCode.length >= 4, `code de salon : ${roomCode}`)
  check(roomKey.length === 32, `clé de chiffrement transmise (${roomKey.length} caractères)`)

  const hostWaiting = await host.evaluate(() => /En attente/i.test(document.body.innerText))
  check(hostWaiting, "l'hôte attend l'adversaire")

  // --- L'invité rejoint via le lien (aucune action manuelle) ---
  await guest.goto(inviteValue, { waitUntil: 'load' })
  await wait(2000)

  const connected = async (page) => {
    const state = await readEngine(page)
    return state?.netStatus === 'connected' && state?.peerConnected === true
  }

  let hostOk = await connected(host)
  let guestOk = await connected(guest)
  for (let i = 0; i < 40 && !(hostOk && guestOk); i++) {
    await wait(1000)
    hostOk = await connected(host)
    guestOk = await connected(guest)
    if (i % 10 === 9) console.log(`    … attente P2P (${i + 1}s) hôte=${hostOk} invité=${guestOk}`)
  }
  check(hostOk, "l'hôte voit l'adversaire connecté")
  check(guestOk, "l'invité voit l'hôte connecté")

  const hostState = await readEngine(host)
  const guestState = await readEngine(guest)
  check(hostState?.role === 'host' && guestState?.role === 'guest', 'les rôles hôte/invité sont corrects')
  check(hostState?.roomCode === roomCode && guestState?.roomCode === roomCode, `les deux joueurs partagent le salon ${roomCode}`)

  // --- La partie démarre des deux côtés ---
  await wait(4000)
  const hostPlaying = await readEngine(host)
  const guestPlaying = await readEngine(guest)
  check(hostPlaying?.phase === 'playing' || hostPlaying?.phase === 'gameover', `la partie démarre chez l'hôte (${hostPlaying?.phase})`)
  check(guestPlaying?.phase === 'playing' || guestPlaying?.phase === 'gameover', `la partie démarre chez l'invité (${guestPlaying?.phase})`)

  // --- Latence mesurée ---
  const latencyText = await host.evaluate(() => {
    const m = document.body.innerText.match(/Salon\s+([A-Z0-9]+)\s*·\s*(\d+)\s*ms/i)
    return m ? { code: m[1], latency: Number(m[2]) } : null
  })
  check(latencyText?.code === roomCode, `le HUD affiche le bon salon (${latencyText?.code})`)
  check(
    latencyText !== null && latencyText.latency >= 0 && latencyText.latency < 3000,
    `latence mesurée : ${latencyText?.latency} ms`,
  )

  // --- La balle est rendue des deux côtés ---
  const hostPixels = await brightPixels(host)
  const guestPixels = await brightPixels(guest)
  check(hostPixels > 0, `la balle est rendue chez l'hôte (${hostPixels} px)`)
  check(guestPixels > 0, `la balle est rendue chez l'invité (${guestPixels} px)`)

  // --- Les scores sont synchronisés (miroir) ---
  await wait(6000)
  const hostScores = await readEngine(host)
  const guestScores = await readEngine(guest)
  check(
    hostScores?.scorePlayer === guestScores?.scoreAi && hostScores?.scoreAi === guestScores?.scorePlayer,
    `scores synchronisés (hôte ${hostScores?.scorePlayer}-${hostScores?.scoreAi} / invité ${guestScores?.scorePlayer}-${guestScores?.scoreAi})`,
  )

  // --- Le HUD associe le bon score au bon côté (gauche = hôte) ---
  const readHud = (page) =>
    page.evaluate(() => {
      const m = document.body.innerText.match(/(\d+)\s*(VOUS|ADVERSAIRE)\s*(\d+)\s*(ADVERSAIRE|VOUS)/i)
      if (!m) return null
      return { left: Number(m[1]), leftLabel: m[2].toUpperCase(), right: Number(m[3]), rightLabel: m[4].toUpperCase() }
    })
  const hostHud = await readHud(host)
  const guestHud = await readHud(guest)
  check(
    hostHud?.leftLabel === 'VOUS' &&
      hostHud?.rightLabel === 'ADVERSAIRE' &&
      hostHud?.left === hostScores?.scorePlayer &&
      hostHud?.right === hostScores?.scoreAi,
    `HUD de l'hôte : ${hostHud?.left} ${hostHud?.leftLabel} / ${hostHud?.right} ${hostHud?.rightLabel}`,
  )
  check(
    guestHud?.leftLabel === 'ADVERSAIRE' &&
      guestHud?.rightLabel === 'VOUS' &&
      guestHud?.left === guestScores?.scorePlayer &&
      guestHud?.right === guestScores?.scoreAi,
    `HUD de l'invité : ${guestHud?.left} ${guestHud?.leftLabel} / ${guestHud?.right} ${guestHud?.rightLabel}`,
  )

  // --- La position de la balle est cohérente entre les deux vues ---
  const hostBall = hostScores?.ball ?? [0, 0]
  const guestBall = guestScores?.ball ?? [0, 0]
  const delta = Math.hypot(hostBall[0] - guestBall[0], hostBall[1] - guestBall[1])
  check(delta < 220, `la balle est synchronisée entre les deux vues (écart ${Math.round(delta)} unités)`)

  check(errors.length === 0, `aucune erreur JS (${errors.slice(0, 3).join(' | ') || 'aucune'})`)

  // --- Quitter le salon : l'autre joueur est prévenu ---
  await guest.getByRole('button', { name: /Quitter le salon/i }).click()
  await wait(2500)
  const guestLeft = await readEngine(guest)
  check(guestLeft?.mode === 'ai' && guestLeft?.netStatus === 'idle', "l'invité quitte le salon")
  const hostAfter = await readEngine(host)
  check(
    /quitté/i.test(hostAfter?.netMessage ?? '') || hostAfter?.peerConnected === false,
    `l'hôte est prévenu du départ (${hostAfter?.netMessage || 'déconnexion détectée'})`,
  )

  await browser.close()
} catch (e) {
  console.error(e)
  failures++
} finally {
  server.kill()
}

process.exit(failures ? 1 : 0)
