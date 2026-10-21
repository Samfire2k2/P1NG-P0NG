/**
 * Test headless de la simulation (aucun DOM, aucun GPU).
 * Lancement : npm run sim
 */
import {
  BALL_RADIUS,
  DIFFICULTIES,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  FIXED_DT,
  PADDLE_WIDTH,
} from '../src/game/constants.ts'
import { World } from '../src/game/world.ts'

let failures = 0

function check(condition: boolean, message: string): void {
  if (!condition) {
    failures++
    console.error(`  ✗ ${message}`)
  } else {
    console.log(`  ✓ ${message}`)
  }
}

const isFiniteWorld = (w: World): boolean =>
  Number.isFinite(w.ball.x) &&
  Number.isFinite(w.ball.y) &&
  Number.isFinite(w.ball.vx) &&
  Number.isFinite(w.ball.vy) &&
  Number.isFinite(w.player.y) &&
  Number.isFinite(w.ai.y)

/** Distance signée à un rectangle arrondi (même formule que la simulation). */
function rectDistance(
  px: number,
  py: number,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  radius: number,
): number {
  const qx = Math.abs(px - cx) - (halfW - radius)
  const qy = Math.abs(py - cy) - (halfH - radius)
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
  )
}

/** Interception prédite par un bot joueur. */
function predictAt(w: World, targetX: number): number {
  let { x, y, vx, vy } = w.ball
  const dt = 1 / 120
  for (let i = 0; i < 400; i++) {
    x += vx * dt
    y += vy * dt
    if (y < w.ball.r) {
      y = w.ball.r
      vy = -vy
    } else if (y > FIELD_HEIGHT - w.ball.r) {
      y = FIELD_HEIGHT - w.ball.r
      vy = -vy
    }
    if ((vx < 0 && x <= targetX) || (vx > 0 && x >= targetX)) break
  }
  return y
}

console.log('\n— Physique & intégrité —')
{
  const w = new World()
  w.setSeed(1234)
  w.reset(11)
  w.frozen = false
  w.phase = 'play'
  w.ball.x = FIELD_WIDTH / 2
  w.ball.y = FIELD_HEIGHT / 2
  w.ball.vx = 700
  w.ball.vy = 250
  w.ball.speed = 740

  let maxOut = 0
  let scoreEvents = 0
  for (let i = 0; i < 240 * 30; i++) {
    w.playerTargetY = predictAt(w, w.player.x)
    w.step(FIXED_DT)
    for (const ev of w.drainEvents()) {
      if (ev.type === 'score') scoreEvents++
    }
    maxOut = Math.max(maxOut, Math.abs(w.ball.y - FIELD_HEIGHT / 2))
    if (!isFiniteWorld(w)) break
  }
  check(isFiniteWorld(w), 'la simulation reste finie (pas de NaN)')
  check(maxOut <= FIELD_HEIGHT / 2 + 1, `la balle reste dans le terrain (max ${maxOut.toFixed(1)}px)`)
  check(scoreEvents > 0, `des points sont marqués (${scoreEvents})`)
}

console.log('\n— Pas de tunneling à travers les raquettes —')
{
  const w = new World()
  w.setSeed(99)
  w.reset(11)
  w.frozen = false
  w.phase = 'play'
  let tunneling = 0
  for (let i = 0; i < 240 * 40; i++) {
    w.playerTargetY = predictAt(w, w.player.x)
    w.step(FIXED_DT)
    w.drainEvents()
    const playerDist = rectDistance(
      w.ball.x,
      w.ball.y,
      w.player.x,
      w.player.y,
      PADDLE_WIDTH / 2,
      w.player.height / 2,
      w.ball.r,
    )
    const aiDist = rectDistance(
      w.ball.x,
      w.ball.y,
      w.ai.x,
      w.ai.y,
      PADDLE_WIDTH / 2,
      w.ai.height / 2,
      w.ball.r,
    )
    if (playerDist < -0.5 || aiDist < -0.5) tunneling++
    if (!isFiniteWorld(w)) break
  }
  check(tunneling === 0, `aucun tunneling détecté (${tunneling})`)
  check(
    BALL_RADIUS * 2 + PADDLE_WIDTH > (1420 + 1900) * FIXED_DT,
    'le pas de simulation est plus fin que la raquette',
  )
}

console.log('\n— Match complet —')
{
  const w = new World()
  w.setSeed(2024)
  w.reset(7)
  w.frozen = false
  w.difficulty = 'moyen'
  let steps = 0
  let rallies = 0
  let aiReturns = 0
  while (w.phase !== 'over' && steps < 240 * 300) {
    w.playerTargetY = predictAt(w, w.player.x) + (Math.random() - 0.5) * 26
    w.step(FIXED_DT)
    for (const ev of w.drainEvents()) {
      if (ev.type === 'score') rallies++
      if (ev.type === 'paddleHit' && ev.side === 'ai') aiReturns++
    }
    steps++
  }
  console.log(
    `    → ${rallies} points, ${aiReturns} retours de l'IA (≈ ${(aiReturns / Math.max(rallies, 1)).toFixed(1)} échanges par point)`,
  )
  check(w.phase === 'over', `le match se termine (${w.scorePlayer} - ${w.scoreAi})`)
  check(
    Math.max(w.scorePlayer, w.scoreAi) === 7,
    `le score final atteint la cible (${w.scorePlayer} - ${w.scoreAi})`,
  )
  check(w.scorePlayer + w.scoreAi === 7, 'le nombre de points correspond au format')
  check(rallies >= 7, `au moins 7 échanges ont eu lieu (${rallies})`)
}

console.log('\n— Ordre de difficulté de l’IA —')
{
  const results: Array<{ name: string; returned: number; total: number }> = []
  for (const difficulty of DIFFICULTIES) {
    const w = new World()
    w.setSeed(777)
    w.reset(11)
    w.frozen = false
    w.difficulty = difficulty
    let returned = 0
    const total = 24
    for (let s = 0; s < total; s++) {
      w.phase = 'play'
      w.aiState.aimLocked = false
      w.ball.x = FIELD_WIDTH * 0.62
      w.ball.y = FIELD_HEIGHT * (0.25 + Math.random() * 0.5)
      w.ball.speed = 620
      const angle = (Math.random() - 0.5) * 0.5
      w.ball.vx = Math.cos(angle) * w.ball.speed
      w.ball.vy = Math.sin(angle) * w.ball.speed
      w.ai.y = FIELD_HEIGHT / 2
      let hit = false
      for (let i = 0; i < 240 * 6; i++) {
        w.step(FIXED_DT)
        for (const ev of w.drainEvents()) {
          if (ev.type === 'paddleHit' && ev.side === 'ai') hit = true
        }
        if (hit || w.ball.x > FIELD_WIDTH + 40) break
      }
      if (hit) returned++
    }
    results.push({ name: difficulty, returned, total })
  }
  for (const r of results) {
    console.log(`    ${r.name.padEnd(10)} retour ${r.returned}/${r.total}`)
  }
  const fac = results.find((r) => r.name === 'facile')!
  const exp = results.find((r) => r.name === 'expert')!
  const moyen = results.find((r) => r.name === 'moyen')!
  check(exp.returned >= fac.returned, "l'expert renvoie au moins autant que le facile")
  check(moyen.returned > 0, 'le niveau moyen renvoie une partie des balles')
  check(fac.returned <= moyen.returned, 'le facile laisse passer plus de balles que le moyen')
}

console.log('')
if (failures > 0) {
  console.error(`✗ ${failures} test(s) en échec\n`)
  process.exit(1)
}
console.log('✓ Tous les tests passent\n')
