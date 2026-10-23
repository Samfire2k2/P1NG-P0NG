import {
  AI_BASE_MAX_SPEED,
  BALL_MAX_SPEED,
  BALL_RADIUS,
  BALL_SPEED_GAIN,
  BALL_START_SPEED,
  BRICK_LIVES,
  COUNTDOWN_STEP,
  DIFFICULTY_PROFILES,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  MAX_BOUNCE_ANGLE,
  PADDLE_HEIGHT,
  PADDLE_WIDTH,
  PLAYER_MARGIN,
  PLAYER_MAX_SPEED,
  AI_MARGIN,
  POINT_PAUSE,
  SPIN_TRANSFER,
  type Difficulty,
  type MatchFormat,
} from './constants'
import { clamp, createRng, randRange, TAU } from './math'
import { ParticleSystem } from './particles'
import { aiColorFrom, hsvToRgb, type Hsv, type Rgb } from './colors'

export interface Brick {
  x: number
  y: number
  w: number
  h: number
  alive: boolean
  color: Rgb
}

export type Side = 'player' | 'ai'
export type Phase = 'serve' | 'play' | 'point' | 'over'

export type PowerupType = 'speed' | 'slow' | 'grow' | 'shrink' | 'multiball' | 'shield' | 'teleport' | 'magnet' | 'ghost' | 'double'

export interface Powerup {
  x: number
  y: number
  type: PowerupType
  ttl: number
  alive: boolean
}

export type GameEventType =
  | 'paddleHit'
  | 'wallHit'
  | 'score'
  | 'countdown'
  | 'serve'
  | 'win'
  | 'lose'
  | 'draw'
  | 'pointEnd'
  | 'powerup'

export interface GameEvent {
  type: GameEventType
  side?: Side
  power?: number
  offset?: number
  value?: number
  x?: number
  y?: number
}

export interface Paddle {
  x: number
  y: number
  vy: number
  height: number
  color: Rgb
  /**
   * Suit la cible sans limite de vitesse (curseur) : la raquette reste
   * exactement sous la souris.
   */
  snappy?: boolean
}

export interface Ball {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  speed: number
  /**
   * Raquette qui a frappÃ© la balle en dernier : 0 = gauche, 1 = droite,
   * -1 = aucune (au service). La balle prend la couleur de son propriÃ©taire.
   */
  owner: number
}

export interface AiState {
  targetY: number
  reactionTimer: number
  /** Erreur de visÃ©e figÃ©e pour l'Ã©change en cours (unitÃ©s). */
  aimError: number
  aimLocked: boolean
}

/**
 * Monde de simulation : sans dÃ©pendance au DOM.
 * Le renderer et l'audio lisent l'Ã©tat ; ils ne le modifient pas.
 *
 * DÃ©terminisme : par dÃ©faut l'alÃ©atoire vient de `Math.random` (partie en
 * direct). `setSeed` installe un gÃ©nÃ©rateur dÃ©terministe â€” la simulation
 * headless (`npm run sim`) l'utilise pour Ãªtre reproductible d'un run Ã  l'autre.
 */
export class World {
  phase: Phase = 'serve'
  time = 0
  frame = 0

  player: Paddle
  ai: Paddle
  /** Toutes les balles en jeu (multi-balle possible). */
  balls: Ball[] = []

  /** AccÃ¨s Ã  la balle principale (compatibilitÃ©). */
  get ball(): Ball {
    if (this.balls.length === 0) {
      this.balls.push({
        x: FIELD_WIDTH / 2,
        y: FIELD_HEIGHT / 2,
        vx: 0,
        vy: 0,
        r: BALL_RADIUS,
        speed: BALL_START_SPEED,
        owner: -1,
      })
    }
    return this.balls[0]
  }
  set ball(value: Ball) {
    if (this.balls.length === 0) this.balls.push(value)
    else this.balls[0] = value
  }

  scorePlayer = 0
  scoreAi = 0
  target = 11
  /** Format de la manche en cours. */
  format: MatchFormat = 'points'
  /** DurÃ©e d'une manche chronomÃ©trÃ©e (secondes). */
  roundDuration = 180
  /** Temps restant en mode Â« temps Â» ; -1 quand la manche n'est pas chronomÃ©trÃ©e. */
  timeLeft = -1
  /** La manche s'est terminÃ©e sur une Ã©galitÃ©. */
  draw = false

