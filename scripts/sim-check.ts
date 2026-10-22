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
  PLAYER_MAX_SPEED,
  ROUND_DURATION,
} from '../src/game/constants.ts'
import { createRng } from '../src/game/math.ts'
import { World, type Phase } from '../src/game/world.ts'

let failures = 0

/**
 * Lit la phase du monde.
 *
 * `w.phase = 'play'` fait narrowing sur la propriété : TypeScript la fige
 * alors sur `'play'` et ne l'élargit plus après un appel de méthode, même si
 * `step()` la modifie. Passer par cette fonction relit la propriété avec son
 * type complet (`Phase`).
 */
const phaseOf = (w: World): Phase => w.phase

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
  // Tirage déterministe pour le « joueur » : la partie doit être reproductible.
  const rng = createRng(2024)
  let steps = 0
  let rallies = 0
  let aiReturns = 0
  while (phaseOf(w) !== 'over' && steps < 240 * 300) {
    w.playerTargetY = predictAt(w, w.player.x) + (rng() - 0.5) * 26
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
  check(phaseOf(w) === 'over', `le match se termine (${w.scorePlayer} - ${w.scoreAi})`)
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
    // Même tirage pour chaque niveau : seule la difficulté change.
    const rng = createRng(777)
    let returned = 0
    const total = 24
    for (let s = 0; s < total; s++) {
      w.phase = 'play'
      w.aiState.aimLocked = false
      w.ball.x = FIELD_WIDTH * 0.62
      w.ball.y = FIELD_HEIGHT * (0.25 + rng() * 0.5)
      w.ball.speed = 620
      const angle = (rng() - 0.5) * 0.5
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

console.log('\n— Round chronométré —')
{
  const w = new World()
  w.setSeed(4242)
  w.format = 'time'
  w.reset(11)
  w.frozen = false
  w.phase = 'play'
  check(w.timeLeft === ROUND_DURATION, `le round démarre avec ${ROUND_DURATION} s`)

  // Balle qui ne sort pas du terrain verticalement : aucun point possible.
  w.ball.x = FIELD_WIDTH / 2
  w.ball.y = FIELD_HEIGHT / 2
  w.ball.vx = 0
  w.ball.vy = 600
  w.ball.speed = 600
  w.scorePlayer = 5
  w.scoreAi = 2
  w.timeLeft = 0.4
  for (let i = 0; i < 240; i++) {
    w.step(FIXED_DT)
    w.drainEvents()
  }
  check(phaseOf(w) === 'over', 'le round s’arrête quand le chronomètre tombe à zéro')
  check(w.timeLeft === 0, 'le chronomètre affiche zéro')
  check(w.winner === 'player' && !w.draw, 'le meilleur score gagne à la fin du round')
}
{
  const w = new World()
  w.format = 'time'
  w.reset(11)
  w.frozen = false
  w.phase = 'play'
  w.ball.x = FIELD_WIDTH / 2
  w.ball.y = FIELD_HEIGHT / 2
  w.ball.vx = 0
  w.ball.vy = 600
  w.ball.speed = 600
  w.scorePlayer = 3
  w.scoreAi = 3
  w.timeLeft = 0.3
  for (let i = 0; i < 240; i++) {
    w.step(FIXED_DT)
    w.drainEvents()
  }
  check(
    phaseOf(w) === 'over' && w.draw && w.winner === null,
    'une égalité à la fin du round est signalée',
  )
}
{
  // En mode « temps », atteindre le nombre de points ne termine pas la manche.
  const w = new World()
  w.format = 'time'
  w.reset(11)
  w.frozen = false
  w.phase = 'play'
  w.scorePlayer = 10
  w.ball.x = FIELD_WIDTH + 20
  w.ball.vx = 400
  w.ball.vy = 0
  w.ball.speed = 400
  w.step(FIXED_DT)
  w.drainEvents()
  check(w.scorePlayer === 11, 'le point est compté')
  check(phaseOf(w) !== 'over', 'en mode temps, atteindre la cible ne termine pas la manche')
}
{
  // En mode « points », le chronomètre est désactivé.
  const w = new World()
  w.reset(11)
  check(w.timeLeft === -1, 'le mode points n’a pas de chronomètre')
}

console.log('\n— Couleur de la balle —')
{
  const w = new World()
  w.setSeed(11)
  w.reset(11)
  w.frozen = false
  w.phase = 'play'
  check(w.ball.owner === -1, 'la balle n’a de propriétaire qu’après un contact')

  w.ball.x = w.player.x + 8
  w.ball.y = w.player.y
  w.ball.vx = -700
  w.ball.vy = 0
  w.ball.speed = 700
  w.step(FIXED_DT)
  w.drainEvents()
  check(w.ball.owner === 0, 'la balle prend la couleur de la raquette de gauche')

  w.ball.x = w.ai.x - 8
  w.ball.y = w.ai.y
  w.ball.vx = 700
  w.ball.vy = 0
  w.ball.speed = 700
  w.step(FIXED_DT)
  w.drainEvents()
  check(w.ball.owner === 1, 'la balle prend la couleur de la raquette de droite')
}

console.log('\n— Écho du terrain —')
{
  const w = new World()
  w.reset(11)
  w.frozen = false
  w.phase = 'play'
  check(w.gridPulse === 0, 'la grille est au repos au départ')
  w.ball.x = FIELD_WIDTH + 20
  w.ball.vx = 400
  w.ball.vy = 0
  w.ball.speed = 400
  w.step(FIXED_DT)
  w.drainEvents()
  check(w.gridPulse > 0.5, 'un point déclenche une impulsion de la grille')
  const pulse = w.gridPulse
  for (let i = 0; i < 240; i++) {
    w.step(FIXED_DT)
    w.drainEvents()
  }
  check(w.gridPulse < pulse, 'l’impulsion de la grille s’amortit')
}

console.log('\n— Reproductibilité —')
{
  // Empreinte d'une partie : phase, score, points, retours de l'IA, pas.
  const fingerprint = (seed: number): string => {
    const w = new World()
    w.setSeed(seed)
    w.reset(7)
    w.frozen = false
    w.difficulty = 'moyen'
    const rng = createRng(seed)
    let steps = 0
    let rallies = 0
    let aiReturns = 0
    while (phaseOf(w) !== 'over' && steps < 240 * 300) {
      w.playerTargetY = predictAt(w, w.player.x) + (rng() - 0.5) * 26
      w.step(FIXED_DT)
      for (const ev of w.drainEvents()) {
        if (ev.type === 'score') rallies++
        if (ev.type === 'paddleHit' && ev.side === 'ai') aiReturns++
      }
      steps++
    }
    return `${phaseOf(w)}|${w.scorePlayer}-${w.scoreAi}|${rallies}|${aiReturns}|${steps}`
  }
  const a = fingerprint(2024)
  const b = fingerprint(2024)
  check(a === b, `deux parties de même graine sont identiques (${a})`)

  // Le service tire son côté de la graine : il doit être stable.
  const serveTo = (seed: number): string => {
    const w = new World()
    w.setSeed(seed)
    w.reset(11)
    return w.serveTo
  }
  check(serveTo(2024) === serveTo(2024), 'le service est stable pour une graine donnée')

  // La simulation headless ne doit jamais toucher au générateur global :
  // sinon le résultat change d'une machine (ou d'un run) à l'autre.
  const realRandom = Math.random
  let usedGlobal = false
  Math.random = () => {
    usedGlobal = true
    return 0.5
  }
  try {
    const w = new World()
    w.setSeed(2024)
    w.reset(7)
    w.frozen = false
    w.difficulty = 'moyen'
    let steps = 0
    while (phaseOf(w) !== 'over' && steps < 240 * 300) {
      w.playerTargetY = predictAt(w, w.player.x)
      w.step(FIXED_DT)
      w.drainEvents()
      steps++
    }
    check(!usedGlobal, 'la simulation n’utilise pas Math.random()')
  } finally {
    Math.random = realRandom
  }
}

console.log('\n— Compte à rebours de service —')
{
  const w = new World()
  w.setSeed(7)
  w.reset(11)
  w.frozen = false
  const seq: number[] = []
  let steps = 0
  while (phaseOf(w) === 'serve' && steps < 240 * 5) {
    w.step(FIXED_DT)
    w.drainEvents()
    if (seq[seq.length - 1] !== w.countdown) seq.push(w.countdown)
    steps++
  }
  check(seq.join(',') === '2,1,0', `le compte à rebours passe par 2, 1, 0 (${seq.join(',')})`)
  check(phaseOf(w) === 'play', 'la balle est servie une fois le compte à rebours terminé')
  check(steps > 240 && steps < 240 * 3, `le compte à rebours dure environ une seconde (${steps} pas)`)
}

console.log('\n— Raquette pilotée à la souris —')
{
  const w = new World()
  w.reset(11)
  w.frozen = false
  w.player.snappy = true
  w.playerTargetY = 120
  w.step(FIXED_DT)
  check(Math.abs(w.player.y - 120) < 1, 'la raquette colle immédiatement au curseur')
  w.playerTargetY = 800
  w.step(FIXED_DT)
  check(Math.abs(w.player.y - 800) < 1, 'la raquette suit les déplacements rapides du curseur')
  check(Math.abs(w.player.vy) <= PLAYER_MAX_SPEED + 1, 'la vitesse reste bornée (effet de raquette)')
}

console.log('')
if (failures > 0) {
  console.error(`✗ ${failures} test(s) en échec\n`)
  process.exit(1)
}
console.log('✓ Tous les tests passent\n')