  /** Mode powerups : des bonus apparaissent sur le terrain. */
  powerupsEnabled = false
  /**
   * Mode casse-brique : un seul joueur, pas d'IA. Le joueur renvoye la balle
   * pour casser toutes les briques ; il perd une vie si la balle passe.
   */
  brickMode = false
  /** Mode casse-brique IA : l'ordinateur a ses propres briques. */
  aiBrickMode = false
  aiBricks: Brick[] = []
  /** Nombre de briques IA encore debout. */
  aiBricksLeft = 0
  /** Briques cassées par l'IA (score IA en mode adversaire). */
  aiBricksBroken = 0
  bricks: Brick[] = []
  /** Nombre de briques encore debout. */
  bricksLeft = 0
  /** Vies restantes en mode casse-brique. */
  brickLives = 3
  /** Briques cassÃ©es (score du mode casse-brique). */
  bricksBroken = 0
  powerups: Powerup[] = []
  private spawnTimer = 0
  /** Multiplicateurs actifs jusqu'au prochain point. */
  playerHeightMul = 1
  aiHeightMul = 1
  ballSpeedMul = 1
  /** Bouclier actif (absorbe un but). */
  playerShield = false
  aiShield = false
  /** Aimant (secondes restantes). */
  playerMagnet = 0
  aiMagnet = 0
  /** InvisibilitÃ© (secondes restantes). */
  ghostTimer = 0
  /** Double raquette. */
  playerDouble = false
  aiDouble = false

  serveTimer = 0
  serveTo: Side = 'player'
  countdown = 2
  countdownStep = 0
  winner: Side | null = null
  lastScorer: Side | null = null

  shake = 0
  flash = 0
  paddleFlashPlayer = 0
  paddleFlashAi = 0
  /** Impulsion de la grille : dÃ©clenchÃ©e Ã  chaque point, amortie dans le temps. */
  gridPulse = 0

  particles = new ParticleSystem()
  events: GameEvent[] = []

  playerTargetY = FIELD_HEIGHT / 2
  playerColor: Rgb = [0.2, 0.9, 1]
  aiColor: Rgb = [1, 0.3, 0.7]
  difficulty: Difficulty = 'moyen'
  /** En mode menu / pause : la balle reste garÃ©e, le joueur peut tester sa raquette. */
  frozen = true
  /** La raquette gauche est pilotÃ©e par le rÃ©seau (vue de l'invitÃ©). */
  playerRemote = false
  /** La raquette droite est pilotÃ©e par le rÃ©seau au lieu de l'IA. */
  aiRemote = false
  /** Cible reÃ§ue du rÃ©seau pour la raquette pilotÃ©e Ã  distance. */
  netPaddleY: number | null = null

  aiState: AiState = { targetY: FIELD_HEIGHT / 2, reactionTimer: 0, aimError: 0, aimLocked: false }
  /**
   * Source d'alÃ©atoire du monde. Par dÃ©faut `Math.random` (partie en direct) ;
   * `setSeed` installe un gÃ©nÃ©rateur dÃ©terministe pour la simulation headless.
   */
  private rng: () => number = Math.random

  constructor() {
    this.player = { x: PLAYER_MARGIN, y: FIELD_HEIGHT / 2, vy: 0, height: PADDLE_HEIGHT, color: this.playerColor }
    this.ai = { x: FIELD_WIDTH - AI_MARGIN, y: FIELD_HEIGHT / 2, vy: 0, height: PADDLE_HEIGHT, color: this.aiColor }
    this.balls = [{ x: FIELD_WIDTH / 2, y: FIELD_HEIGHT / 2, vx: 0, vy: 0, r: BALL_RADIUS, speed: BALL_START_SPEED, owner: -1 }]
    // Les particules suivent la mÃªme source d'alÃ©atoire que le monde.
    this.particles.rng = this.rng
  }

  setSeed(seed: number): void {
    this.rng = createRng(seed >>> 0)
    // Les particules partagent la graine : la simulation reste reproductible.
    this.particles.rng = this.rng
  }

  setPlayerColor(hsv: Hsv): void {
    this.playerColor = hsvToRgb(hsv.h, hsv.s, hsv.v)
    this.player.color = this.playerColor
    const ai = aiColorFrom(hsv)
    this.aiColor = ai
    this.ai.color = ai
  }

  /**
   * Couleurs par raquette (gauche / droite). En ligne, la raquette distante
   * porte la couleur choisie par l'adversaire.
   */
  setColors(left: Rgb, right: Rgb): void {
    this.playerColor = left
    this.player.color = left
    this.aiColor = right
    this.ai.color = right
  }

  reset(target = this.target): void {
    this.phase = 'serve'
    this.time = 0
    this.scorePlayer = 0
    this.scoreAi = 0
    this.target = target
    this.timeLeft = this.format === 'time' ? this.roundDuration : -1
    this.draw = false
    this.winner = null
    this.lastScorer = null
    this.powerups = []
    this.spawnTimer = 5
    this.bricks = []
    this.bricksLeft = 0
    this.bricksBroken = 0
    this.brickLives = BRICK_LIVES
    if (this.brickMode) this.buildBricks()
    if (this.aiBrickMode) this.buildAIBricks()
    this.playerHeightMul = 1
    this.aiHeightMul = 1
    this.ballSpeedMul = 1
    this.playerShield = false
    this.aiShield = false
    this.playerMagnet = 0
    this.aiMagnet = 0
    this.ghostTimer = 0
    this.playerDouble = false
    this.aiDouble = false
    this.player.y = FIELD_HEIGHT / 2
    this.player.vy = 0
    this.ai.y = FIELD_HEIGHT / 2
    this.ai.vy = 0
    this.player.height = PADDLE_HEIGHT * this.playerHeightMul
    this.ai.height = PADDLE_HEIGHT * this.aiHeightMul
    this.playerTargetY = FIELD_HEIGHT / 2
    this.aiState.targetY = FIELD_HEIGHT / 2
    this.aiState.reactionTimer = 0
    this.aiState.aimError = 0
    this.aiState.aimLocked = false
    this.particles.clear()
    this.shake = 0
    this.flash = 0
    this.gridPulse = 0
    this.parkBall()
    this.countdown = 2
    this.countdownStep = 0
    // Le Â« 2 Â» reste affichÃ© un temps avant de passer Ã  Â« 1 Â».
    this.serveTimer = COUNTDOWN_STEP
    this.serveTo = this.rng() < 0.5 ? 'player' : 'ai'
  }

  private parkBall(): void {
    this.balls = [{ x: FIELD_WIDTH / 2, y: FIELD_HEIGHT / 2, vx: 0, vy: 0, r: BALL_RADIUS, speed: BALL_START_SPEED, owner: -1 }]
  }

  private push(ev: GameEvent): void {
    this.events.push(ev)
  }

  drainEvents(): GameEvent[] {
    if (this.events.length === 0) return EMPTY_EVENTS
    const out = this.events
    this.events = []
    return out
  }

  /** Avance la simulation d'un pas fixe. */
  step(dt: number): void {
    this.time += dt
    this.frame++

    this.shake = Math.max(0, this.shake - dt * 3.2)
    this.flash = Math.max(0, this.flash - dt * 3.6)
    this.paddleFlashPlayer = Math.max(0, this.paddleFlashPlayer - dt * 4)
    this.paddleFlashAi = Math.max(0, this.paddleFlashAi - dt * 4)
    this.gridPulse = Math.max(0, this.gridPulse - dt * 0.85)

    if (!this.playerRemote) this.updatePlayer(dt)
    if (this.aiRemote) this.updateNetPaddle(dt)
    else this.updateAi(dt)
    if (this.frozen) {
      this.particles.update(dt)
      return
    }
    if (this.phase === 'serve') {
      this.updateServe(dt)
    } else if (this.phase === 'play') {
      this.updateBall(dt)
    } else if (this.phase === 'point') {
      this.serveTimer -= dt
      if (this.serveTimer <= 0) {
        this.phase = 'serve'
        this.countdown = 2
        this.countdownStep = 0
        this.serveTimer = COUNTDOWN_STEP
        this.serveTo = this.lastScorer === 'player' ? 'ai' : 'player'
        this.parkBall()
      }
    }

    this.playerMagnet = Math.max(0, this.playerMagnet - dt)
    this.aiMagnet = Math.max(0, this.aiMagnet - dt)
    this.ghostTimer = Math.max(0, this.ghostTimer - dt)

    // Aimant : la balle dÃ©vie vers la raquette adverse.
    if (this.playerMagnet > 0 || this.aiMagnet > 0) {
      for (const b of this.balls) {
        if (this.playerMagnet > 0 && b.vx < 0) {
          const dy = this.player.y - b.y
          b.vy += dy * 1.8 * dt
        }
        if (this.aiMagnet > 0 && b.vx > 0) {
          const dy = this.ai.y - b.y
          b.vy += dy * 1.8 * dt
        }
        const mag = Math.hypot(b.vx, b.vy) || 1
        b.vx = (b.vx / mag) * b.speed
        b.vy = (b.vy / mag) * b.speed
      }
    }

    this.updatePowerups(dt)
    this.particles.update(dt)
    this.updateClock(dt)
  }

  /**
   * ChronomÃ¨tre de manche : ne dÃ©compte pas pendant les services (la balle est
   * garÃ©e) et met fin Ã  la partie Ã  zÃ©ro.
   */
  private updateClock(dt: number): void {
    if (this.format !== 'time' || this.phase === 'over') return
    if (this.phase !== 'serve') {
      this.timeLeft = Math.max(0, this.timeLeft - dt)
    }
    if (this.timeLeft <= 0) this.endByTime()
  }

  /** Fin de manche au terme du chronomÃ¨tre : le meilleur score gagne. */
  private endByTime(): void {
    this.timeLeft = 0
    this.phase = 'over'
    if (this.scorePlayer === this.scoreAi) {
      this.winner = null
      this.draw = true
      this.push({ type: 'draw' })
      return
    }
    this.winner = this.scorePlayer > this.scoreAi ? 'player' : 'ai'
    this.draw = false
    this.push({ type: this.winner === 'player' ? 'win' : 'lose', side: this.winner })
  }

  private updatePlayer(dt: number): void {
    const p = this.player
    const half = p.height / 2
    const target = clamp(this.playerTargetY, half, FIELD_HEIGHT - half)
    const dy = target - p.y
    if (p.snappy) {
      // ContrÃ´le Ã  la souris : la raquette colle au curseur, sans retard.
      p.y = target
      p.vy = dt > 0 ? clamp(dy / dt, -PLAYER_MAX_SPEED, PLAYER_MAX_SPEED) : 0
      return
    }
    const maxStep = PLAYER_MAX_SPEED * dt
    const move = clamp(dy, -maxStep, maxStep)
    p.y = clamp(p.y + move, half, FIELD_HEIGHT - half)
    p.vy = dt > 0 ? move / dt : 0
  }

  private updateServe(dt: number): void {
    this.serveTimer -= dt
    if (this.serveTimer > 0) return
    if (this.countdown > 0) {
      // On annonce la valeur affichÃ©e, puis on dÃ©crÃ©mente.
      this.push({ type: 'countdown', value: this.countdown })
      this.countdown--
      this.serveTimer = COUNTDOWN_STEP
      return
    }
    this.serveTimer = 0
    this.launchServe()
  }

  private launchServe(): void {
    const dir = this.serveTo === 'player' ? -1 : 1
    const angle = randRange(-0.36, 0.36, this.rng)
    this.ball.x = FIELD_WIDTH / 2
    this.ball.y = FIELD_HEIGHT / 2
    this.ball.speed = BALL_START_SPEED
    this.ball.vx = Math.cos(angle) * this.ball.speed * dir
    this.ball.vy = Math.sin(angle) * this.ball.speed
    this.phase = 'play'
    this.push({ type: 'serve' })
  }

  private updateBall(dt: number): void {
    const toRemove: number[] = []
    for (let i = 0; i < this.balls.length; i++) {
      if (this.phase !== 'play') break
      const b = this.balls[i]
      b.x += b.vx * dt
      b.y += b.vy * dt

      // Murs haut / bas
      if (b.y - b.r <= 0) {
        b.y = b.r
        b.vy = Math.abs(b.vy)
        this.onWallHit(b.x, 0, b)
      } else if (b.y + b.r >= FIELD_HEIGHT) {
        b.y = FIELD_HEIGHT - b.r
        b.vy = -Math.abs(b.vy)
        this.onWallHit(b.x, FIELD_HEIGHT, b)
      }

      // Paddles
      if (b.vx < 0) {
        const front = this.player.x + PADDLE_WIDTH / 2
        if (b.x - b.r <= front && b.x > this.player.x - PADDLE_WIDTH) {
          if (this.paddleOverlap(this.player, b)) this.onPaddleHit(this.player, b, 1)
        }
      } else if (b.vx > 0) {
        const front = this.ai.x - PADDLE_WIDTH / 2
        if (b.x + b.r >= front && b.x < this.ai.x + PADDLE_WIDTH) {
          if (this.paddleOverlap(this.ai, b)) this.onPaddleHit(this.ai, b, -1)
        }
      }

      // Briques
      if (this.brickMode) {
        for (const brick of this.bricks) {
          if (!brick.alive) continue
          const overlapX = b.x + b.r > brick.x && b.x - b.r < brick.x + brick.w
          const overlapY = b.y + b.r > brick.y && b.y - b.r < brick.y + brick.h
          if (overlapX && overlapY) {
            brick.alive = false
            this.bricksLeft--
            this.bricksBroken++
            // Rebond : on inverse l'axe le plus proche du centre de la brique.
            const brickCx = brick.x + brick.w / 2
            const brickCy = brick.y + brick.h / 2
            const dx = b.x - brickCx
            const dy = b.y - brickCy
            if (Math.abs(dx) / brick.w > Math.abs(dy) / brick.h) b.vx = -b.vx
            else b.vy = -b.vy
            this.shake = Math.max(this.shake, 0.3)
            this.flash = Math.max(this.flash, 0.2)
            this.particles.burst(brickCx, brickCy, 10, brick.color, {
              speed: 180,
              spread: TAU,
              life: 0.4,
              size: 4,
            })
            this.push({ type: 'wallHit', x: brickCx, y: brickCy })

            // Mode casse-brique : pas d'adversaire, le score compte les
            // briques cassÃ©es. Victoire quand il n'en reste plus.
            if (this.brickMode) {
              this.scorePlayer = this.bricksBroken
              if (this.bricksLeft <= 0) {
                this.phase = 'over'
                this.draw = false
                this.winner = 'player'
                this.push({ type: 'win', side: 'player' })
              }
              break
            }

            // Briques IA : collisions avec les briques de l'ordinateur
            if (this.aiBrickMode) {
              for (const brick of this.aiBricks) {
                if (!brick.alive) continue
                const overlapX = b.x + b.r > brick.x && b.x - b.r < brick.x + brick.w
                const overlapY = b.y + b.r > brick.y && b.y - b.r < brick.y + brick.h
                if (overlapX && overlapY) {
                  brick.alive = false
                  this.aiBricksLeft--
                  this.aiBricksBroken++
                  const brickCx = brick.x + brick.w / 2
                  const brickCy = brick.y + brick.h / 2
                  const dx = b.x - brickCx
                  const dy = b.y - brickCy
                  if (Math.abs(dx) / brick.w > Math.abs(dy) / brick.h) b.vx = -b.vx
                  else b.vy = -b.vy
                  this.shake = Math.max(this.shake, 0.3)
                  this.flash = Math.max(this.flash, 0.2)
                  this.particles.burst(brickCx, brickCy, 10, brick.color, {
                    speed: 180,
                    spread: TAU,
                    life: 0.4,
                    size: 4,
                  })
                  this.push({ type: 'wallHit', x: brickCx, y: brickCy })

                  // Victoire : premier joueur à effacer toutes les briques de l'adversaire gagne
                  if (this.aiBricksLeft <= 0) {
                    this.phase = 'over'
                    this.draw = false
                    this.winner = b.owner === 0 ? 'player' : 'ai'
                    this.push({ type: 'win', side: this.winner })
                  }
                  break
                }
              }
            }

            // Point pour celui qui a frappÃ©.
            if (b.owner === 0) this.scorePlayer++
            else if (b.owner === 1) this.scoreAi++
            if (this.format === 'points' && (this.scorePlayer >= this.target || this.scoreAi >= this.target)) {
              this.phase = 'over'
              this.winner = this.scorePlayer > this.scoreAi ? 'player' : 'ai'
              this.draw = false
              this.push({ type: this.winner === 'player' ? 'win' : 'lose', side: this.winner })
            }
            break
          }
        }
      }

      // But
      if (b.x + b.r < 0) {
        toRemove.push(i)
        this.onGoal('ai')
      } else if (b.x - b.r > FIELD_WIDTH) {
        toRemove.push(i)
        this.onGoal('player')
      }
    }
    // Remove scored balls (reverse order)
    for (let k = toRemove.length - 1; k >= 0; k--) {
      this.balls.splice(toRemove[k], 1)
    }
    // If no balls left, park and serve
    if (this.balls.length === 0) {
      this.parkBall()
      if (this.phase !== 'over') this.phase = 'point'
    }
  }

  private paddleOverlap(p: Paddle, b: Ball): boolean {
    const halfH = p.height / 2
    const halfW = PADDLE_WIDTH / 2
    const dx = b.x - p.x
    const dy = b.y - p.y
    if (Math.abs(dy) > halfH + b.r) return false
    // Rectangle arrondi (coin = rayon de la balle)
    const cx = Math.abs(dx) - (halfW - b.r)
    const cy = Math.abs(dy) - (halfH - b.r)
    if (cx <= 0 && cy <= 0) return true
    return Math.hypot(Math.max(cx, 0), Math.max(cy, 0)) <= b.r
  }

  private onPaddleHit(p: Paddle, b: Ball, dir: number): void {
    const halfH = p.height / 2
    const offset = clamp((b.y - p.y) / halfH, -1, 1)

    // Point de contact sur la face du paddle
    b.x = p.x + dir * (PADDLE_WIDTH / 2 + b.r)

    const angle = offset * MAX_BOUNCE_ANGLE
    const speed = Math.min(b.speed * BALL_SPEED_GAIN * this.ballSpeedMul, BALL_MAX_SPEED)
    b.speed = speed
    let vx = Math.cos(angle) * speed * dir
    let vy = Math.sin(angle) * speed

    // Effet : la vitesse verticale du paddle dÃ©forme slightly la trajectoire
    vy += p.vy * SPIN_TRANSFER
    const mag = Math.hypot(vx, vy) || 1
    vx = (vx / mag) * speed
    vy = (vy / mag) * speed
    b.vx = vx
    b.vy = vy

    const power = clamp((speed - BALL_START_SPEED) / (BALL_MAX_SPEED - BALL_START_SPEED), 0, 1)
    this.shake = Math.max(this.shake, 0.25 + power * 0.75)
    this.flash = Math.max(this.flash, 0.2 + power * 0.4)
    if (p === this.player) this.paddleFlashPlayer = 1
    else this.paddleFlashAi = 1

    // La balle prend la couleur de la raquette qui vient de la frapper.
    b.owner = p === this.player ? 0 : 1

    this.particles.impact(b.x - dir * b.r, b.y, -dir, 0, p.color, power)
    this.push({
      type: 'paddleHit',
      side: p === this.player ? 'player' : 'ai',
      power,
      offset,
      x: b.x,
      y: b.y,
    })
  }

  private onWallHit(x: number, y: number, b: Ball): void {
    const power = clamp((b.speed - BALL_START_SPEED) / (BALL_MAX_SPEED - BALL_START_SPEED), 0, 1)
    this.shake = Math.max(this.shake, 0.12 + power * 0.3)
    this.particles.burst(x, y, 8, [0.75, 0.88, 1], {
      speed: 120 + power * 200,
      spread: 1.4,
      angle: y === 0 ? Math.PI / 2 : -Math.PI / 2,
      life: 0.32,
      size: 3.4,
    })
    this.push({ type: 'wallHit', x, y, power })
  }

  private updatePowerups(dt: number): void {
    if (!this.powerupsEnabled) {
      this.powerups = []
      return
    }
    // Spawn
    if (this.phase === 'play') {
      this.spawnTimer -= dt
      if (this.spawnTimer <= 0) {
        this.spawnTimer = 6 + this.rng() * 4
        const alive = this.powerups.filter((p) => p.alive)
        if (alive.length < 3) {
          const types: PowerupType[] = ['speed', 'slow', 'grow', 'shrink', 'multiball', 'shield', 'teleport', 'magnet', 'ghost', 'double']
          this.powerups.push({
            x: 260 + this.rng() * (FIELD_WIDTH - 520),
            y: 140 + this.rng() * (FIELD_HEIGHT - 280),
            type: types[Math.floor(this.rng() * types.length)],
            ttl: 9,
            alive: true,
          })
        }
      }
    }
    // Decay
    for (const p of this.powerups) {
      if (p.alive) {
        p.ttl -= dt
        if (p.ttl <= 0) p.alive = false
      }
    }
    // Collection
    const b = this.ball
    for (const p of this.powerups) {
      if (!p.alive) continue
      if (Math.hypot(b.x - p.x, b.y - p.y) <= b.r + 16) {
        p.alive = false
        this.collectPowerup(p, b.owner)
      }
    }
    // Purge
    this.powerups = this.powerups.filter((p) => p.alive)
  }

  private collectPowerup(p: Powerup, owner: number): void {
    const side: Side = owner === 0 ? 'player' : 'ai'
    switch (p.type) {
      case 'speed':
        this.ballSpeedMul = Math.min(1.6, this.ballSpeedMul * 1.35)
        break
      case 'slow':
        this.ballSpeedMul = Math.max(0.55, this.ballSpeedMul * 0.72)
        break
      case 'grow':
        if (owner === 0) this.playerHeightMul = Math.min(1.6, this.playerHeightMul * 1.4)
        else this.aiHeightMul = Math.min(1.6, this.aiHeightMul * 1.4)
        break
      case 'shrink':
        if (owner === 0) this.aiHeightMul = Math.max(0.6, this.aiHeightMul * 0.7)
        else this.playerHeightMul = Math.max(0.6, this.playerHeightMul * 0.7)
        break
      case 'multiball':
        // DÃ©double la balle principale.
        if (this.balls.length < 4) {
          const src = this.balls[0] ?? this.ball
          this.balls.push({
            x: src.x,
            y: src.y,
            vx: -src.vx,
            vy: src.vy * 0.8,
            r: src.r,
            speed: src.speed,
            owner: src.owner,
          })
        }
        break
      case 'shield':
        if (owner === 0) this.playerShield = true
        else this.aiShield = true
        break
      case 'teleport':
        // La balle saute de l'autre cÃ´tÃ© du terrain.
        for (const b of this.balls) {
          b.x = FIELD_WIDTH - b.x
          b.vx = -b.vx
        }
        break
      case 'magnet':
        // La balle est attirÃ©e vers le centre de la raquette adverse.
        if (owner === 0) this.aiMagnet = 1.5
        else this.playerMagnet = 1.5
        break
      case 'ghost':
        // La balle devient invisible pendant 1.2 s.
        this.ghostTimer = 1.2
        break
      case 'double':
        // Deux raquettes empilÃ©es pour le ramasseur.
        if (owner === 0) this.playerDouble = true
        else this.aiDouble = true
        break
    }
    this.player.height = PADDLE_HEIGHT * this.playerHeightMul
    this.ai.height = PADDLE_HEIGHT * this.aiHeightMul
    this.push({ type: 'powerup', side, x: p.x, y: p.y, value: ['speed','slow','grow','shrink','multiball','shield','teleport','magnet','ghost','double'].indexOf(p.type) })
  }

  buildBricks(): void {
    const cols = 10
    const rows = 8
    const bw = 36
    const bh = 20
    const gap = 6
    const totalW = cols * bw + (cols - 1) * gap
    const startX = (FIELD_WIDTH - totalW) / 2
    const startY = (FIELD_HEIGHT - (rows * bh + (rows - 1) * gap)) / 2
    const colors: Rgb[] = [
      [1, 0.3, 0.5],
      [1, 0.6, 0.2],
      [1, 0.85, 0.2],
      [0.3, 0.9, 0.5],
    ]
    this.bricks = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        this.bricks.push({
          x: startX + c * (bw + gap),
          y: startY + r * (bh + gap),
          w: bw,
          h: bh,
          alive: true,
          color: colors[r % colors.length],
        })
      }
    }
    this.bricksLeft = this.bricks.length
  }

  buildAIBricks(): void {
    const cols = 8
    const rows = 4
    const bw = 40
    const bh = 24
    const gap = 8
    const totalW = cols * bw + (cols - 1) * gap
    const startX = (FIELD_WIDTH - totalW) / 2
    const startY = (FIELD_HEIGHT - (rows * bh + (rows - 1) * gap)) / 2
    const colors: Rgb[] = [
      [1, 0.3, 0.5],
      [1, 0.6, 0.2],
      [1, 0.85, 0.2],
      [0.3, 0.9, 0.5],
    ]
    this.aiBricks = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        this.aiBricks.push({
          x: startX + c * (bw + gap),
          y: startY + r * (bh + gap),
          w: bw,
          h: bh,
          alive: true,
          color: colors[r % colors.length],
        })
      }
    }
    this.aiBricksLeft = this.aiBricks.length
  }

  private onGoal(scorer: Side): void {
    // Mode casse-brique IA : le but marque un point et on relance.
    // Victoire : premier joueur à effacer toutes les briques de l'adversaire gagne.
    if (this.aiBrickMode) {
      this.scorePlayer = scorer === 'player' ? this.scorePlayer + 1 : this.scorePlayer
      this.scoreAi = scorer === 'ai' ? this.scoreAi + 1 : this.scoreAi
      this.lastScorer = scorer
      this.phase = 'point'
      this.serveTimer = POINT_PAUSE
      this.shake = 1
      this.flash = 1
      this.gridPulse = 1
      this.push({ type: 'score', side: scorer, value: scorer === 'player' ? this.scorePlayer : this.scoreAi })

      // Vérifier victoire : si les briques de l'adversaire sont toutes cassées
      if (scorer === 'player' && this.aiBricksLeft <= 0) {
        this.phase = 'over'
        this.draw = false
        this.winner = 'player'
        this.push({ type: 'win', side: 'player' })
      } else if (scorer === 'ai' && this.bricksLeft <= 0) {
        this.phase = 'over'
        this.draw = false
        this.winner = 'ai'
        this.push({ type: 'lose', side: 'ai' })
      }
      return
    }

    // Mode casse-brique classique : le but enlÃ¨ve une vie ; s'il en reste, on relance.
    if (this.brickMode) {
      this.brickLives--
      if (this.brickLives <= 0) {
        this.phase = 'over'
        this.draw = false
        this.winner = 'ai'
        this.push({ type: 'lose', side: 'ai' })
      } else {
        this.phase = 'point'
        this.serveTimer = POINT_PAUSE
        this.push({ type: 'score', side: scorer, value: this.brickLives })
      }
      return
    }
    // Bouclier : absorbe le but.
    if (scorer === 'player' && this.aiShield) {
      this.aiShield = false
      this.lastScorer = 'ai'
      this.phase = 'point'
      this.serveTimer = POINT_PAUSE * 0.6
      this.shake = 0.4
      this.flash = 0.4
      this.push({ type: 'score', side: 'ai', value: this.scoreAi })
      return
    }
    if (scorer === 'ai' && this.playerShield) {
      this.playerShield = false
      this.lastScorer = 'player'
      this.phase = 'point'
      this.serveTimer = POINT_PAUSE * 0.6
      this.shake = 0.4
      this.flash = 0.4
      this.push({ type: 'score', side: 'player', value: this.scorePlayer })
      return
    }

    if (scorer === 'player') this.scorePlayer++
    else this.scoreAi++

    this.lastScorer = scorer
    this.phase = 'point'
    this.serveTimer = POINT_PAUSE
    this.shake = 1
    this.flash = 1
    this.gridPulse = 1

    // Les effets des powerups s'arrÃªtent au point marquÃ©.
    this.playerHeightMul = 1
    this.aiHeightMul = 1
    this.ballSpeedMul = 1
    this.player.height = PADDLE_HEIGHT
    this.ai.height = PADDLE_HEIGHT

    const color = scorer === 'player' ? this.playerColor : this.aiColor
    const x = scorer === 'player' ? FIELD_WIDTH + 20 : -20
    this.particles.burst(x, this.ball.y, 90, color, {
      speed: 420,
      spread: TAU,
      life: 1.1,
      size: 7,
      drag: 1.6,
    })

    this.push({ type: 'score', side: scorer, value: scorer === 'player' ? this.scorePlayer : this.scoreAi })

    // En mode Â« points Â» la manche s'arrÃªte dÃ¨s que la cible est atteinte ;
    // en mode Â« temps Â» seul le chronomÃ¨tre dÃ©cide.
    if (this.format === 'points' && (this.scorePlayer >= this.target || this.scoreAi >= this.target)) {
      this.phase = 'over'
      this.draw = false
      this.winner = this.scorePlayer > this.scoreAi ? 'player' : 'ai'
      this.push({ type: this.winner === 'player' ? 'win' : 'lose', side: this.winner })
    } else {
      this.phase = 'point'
      this.serveTimer = POINT_PAUSE
      this.shake = 1
      this.flash = 1
      this.gridPulse = 1
    }
  }

  /** Raquette pilotÃ©e Ã  distance : suit la cible reÃ§ue du rÃ©seau. */
  private updateNetPaddle(dt: number): void {
    const paddle = this.ai
    const half = paddle.height / 2
    if (this.netPaddleY === null) return
    const desired = clamp(this.netPaddleY, half, FIELD_HEIGHT - half)
    const dy = desired - paddle.y
    if (paddle.snappy) {
      // Raquette locale de l'invitÃ© : elle colle au curseur, sans retard.
      paddle.y = desired
      paddle.vy = dt > 0 ? clamp(dy / dt, -PLAYER_MAX_SPEED, PLAYER_MAX_SPEED) : 0
      return
    }
    const maxStep = PLAYER_MAX_SPEED * dt
    const move = clamp(dy, -maxStep, maxStep)
    paddle.y = clamp(paddle.y + move, half, FIELD_HEIGHT - half)
    paddle.vy = dt > 0 ? move / dt : 0
  }

  /** IA : prÃ©diction d'interception + dÃ©lai de rÃ©action + erreur humaine. */
  private updateAi(dt: number): void {
    const profile = DIFFICULTY_PROFILES[this.difficulty]
    const state = this.aiState
    const paddle = this.ai

    state.reactionTimer -= dt
    if (state.reactionTimer <= 0) {
      state.reactionTimer = profile.reaction * randRange(0.75, 1.35, this.rng)

      if (this.ball.vx > 0) {
        // Balle en approche : on fige une erreur de visÃ©e pour tout l'Ã©change,
        // comme un joueur humain qui vise un point (parfois ratÃ©).
        if (!state.aimLocked) {
          const sign = this.rng() < 0.5 ? -1 : 1
          state.aimError = sign * profile.error * (0.5 + this.rng() * 0.9)
          state.aimLocked = true
        }
        const intercept = this.predictIntercept()
        state.targetY = intercept + state.aimError
      } else {
        // Balle chez le joueur : recentrage, comme un humain qui attend.
        state.aimLocked = false
        state.aimError = 0
        state.targetY = FIELD_HEIGHT / 2 + randRange(-40, 40, this.rng)
      }
    }

    const half = paddle.height / 2
    const desired = clamp(state.targetY, half, FIELD_HEIGHT - half)
    const maxSpeed = AI_BASE_MAX_SPEED * profile.speed
    const dy = desired - paddle.y
    const maxStep = maxSpeed * dt
    const move = clamp(dy, -maxStep, maxStep)
    paddle.y = clamp(paddle.y + move, half, FIELD_HEIGHT - half)
    paddle.vy = dt > 0 ? move / dt : 0
  }

  /** PrÃ©dit la Y d'interception de la balle (simulation grossiÃ¨re, sans rebonds de paddle). */
  private predictIntercept(): number {
    const b = this.ball
    if (b.vx <= 0) return FIELD_HEIGHT / 2
    const targetX = this.ai.x
    let x = b.x
    let y = b.y
    let vx = b.vx
    let vy = b.vy
    const dt = 1 / 120
    for (let i = 0; i < 240; i++) {
      x += vx * dt
      y += vy * dt
      if (y < b.r) {
        y = b.r
        vy = -vy
      } else if (y > FIELD_HEIGHT - b.r) {
        y = FIELD_HEIGHT - b.r
        vy = -vy
      }
      if (x >= targetX) break
    }
    return clamp(y, 0, FIELD_HEIGHT)
  }
}

const EMPTY_EVENTS: GameEvent[] = []
